import * as pako from 'pako';

export interface SignalingPackage {
  version: 1;
  type: "offer" | "answer";
  sessionId: string;
  createdAt: number;
  description: RTCSessionDescriptionInit;
}

export type EncodingType = 'cs' | 'pk' | 'no';

function arrayBufferToBase64Url(buffer: ArrayBuffer): string {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const b64 = btoa(binary);
  // Convert to Base64 URL safe
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToArrayBuffer(b64url: string): ArrayBuffer {
  // Revert URL safe to standard Base64
  let b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  // Pad with '='
  while (b64.length % 4 !== 0) {
    b64 += '=';
  }
  
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

export async function encodeSignalingPackage(pkg: SignalingPackage): Promise<string> {
  const jsonStr = JSON.stringify(pkg);
  const encoder = new TextEncoder();
  const uint8Arr = encoder.encode(jsonStr);

  let encodingType: EncodingType = 'no';
  let compressedBuffer: ArrayBuffer;

  if (typeof CompressionStream !== 'undefined') {
    try {
      const cs = new CompressionStream('gzip');
      const writer = cs.writable.getWriter();
      writer.write(uint8Arr);
      writer.close();
      
      const response = new Response(cs.readable);
      compressedBuffer = await response.arrayBuffer();
      encodingType = 'cs';
    } catch (e) {
      console.warn('CompressionStream failed, falling back to pako', e);
      compressedBuffer = pako.gzip(uint8Arr).buffer;
      encodingType = 'pk';
    }
  } else {
    // Fallback to pako
    compressedBuffer = pako.gzip(uint8Arr).buffer;
    encodingType = 'pk';
  }

  const base64Str = arrayBufferToBase64Url(compressedBuffer);
  return `v1:${encodingType}:${base64Str}`;
}

export async function decodeSignalingPackage(encodedStr: string): Promise<SignalingPackage> {
  const parts = encodedStr.split(':');
  if (parts.length < 3) {
    throw new Error('유효하지 않은 패키지 형식입니다.');
  }

  const [version, encodingType, base64Str] = parts;
  
  if (version !== 'v1') {
    throw new Error(`지원하지 않는 패키지 버전입니다: ${version}`);
  }

  const buffer = base64UrlToArrayBuffer(base64Str);
  let decompressedUint8Arr: Uint8Array;

  if (encodingType === 'cs') {
    if (typeof DecompressionStream !== 'undefined') {
      try {
        const ds = new DecompressionStream('gzip');
        const writer = ds.writable.getWriter();
        writer.write(new Uint8Array(buffer));
        writer.close();

        const response = new Response(ds.readable);
        const arrayBuffer = await response.arrayBuffer();
        decompressedUint8Arr = new Uint8Array(arrayBuffer);
      } catch (e) {
        console.warn('DecompressionStream failed, trying pako', e);
        decompressedUint8Arr = pako.ungzip(new Uint8Array(buffer));
      }
    } else {
      decompressedUint8Arr = pako.ungzip(new Uint8Array(buffer));
    }
  } else if (encodingType === 'pk') {
    decompressedUint8Arr = pako.ungzip(new Uint8Array(buffer));
  } else if (encodingType === 'no') {
    decompressedUint8Arr = new Uint8Array(buffer);
  } else {
    throw new Error(`지원하지 않는 압축 방식입니다: ${encodingType}`);
  }

  const decoder = new TextDecoder();
  const jsonStr = decoder.decode(decompressedUint8Arr);
  const pkg: SignalingPackage = JSON.parse(jsonStr);

  if (pkg.version !== 1) {
    throw new Error(`호환되지 않는 데이터 버전입니다: ${pkg.version}`);
  }

  return pkg;
}
