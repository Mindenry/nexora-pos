import { allocateProportionally, applyBasisPoints, divRoundHalfUp, taxFromGross, taxFromNet } from './money';

export type Discount =
  | { type: 'percent'; basisPoints: number }
  | { type: 'amount'; satang: number };

export interface QuoteLineInput {
  key: string;
  variantId: string;
  productId?: string | null;
  categoryId?: string | null;
  name: string;
  sku: string;
  qty: number;
  unitPriceSatang: number;
  unitCostSatang: number;
  lineDiscount?: Discount | null;
}

export type PromotionKind =
  | 'order_percent'
  | 'order_amount'
  | 'product_percent'
  | 'category_percent';

export interface QuotePromotion {
  id: string;
  code: string;
  name: string;
  kind: PromotionKind;
  valueBp?: number | null;
  valueSatang?: number | null;
  targetIds?: string[] | null;
  minSubtotalSatang?: number | null;
  stackable: boolean;
  priority: number;
  couponCode?: string | null;
}

export interface QuoteInput {
  lines: QuoteLineInput[];
  orderDiscount?: Discount | null;
  couponCode?: string | null;
  promotions?: QuotePromotion[];
  taxRateBp: number;
  pricesIncludeTax: boolean;
  memberDiscountBp?: number | null;
  extraDiscountSatang?: number | null;
}

export interface QuoteLineResult {
  key: string;
  variantId: string;
  name: string;
  sku: string;
  qty: number;
  unitPriceSatang: number;
  unitCostSatang: number;
  grossSatang: number;
  discountSatang: number;
  netSatang: number;
  taxSatang: number;
  totalSatang: number;
  costSatang: number;
}

export interface AppliedPromotion {
  id: string;
  code: string;
  name: string;
  amountSatang: number;
}

export interface QuoteResult {
  lines: QuoteLineResult[];
  subtotalSatang: number;
  discountSatang: number;
  taxSatang: number;
  totalSatang: number;
  costSatang: number;
  itemCount: number;
  taxRateBp: number;
  pricesIncludeTax: boolean;
  appliedPromotions: AppliedPromotion[];
  ignoredCouponReason: string | null;
}

const MAX_DISCOUNT_BP = 10_000;

export function discountAmount(baseSatang: number, discount: Discount): number {
  if (discount.type === 'percent') {
    if (discount.basisPoints < 0 || discount.basisPoints > MAX_DISCOUNT_BP) {
      throw new RangeError('DISCOUNT_PERCENT_RANGE');
    }
    return Math.min(baseSatang, applyBasisPoints(baseSatang, discount.basisPoints));
  }
  if (discount.satang < 0) throw new RangeError('DISCOUNT_AMOUNT_RANGE');
  return Math.min(baseSatang, Math.floor(discount.satang));
}

function matchesTarget(promo: QuotePromotion, line: QuoteLineInput): boolean {
  if (promo.kind === 'product_percent') {
    return Boolean(promo.targetIds?.includes(line.productId ?? '__none__'));
  }
  if (promo.kind === 'category_percent') {
    return Boolean(promo.targetIds?.includes(line.categoryId ?? '__none__'));
  }
  return true;
}

/**
 * Server-authoritative cart pricing.
 * Pure, deterministic, integer-only. The same function powers the POS preview
 * and the checkout transaction (ADR-005).
 */
