/**
 * CRC-16/CCITT-FALSE: poly 0x1021, init 0xFFFF, no reflection, no final XOR.
 * This is the checksum required by EMVCo tag 63.
 */
export function crc16CcittFalse(input: string): number {
  let crc = 0xffff;
  for (let index = 0; index < input.length; index += 1) {
    crc ^= (input.charCodeAt(index) & 0xff) << 8;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc & 0xffff;
}

export function crc16Hex(input: string): string {
  return crc16CcittFalse(input).toString(16).toUpperCase().padStart(4, '0');
}
