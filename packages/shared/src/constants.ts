export const APP_NAME = 'NEXORA POS';
export const DEFAULT_VAT_RATE_BP = 700;

export const PAYMENT_METHOD_TYPES = ['cash', 'card', 'qr', 'transfer', 'other'] as const;
export type PaymentMethodType = (typeof PAYMENT_METHOD_TYPES)[number];

export const SALE_STATUSES = ['completed', 'voided', 'partially_refunded', 'refunded'] as const;
export const PAYMENT_STATUSES = [
  'pending',
  'authorized',
  'paid',
  'failed',
  'cancelled',
  'partially_refunded',
  'refunded',
] as const;
export const PURCHASE_STATUSES = [
  'draft',
  'submitted',
  'approved',
  'partially_received',
  'received',
  'closed',
  'cancelled',
] as const;
export const TRANSFER_STATUSES = ['draft', 'dispatched', 'received', 'cancelled'] as const;
export const CUSTOMER_TIERS = ['standard', 'silver', 'gold', 'platinum'] as const;

export const MOVEMENT_TYPES = [
  'purchase_receipt',
  'sales_deduction',
  'sales_return',
  'purchase_return',
  'transfer_out',
  'transfer_in',
  'adjustment_increase',
  'adjustment_decrease',
  'stock_count',
  'initial_load',
] as const;
export type MovementType = (typeof MOVEMENT_TYPES)[number];

export const MOVEMENT_LABELS: Record<MovementType, { th: string; en: string }> = {
  purchase_receipt: { th: 'รับสินค้าจากผู้จำหน่าย', en: 'Purchase receipt' },
  sales_deduction: { th: 'ขายสินค้า', en: 'Sales deduction' },
  sales_return: { th: 'รับคืนสินค้า', en: 'Sales return' },
  purchase_return: { th: 'คืนสินค้าให้ผู้จำหน่าย', en: 'Purchase return' },
  transfer_out: { th: 'โอนออก', en: 'Transfer out' },
  transfer_in: { th: 'โอนเข้า', en: 'Transfer in' },
  adjustment_increase: { th: 'ปรับเพิ่ม', en: 'Adjustment increase' },
  adjustment_decrease: { th: 'ปรับลด', en: 'Adjustment decrease' },
  stock_count: { th: 'ปรับจากตรวจนับ', en: 'Stock count correction' },
  initial_load: { th: 'สต๊อกเริ่มต้น', en: 'Initial load' },
};

export const TIER_THRESHOLDS: Record<string, number> = {
  standard: 0,
  silver: 5_000_00,
  gold: 25_000_00,
  platinum: 100_000_00,
};

export const LOW_STOCK_DEFAULT = 5;