export function quoteCart(input: QuoteInput): QuoteResult {
  if (input.taxRateBp < 0 || input.taxRateBp > 10_000) {
    throw new RangeError('TAX_RATE_RANGE');
  }
  if (input.lines.length === 0) throw new RangeError('CART_EMPTY');

  const lines: QuoteLineResult[] = input.lines.map((line) => {
    if (!Number.isInteger(line.qty) || line.qty <= 0) throw new RangeError('QTY_INVALID');
    if (!Number.isInteger(line.unitPriceSatang) || line.unitPriceSatang < 0) {
      throw new RangeError('PRICE_INVALID');
    }
    if (!Number.isInteger(line.unitCostSatang) || line.unitCostSatang < 0) {
      throw new RangeError('COST_INVALID');
    }
    const gross = line.unitPriceSatang * line.qty;
    const discount = line.lineDiscount ? discountAmount(gross, line.lineDiscount) : 0;
    return {
      key: line.key,
      variantId: line.variantId,
      name: line.name,
      sku: line.sku,
      qty: line.qty,
      unitPriceSatang: line.unitPriceSatang,
      unitCostSatang: line.unitCostSatang,
      grossSatang: gross,
      discountSatang: discount,
      netSatang: gross - discount,
      taxSatang: 0,
      totalSatang: gross - discount,
      costSatang: line.unitCostSatang * line.qty,
    };
  });

  const subtotal = lines.reduce((sum, l) => sum + l.grossSatang, 0);
  const appliedPromotions: AppliedPromotion[] = [];
  let ignoredCouponReason: string | null = null;

  const promoList = [...(input.promotions ?? [])].sort((a, b) => b.priority - a.priority);
  let stopped = false;

  const applyPromo = (promo: QuotePromotion, requireCoupon: boolean): boolean => {
    if (requireCoupon && !promo.couponCode) return false;
    if (promo.minSubtotalSatang != null && subtotal < promo.minSubtotalSatang) return false;
    const eligible = lines.filter((l) => matchesTarget(promo, l));
    const eligibleNet = eligible.reduce((sum, l) => sum + l.netSatang, 0);
    if (eligibleNet <= 0) return false;

    if (promo.kind === 'product_percent' || promo.kind === 'category_percent') {
      const bp = promo.valueBp ?? 0;
      if (bp <= 0) return false;
      const parts = allocateProportionally(
        Math.min(eligibleNet, applyBasisPoints(eligibleNet, Math.min(bp, MAX_DISCOUNT_BP))),
        eligible.map((l) => l.netSatang),
      );
      let total = 0;
      eligible.forEach((line, i) => {
        const amount = parts[i] ?? 0;
        line.discountSatang += amount;
        line.netSatang -= amount;
        total += amount;
      });
      if (total <= 0) return false;
      appliedPromotions.push({ id: promo.id, code: promo.code, name: promo.name, amountSatang: total });
      return true;
    }
    return false;
  };

  // 1) Targeted (line-level) promotions, in priority order.
  for (const promo of promoList) {
    if (promo.kind !== 'product_percent' && promo.kind !== 'category_percent') continue;
    if (!promo.couponCode) {
      if (stopped) continue;
      const ok = applyPromo(promo, false);
      if (ok && !promo.stackable) stopped = true;
    }
  }

  // 2) Order-level discounts accumulated, then allocated across lines.
  let orderLevelTotal = 0;
  const remainingAfterTargeted = () => lines.reduce((sum, l) => sum + l.netSatang, 0);

  const addOrderLevel = (amount: number, promo?: QuotePromotion) => {
    const remaining = remainingAfterTargeted();
    const applied = Math.max(0, Math.min(remaining, Math.floor(amount)));
    if (applied <= 0) return 0;
    orderLevelTotal += applied;
    if (promo) {
      appliedPromotions.push({
        id: promo.id,
        code: promo.code,
        name: promo.name,
        amountSatang: applied,
      });
    }
    return applied;
  };

  let orderStopped = stopped;
  for (const promo of promoList) {
    if (promo.couponCode) continue;
    if (promo.kind !== 'order_percent' && promo.kind !== 'order_amount') continue;
    if (orderStopped) continue;
    if (promo.minSubtotalSatang != null && subtotal < promo.minSubtotalSatang) continue;
    const base = remainingAfterTargeted() - orderLevelTotal;
    const amount =
      promo.kind === 'order_percent'
        ? applyBasisPoints(base, Math.min(promo.valueBp ?? 0, MAX_DISCOUNT_BP))
        : (promo.valueSatang ?? 0);
    const applied = addOrderLevel(amount, promo);
    if (applied > 0 && !promo.stackable) orderStopped = true;
  }

  if (input.couponCode) {
    const coupon = promoList.find(
      (p) => p.couponCode && p.couponCode.toUpperCase() === input.couponCode!.toUpperCase(),
    );
    if (!coupon) {
      ignoredCouponReason = 'COUPON_NOT_FOUND';
    } else if (coupon.minSubtotalSatang != null && subtotal < coupon.minSubtotalSatang) {
      ignoredCouponReason = 'COUPON_MIN_SUBTOTAL';
    } else {
      const nonStackableApplied =
        appliedPromotions.length > 0 &&
        promoList.some(
          (p) => !p.stackable && appliedPromotions.some((a) => a.id === p.id),
        );
      if (nonStackableApplied || (appliedPromotions.length > 0 && !coupon.stackable)) {
        ignoredCouponReason = 'COUPON_NOT_STACKABLE';
      } else {
        const base = remainingAfterTargeted() - orderLevelTotal;
        const amount =
          coupon.kind === 'order_percent'
            ? applyBasisPoints(base, Math.min(coupon.valueBp ?? 0, MAX_DISCOUNT_BP))
            : coupon.kind === 'order_amount'
              ? (coupon.valueSatang ?? 0)
              : 0;
        const applied = addOrderLevel(amount, coupon);
        if (applied <= 0) ignoredCouponReason = 'COUPON_NO_BENEFIT';
      }
    }
  }

  if (input.orderDiscount) {
    const base = remainingAfterTargeted() - orderLevelTotal;
    addOrderLevel(discountAmount(base, input.orderDiscount));
  }

  if (input.memberDiscountBp && input.memberDiscountBp > 0) {
    const base = remainingAfterTargeted() - orderLevelTotal;
    addOrderLevel(applyBasisPoints(base, Math.min(input.memberDiscountBp, 5000)));
  }

  if (input.extraDiscountSatang && input.extraDiscountSatang > 0) {
    addOrderLevel(input.extraDiscountSatang);
  }

  // 3) Allocate order-level discount to lines proportionally.
  const weights = lines.map((l) => Math.max(0, l.netSatang));
  const allocation = allocateProportionally(orderLevelTotal, weights);
  lines.forEach((line, i) => {
    const part = allocation[i] ?? 0;
    line.discountSatang += part;
    line.netSatang -= part;
  });

  const netTotal = lines.reduce((sum, l) => sum + l.netSatang, 0);
  const tax =
    input.pricesIncludeTax
      ? taxFromGross(netTotal, input.taxRateBp)
      : taxFromNet(netTotal, input.taxRateBp);
  const total = input.pricesIncludeTax ? netTotal : netTotal + tax;

  // 4) Allocate tax to lines (largest remainder) so line tax sums to document tax.
  const taxParts = allocateProportionally(tax, lines.map((l) => l.netSatang));
  lines.forEach((line, i) => {
    line.taxSatang = taxParts[i] ?? 0;
    line.totalSatang = line.netSatang + (input.pricesIncludeTax ? 0 : line.taxSatang);
  });

  return {
    lines,
    subtotalSatang: subtotal,
    discountSatang: subtotal - netTotal,
    taxSatang: tax,
    totalSatang: total,
    costSatang: lines.reduce((sum, l) => sum + l.costSatang, 0),
    itemCount: lines.reduce((sum, l) => sum + l.qty, 0),
    taxRateBp: input.taxRateBp,
    pricesIncludeTax: input.pricesIncludeTax,
    appliedPromotions,
    ignoredCouponReason,
  };
}

/** Convenience: exact allocation helper re-exported for refund math. */
export { allocateProportionally, divRoundHalfUp };
