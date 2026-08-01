// 공용 WebTorrent 트래커 풀
const TRACKER_POOL = [
  'wss://tracker.openwebtorrent.com',
  'wss://tracker.files.fm:7073/announce',
  'wss://tracker.webtorrent.dev',
  'wss://tracker.btorrent.xyz',
  'wss://q.bandcamptracker.ru',
  'wss://tracker.novage.com.ua',
  'wss://tracker.sloppyta.co:443/announce'
];

/**
 * 트래커 풀에서 지정된 개수만큼 랜덤으로 트래커를 선택합니다.
 */
export function getRandomTrackers(count: number = 3): string[] {
  const shuffled = [...TRACKER_POOL].sort(() => 0.5 - Math.random());
  return shuffled.slice(0, count);
}

/**
 * 혼동하기 쉬운 문자를 제외한 영숫자 문자셋
 * Excludes: 0, O, 1, I, L
 */
const ALLOWED_CHARS = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

export function generateRoomCode(): string {
  let code = '';
  const randomValues = new Uint8Array(8);
  crypto.getRandomValues(randomValues);
  
  for (let i = 0; i < 8; i++) {
    code += ALLOWED_CHARS[randomValues[i] % ALLOWED_CHARS.length];
  }
  
  return `${code.substring(0, 4)}-${code.substring(4, 8)}`;
}

export function normalizeRoomCode(code: string): string {
  return code.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
}

export async function hashRoomId(normalizedCode: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(`fileshare:v1:${normalizedCode}`);
  
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  
  return hashHex;
}

export function formatRoomCode(normalizedCode: string): string {
  if (normalizedCode.length <= 4) return normalizedCode;
  return `${normalizedCode.substring(0, 4)}-${normalizedCode.substring(4, 8)}`;
}
