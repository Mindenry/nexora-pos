import { describe, expect, it } from 'vitest';
import { quoteCart, type QuotePromotion } from './pricing';
import { parseMoneyToSatang, satangToBahtString } from './format';
import { ROLE_DEFINITIONS } from './permissions';

const baseLine = {
  key: '1',
  variantId: '11111111-1111-4111-8111-111111111111',
  productId: '22222222-2222-4222-8222-222222222222',
  categoryId: '33333333-3333-4333-8333-333333333333',
  name: 'Test item',
  sku: 'T-1',
  qty: 2,
  unitPriceSatang: 10_000,
  unitCostSatang: 6_000,
};

describe('cart pricing', () => {
  it('reconciles a tax-inclusive cart with a line discount and order discount', () => {
    const quote = quoteCart({
      lines: [{ ...baseLine, lineDiscount: { type: 'percent', basisPoints: 1000 } }],
      orderDiscount: { type: 'percent', basisPoints: 1000 },
      taxRateBp: 700,
      pricesIncludeTax: true,
    });
    expect(quote.subtotalSatang).toBe(20_000);
    expect(quote.lines[0]!.discountSatang).toBe(3_800);
    expect(quote.discountSatang).toBe(3_800);
    expect(quote.totalSatang).toBe(16_200);
    expect(quote.taxSatang).toBe(1_060);
    expect(quote.lines.reduce((sum, l) => sum + l.netSatang, 0)).toBe(16_200);
    expect(quote.lines.reduce((sum, l) => sum + l.taxSatang, 0)).toBe(quote.taxSatang);
    expect(quote.lines.reduce((sum, l) => sum + l.totalSatang, 0)).toBe(quote.totalSatang);
  });

  it('adds tax for tax-exclusive pricing', () => {
    const quote = quoteCart({
      lines: [baseLine],
      taxRateBp: 700,
      pricesIncludeTax: false,
    });
    expect(quote.totalSatang).toBe(21_400);
    expect(quote.lines.reduce((sum, l) => sum + l.totalSatang, 0)).toBe(21_400);
    expect(quote.taxSatang).toBe(1_400);
  });

  it('applies a stackable coupon and promotion', () => {
    const promotions: QuotePromotion[] = [
      {
        id: 'p1',
        code: 'AUTO',
        name: '10%',
        kind: 'order_percent',
        valueBp: 1000,
        stackable: true,
        priority: 10,
      },
      {
        id: 'c1',
        code: 'WELCOME50',
        name: 'Coupon',
        kind: 'order_amount',
        valueSatang: 5000,
        stackable: true,
        priority: 100,
        couponCode: 'WELCOME50',
      },
    ];
    const quote = quoteCart({
      lines: [baseLine],
      couponCode: 'WELCOME50',
      promotions,
      taxRateBp: 700,
      pricesIncludeTax: true,
    });
    expect(quote.ignoredCouponReason).toBeNull();
    expect(quote.discountSatang).toBe(7_000);
    expect(quote.appliedPromotions).toHaveLength(2);
    expect(quote.totalSatang).toBe(13_000);
  });

  it('refuses to stack a coupon on an exclusive promotion', () => {
    const promotions: QuotePromotion[] = [
      {
        id: 'p1',
        code: 'AUTO',
        name: '10%',
        kind: 'order_percent',
        valueBp: 1000,
        stackable: false,
        priority: 10,
      },
      {
        id: 'c1',
        code: 'WELCOME50',
        name: 'Coupon',
        kind: 'order_amount',
        valueSatang: 5000,
        stackable: true,
        priority: 100,
        couponCode: 'WELCOME50',
      },
    ];
    const quote = quoteCart({
      lines: [baseLine],
      couponCode: 'WELCOME50',
      promotions,
      taxRateBp: 700,
      pricesIncludeTax: true,
    });
    expect(quote.ignoredCouponReason).toBe('COUPON_NOT_STACKABLE');
    expect(quote.appliedPromotions).toHaveLength(1);
    expect(quote.discountSatang).toBe(2_000);
  });

  it('rejects invalid quantities', () => {
    expect(() =>
      quoteCart({ lines: [{ ...baseLine, qty: 0 }], taxRateBp: 700, pricesIncludeTax: true }),
    ).toThrow('QTY_INVALID');
  });

  it('reconciles randomised carts exactly', () => {
    let seed = 42;
    const random = () => {
      seed = (seed * 1_664_525 + 1_013_904_223) % 4_294_967_296;
      return seed / 4_294_967_296;
    };
    for (let iteration = 0; iteration < 300; iteration += 1) {
      const lineCount = 1 + Math.floor(random() * 5);
      const lines = Array.from({ length: lineCount }, (_, index) => ({
        ...baseLine,
        key: String(index),
        variantId: `${index}1111111-1111-4111-8111-111111111111`,
        qty: 1 + Math.floor(random() * 7),
        unitPriceSatang: 1 + Math.floor(random() * 50_000),
        unitCostSatang: Math.floor(random() * 20_000),
        lineDiscount:
          random() < 0.4
            ? { type: 'percent' as const, basisPoints: Math.floor(random() * 3000) }
            : null,
      }));
      const quote = quoteCart({
        lines,
        orderDiscount: random() < 0.5 ? { type: 'amount', satang: Math.floor(random() * 5000) } : null,
        taxRateBp: 700,
        pricesIncludeTax: random() < 0.5,
      });
      expect(quote.lines.reduce((sum, l) => sum + l.netSatang, 0)).toBe(
        quote.pricesIncludeTax ? quote.totalSatang : quote.totalSatang - quote.taxSatang,
      );
      expect(quote.lines.reduce((sum, l) => sum + l.taxSatang, 0)).toBe(quote.taxSatang);
      expect(quote.subtotalSatang - quote.discountSatang).toBe(
        quote.lines.reduce((sum, l) => sum + l.netSatang, 0),
      );
      expect(quote.discountSatang).toBeLessThanOrEqual(quote.subtotalSatang);
      expect(quote.totalSatang).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('money input', () => {
  it('parses Thai formatted amounts without float arithmetic', () => {
    expect(parseMoneyToSatang('1,234.50')).toBe(123_450);
    expect(parseMoneyToSatang('65')).toBe(6_500);
    expect(parseMoneyToSatang('0.05')).toBe(5);
    expect(parseMoneyToSatang('12.345')).toBe(1_235);
    expect(parseMoneyToSatang('')).toBeNull();
    expect(parseMoneyToSatang('abc')).toBeNull();
    expect(satangToBahtString(123_450)).toBe('1234.50');
    expect(satangToBahtString(-50)).toBe('-0.50');
  });
});

describe('role defaults', () => {
  it('gives owners all tenant permissions but not platform admin', () => {
    const owner = ROLE_DEFINITIONS.find((role) => role.code === 'owner')!;
    expect(owner.permissions).toContain('sales.create');
    expect(owner.permissions).toContain('settings.manage');
    expect(owner.permissions).not.toContain('platform.manage');
  });

  it('does not give cashiers product management or reports', () => {
    const cashier = ROLE_DEFINITIONS.find((role) => role.code === 'cashier')!;
    expect(cashier.permissions).toContain('sales.create');
    expect(cashier.permissions).toContain('refunds.create');
    expect(cashier.permissions).not.toContain('products.create');
    expect(cashier.permissions).not.toContain('reports.view');
  });
});
