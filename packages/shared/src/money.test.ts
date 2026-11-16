import { describe, expect, it } from 'vitest';
import { allocateProportionally, applyBasisPoints, divRoundHalfUp, taxFromGross, taxFromNet } from './money';

describe('integer money', () => {
  it('rounds half-up without float drift', () => {
    expect(divRoundHalfUp(105, 10)).toBe(11);
    expect(divRoundHalfUp(104, 10)).toBe(10);
    expect(divRoundHalfUp(1, 2)).toBe(1);
    expect(divRoundHalfUp(1, 3)).toBe(0);
  });

  it('applies basis points exactly', () => {
    expect(applyBasisPoints(10_000, 1000)).toBe(1000);
    expect(applyBasisPoints(9999, 700)).toBe(700);
    expect(applyBasisPoints(1, 5000)).toBe(1);
  });

  it('extracts VAT from an inclusive amount', () => {
    // 107.00 THB inclusive at 7% -> 7.00 THB VAT
    expect(taxFromGross(10_700, 700)).toBe(700);
    // 65.00 inclusive -> 4.25 VAT
    expect(taxFromGross(6_500, 700)).toBe(425);
    expect(taxFromGross(6_500, 700) + (6_500 - taxFromGross(6_500, 700))).toBe(6_500);
  });

  it('adds VAT to an exclusive amount', () => {
    expect(taxFromNet(10_000, 700)).toBe(700);
  });

  it('allocates every satang with largest remainder', () => {
    const parts = allocateProportionally(100, [1, 1, 1]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(100);
    expect(parts.sort((a, b) => b - a)).toEqual([34, 33, 33]);
    expect(allocateProportionally(1, [0, 0])).toEqual([1, 0]);
    expect(allocateProportionally(500, [1, 2, 3])).toEqual([83, 167, 250]);
  });
});
