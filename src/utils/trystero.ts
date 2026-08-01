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
 * 모든 트래커를 동시에 사용하여 피어 간 교차 매칭 확률을 최대화합니다.
 */
export function getRandomTrackers(_count?: number): string[] {
  return [...TRACKER_POOL];
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

export function hashRoomId(normalizedCode: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(`fileshare:v1:${normalizedCode}`);
  
  return crypto.subtle.digest('SHA-256', data).then(hashBuffer => {
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  });
}

export function formatRoomCode(normalizedCode: string): string {
  if (normalizedCode.length <= 4) return normalizedCode;
  return `${normalizedCode.substring(0, 4)}-${normalizedCode.substring(4, 8)}`;
}
