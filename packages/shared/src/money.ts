/** Round a non-negative integer division half-up, exactly (no float). */
export function divRoundHalfUp(numerator: number, denominator: number): number {
  if (!Number.isInteger(numerator) || !Number.isInteger(denominator) || denominator <= 0) {
    throw new RangeError('divRoundHalfUp requires integer numerator and positive integer denominator');
  }
  const sign = numerator < 0 ? -1 : 1;
  const n = Math.abs(numerator);
  return sign * Math.floor((2 * n + denominator) / (2 * denominator));
}

/** Apply a basis-point percentage, rounded half-up. 1000bp = 10%. */
export function applyBasisPoints(amountSatang: number, basisPoints: number): number {
  return divRoundHalfUp(amountSatang * basisPoints, 10_000);
}

/** Compute VAT from a net amount. */
export function taxFromNet(netSatang: number, rateBp: number): number {
  if (rateBp < 0) throw new RangeError('Tax rate cannot be negative');
  return divRoundHalfUp(netSatang * rateBp, 10_000);
}

/**
 * Extract VAT from a tax-inclusive gross amount.
 * gross = net + tax, tax = gross * rate / (10000 + rate)
 */
export function taxFromGross(grossSatang: number, rateBp: number): number {
  if (rateBp < 0) throw new RangeError('Tax rate cannot be negative');
  return divRoundHalfUp(grossSatang * rateBp, 10_000 + rateBp);
}

/**
 * Distribute an integer total across weights using the largest-remainder method.
 * The returned parts always sum exactly to `total`.
 */
export function allocateProportionally(total: number, weights: number[]): number[] {
  if (!Number.isInteger(total) || total < 0) {
    throw new RangeError('allocate total must be a non-negative integer');
  }
  const sum = weights.reduce((acc, w) => acc + Math.max(0, w), 0);
  if (weights.length === 0) return [];
  if (sum <= 0) {
    const parts = weights.map(() => 0);
    parts[0] = total;
    return parts;
  }

  const parts: number[] = [];
  const remainders: Array<{ index: number; remainder: number }> = [];
  let allocated = 0;

  weights.forEach((weight, index) => {
    const w = Math.max(0, weight);
    const exact = total * w;
    const base = Math.floor(exact / sum);
    parts.push(base);
    allocated += base;
    remainders.push({ index, remainder: exact % sum });
  });

  let left = total - allocated;
  remainders.sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  for (let i = 0; i < remainders.length && left > 0; i += 1) {
    const entry = remainders[i];
    if (entry && weights[entry.index]! > 0) {
      parts[entry.index] = (parts[entry.index] ?? 0) + 1;
      left -= 1;
    }
  }
  // Leftover can only remain when every weight is zero; put it on the first slot.
  if (left > 0 && parts.length > 0) parts[0] = (parts[0] ?? 0) + left;
  return parts;
}

/** Saturating add for integer satang. */
export function clampMoney(value: number): number {
  return Math.max(0, Math.round(value));
}
