const HEX_RADIX = 16;

export function toHex(buffer: ArrayBuffer) {
  return [...new Uint8Array(buffer)].map(byte => byte.toString(HEX_RADIX).padStart(2, "0")).join("");
}
