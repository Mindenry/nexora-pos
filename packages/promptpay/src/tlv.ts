export interface TlvField {
  tag: string;
  length: number;
  value: string;
}

export function encodeTlv(tag: string, value: string): string {
  if (!/^\d{2}$/.test(tag)) throw new Error(`Invalid TLV tag: ${tag}`);
  if (!/^[\x20-\x7E]*$/.test(value)) throw new Error(`TLV ${tag} must be printable ASCII`);
  if (value.length > 99) throw new Error(`TLV ${tag} exceeds 99 characters`);
  return `${tag}${String(value.length).padStart(2, '0')}${value}`;
}

export function encodeTemplate(tag: string, fields: string[]): string {
  return encodeTlv(tag, fields.filter(Boolean).join(''));
}

export function parseTlv(payload: string): TlvField[] {
  const fields: TlvField[] = [];
  let offset = 0;
  while (offset < payload.length) {
    if (offset + 4 > payload.length) throw new Error('Truncated TLV header');
    const tag = payload.slice(offset, offset + 2);
    const lengthText = payload.slice(offset + 2, offset + 4);
    if (!/^\d{2}$/.test(tag) || !/^\d{2}$/.test(lengthText)) {
      throw new Error('Malformed TLV header');
    }
    const length = Number(lengthText);
    const start = offset + 4;
    const end = start + length;
    if (end > payload.length) throw new Error(`TLV ${tag} length exceeds payload`);
    fields.push({ tag, length, value: payload.slice(start, end) });
    offset = end;
  }
  return fields;
}

export function findTlv(fields: TlvField[], tag: string): TlvField | undefined {
  return fields.find((field) => field.tag === tag);
}
