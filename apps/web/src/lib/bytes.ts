// Byte <-> text helpers that work in browsers and jsdom.

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function bytesToBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function base64UrlToBytes(b64url: string): Uint8Array {
  const s = b64url.replace(/-/g, "+").replace(/_/g, "/");
  return base64ToBytes(s + "=".repeat((4 - (s.length % 4)) % 4));
}

export function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}
