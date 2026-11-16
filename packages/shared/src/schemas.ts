import { z } from 'zod';

export const uuidSchema = z.string().uuid('VALIDATION_UUID');
export const dateStringSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'VALIDATION_DATE')
  .refine((v) => {
    const d = new Date(`${v}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
  }, 'VALIDATION_DATE');

const moneySchema = z.number().int().min(0).max(100_000_000_000);
const qtySchema = z.number().int().min(1).max(9_999);

export const discountSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('percent'), basisPoints: z.number().int().min(0).max(10_000) }),
  z.object({ type: z.literal('amount'), satang: moneySchema }),
]);
export type DiscountInput = z.infer<typeof discountSchema>;

export const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  search: z.string().trim().max(120).optional(),
  sort: z.string().trim().max(40).optional(),
  order: z.enum(['asc', 'desc']).default('desc'),
  includeInactive: z.coerce.boolean().optional(),
});
export type ListQuery = z.infer<typeof listQuerySchema>;

// ── Auth ────────────────────────────────────────────────────────────────────
export const emailSchema = z.string().trim().toLowerCase().email('VALIDATION_EMAIL').max(254);
export const passwordSchema = z
  .string()
  .min(10, 'VALIDATION_PASSWORD_MIN')
  .max(200, 'VALIDATION_PASSWORD_MAX');

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(200),
  remember: z.boolean().optional().default(false),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const registerSchema = z.object({
  businessName: z.string().trim().min(2).max(120),
  ownerName: z.string().trim().min(2).max(120),
  email: emailSchema,
  password: passwordSchema,
  storeName: z.string().trim().min(2).max(120),
  phone: z.string().trim().max(40).optional().or(z.literal('')),
  currency: z.string().length(3).default('THB'),
  timezone: z.string().max(60).default('Asia/Bangkok'),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: passwordSchema,
});

export const updateProfileSchema = z.object({
  name: z.string().trim().min(2).max(120),
  locale: z.enum(['th', 'en']),
});

// ── Products ────────────────────────────────────────────────────────────────
export const productStatusSchema = z.enum(['active', 'draft', 'archived']);

export const productVariantInputSchema = z.object({
  id: uuidSchema.optional(),
  name: z.string().trim().min(1).max(160),
  sku: z.string().trim().max(60).optional().or(z.literal('')),
  barcode: z.string().trim().max(60).optional().or(z.literal('')),
  priceSatang: moneySchema,
  costSatang: moneySchema,
  attributes: z.record(z.string().max(40), z.string().max(80)).optional(),
  isDefault: z.boolean().optional(),
});

export const productInputSchema = z.object({
  name: z.string().trim().min(1).max(160),
  sku: z.string().trim().max(60).optional().or(z.literal('')),
  barcode: z.string().trim().max(60).optional().or(z.literal('')),
  description: z.string().max(2000).optional().or(z.literal('')),
  categoryId: uuidSchema.nullish(),
  brandId: uuidSchema.nullish(),
  unitId: uuidSchema.nullish(),
  imageUrl: z
    .string()
    .max(500)
    .refine(
      (value) => value === '' || value.startsWith('/') || /^https?:\/\//i.test(value),
      'VALIDATION_IMAGE_URL',
    )
    .optional()
    .or(z.literal('')),
  type: z.enum(['simple', 'variable']).default('simple'),
  costSatang: moneySchema,
  priceSatang: moneySchema,
  compareAtSatang: moneySchema.optional(),
  taxRateBp: z.number().int().min(0).max(5000).optional(),
  trackInventory: z.boolean().default(true),
  reorderPoint: z.number().int().min(0).max(1_000_000).default(5),
  status: productStatusSchema.default('active'),
  variants: z.array(productVariantInputSchema).max(100).optional(),
});
export type ProductInput = z.infer<typeof productInputSchema>;

export const categoryInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  parentId: uuidSchema.nullish(),
  sortOrder: z.number().int().min(0).max(9999).default(0),
});
export const brandInputSchema = z.object({ name: z.string().trim().min(1).max(80) });
export const unitInputSchema = z.object({
  code: z.string().trim().min(1).max(10),
  name: z.string().trim().min(1).max(40),
});

// ── Checkout ────────────────────────────────────────────────────────────────
export const checkoutLineSchema = z.object({
  variantId: uuidSchema,
  qty: qtySchema,
  lineDiscount: discountSchema.nullish(),
});
export type CheckoutLineInput = z.infer<typeof checkoutLineSchema>;

export const checkoutPaymentSchema = z.object({
  method: z.string().trim().min(1).max(40),
  amountSatang: moneySchema,
  tenderedSatang: moneySchema.optional(),
  reference: z.string().trim().max(120).optional().or(z.literal('')),
  promptpaySessionId: uuidSchema.optional(),
});
export type CheckoutPaymentInput = z.infer<typeof checkoutPaymentSchema>;

export const checkoutSchema = z.object({
  operationId: uuidSchema,
  items: z.array(checkoutLineSchema).min(1).max(200),
  orderDiscount: discountSchema.nullish(),
  couponCode: z.string().trim().max(40).optional().or(z.literal('')),
  customerId: uuidSchema.nullish(),
  payments: z.array(checkoutPaymentSchema).min(1).max(10),
  redeemPoints: z.number().int().min(0).max(1_000_000).optional(),
  note: z.string().max(500).optional().or(z.literal('')),
  occurredAt: z.string().datetime({ offset: true }).optional(),
  deviceId: z.string().max(80).optional(),
  offline: z.boolean().optional(),
});
export type CheckoutInput = z.infer<typeof checkoutSchema>;

export const quoteSchema = z.object({
  items: z.array(checkoutLineSchema).min(1).max(200),
  orderDiscount: discountSchema.nullish(),
  couponCode: z.string().trim().max(40).optional().or(z.literal('')),
  customerId: uuidSchema.nullish(),
  memberDiscountBp: z.number().int().min(0).max(5000).optional(),
});
export type QuoteRequestInput = z.infer<typeof quoteSchema>;

// ── PromptPay ───────────────────────────────────────────────────────────────
export const promptpayAccountInputSchema = z.object({
  identifierType: z.enum(['mobile', 'national_id']),
  identifier: z.string().trim().min(1).max(30),
  displayName: z.string().trim().min(1).max(80),
  isDefault: z.boolean().optional(),
  isActive: z.boolean().optional(),
});
export type PromptPayAccountInput = z.infer<typeof promptpayAccountInputSchema>;

export const promptpayAccountUpdateSchema = z.object({
  identifierType: z.enum(['mobile', 'national_id']).optional(),
  identifier: z.string().trim().min(1).max(30).optional(),
  displayName: z.string().trim().min(1).max(80).optional(),
  isDefault: z.boolean().optional(),
  isActive: z.boolean().optional(),
});
export type PromptPayAccountUpdate = z.infer<typeof promptpayAccountUpdateSchema>;

export const promptpaySessionCreateSchema = z.object({
  operationId: uuidSchema,
  items: z.array(checkoutLineSchema).min(1).max(200),
  orderDiscount: discountSchema.nullish(),
  couponCode: z.string().trim().max(40).optional().or(z.literal('')),
  customerId: uuidSchema.nullish(),
  redeemPoints: z.number().int().min(0).max(1_000_000).optional(),
  accountId: uuidSchema.optional(),
  amountSatang: moneySchema.optional(),
  expiresInSeconds: z.number().int().min(60).max(900).optional(),
});
export type PromptPaySessionCreateInput = z.infer<typeof promptpaySessionCreateSchema>;

export const promptpayConfirmSchema = z.object({
  receivedAmountSatang: moneySchema.optional(),
  reference: z.string().trim().max(120).optional().or(z.literal('')),
  note: z.string().trim().max(500).optional().or(z.literal('')),
  overrideExpired: z.boolean().optional(),
});
export type PromptPayConfirmInput = z.infer<typeof promptpayConfirmSchema>;

export const promptpayCancelSchema = z.object({
  reason: z.string().trim().max(300).optional().or(z.literal('')),
});
export type PromptPayCancelInput = z.infer<typeof promptpayCancelSchema>;

export const promptpaySessionQuerySchema = listQuerySchema.extend({
  status: z.enum(['pending', 'paid', 'cancelled', 'expired', 'failed', 'refunded']).optional(),
  from: dateStringSchema.optional(),
  to: dateStringSchema.optional(),
  review: z.coerce.boolean().optional(),
});

export const paymentProviderUpdateSchema = z.object({
  displayName: z.string().trim().min(1).max(80).optional(),
  autoConfirm: z.boolean().optional(),
  isActive: z.boolean().optional(),
});
export type PaymentProviderUpdate = z.infer<typeof paymentProviderUpdateSchema>;

// ── Shifts & cash ───────────────────────────────────────────────────────────
export const openShiftSchema = z.object({
  openingCashSatang: moneySchema,
  terminalName: z.string().trim().max(80).optional(),
});
export const closeShiftSchema = z.object({
  countedCashSatang: moneySchema,
  note: z.string().max(500).optional().or(z.literal('')),
});
export const cashMovementSchema = z.object({
  operationId: uuidSchema,
  type: z.enum(['cash_in', 'cash_out', 'safe_drop']),
  amountSatang: z.number().int().min(1).max(100_000_000),
  reason: z.string().trim().min(2).max(200),
});

// ── Refunds ─────────────────────────────────────────────────────────────────
export const refundSchema = z.object({
  operationId: uuidSchema,
  saleId: uuidSchema,
  items: z
    .array(z.object({ saleItemId: uuidSchema, qty: z.number().int().min(1).max(9_999) }))
    .min(1)
    .max(200),
  reason: z.string().trim().min(3).max(300),
  restock: z.boolean().default(true),
  method: z.string().trim().max(40).optional(),
});
export type RefundInput = z.infer<typeof refundSchema>;

export const voidSaleSchema = z.object({
  operationId: uuidSchema,
  reason: z.string().trim().min(3).max(300),
});
export type VoidSaleInput = z.infer<typeof voidSaleSchema>;

// ── Inventory ───────────────────────────────────────────────────────────────
export const stockAdjustSchema = z.object({
  operationId: uuidSchema,
  variantId: uuidSchema,
  direction: z.enum(['increase', 'decrease']),
  qty: qtySchema,
  reason: z.string().trim().min(3).max(200),
});
export const transferSchema = z.object({
  operationId: uuidSchema,
  toStoreId: uuidSchema,
  items: z.array(z.object({ variantId: uuidSchema, qty: qtySchema })).min(1).max(100),
  note: z.string().max(300).optional().or(z.literal('')),
});
export const receiveTransferSchema = z.object({
  operationId: uuidSchema,
  items: z
    .array(z.object({ transferItemId: uuidSchema, qty: z.number().int().min(1).max(9_999) }))
    .min(1)
    .max(100),
});
export const stockCountSchema = z.object({
  operationId: uuidSchema,
  note: z.string().max(300).optional().or(z.literal('')),
  items: z
    .array(z.object({ variantId: uuidSchema, countedQty: z.number().int().min(0).max(1_000_000) }))
    .min(1)
    .max(500),
});

// ── Purchasing ──────────────────────────────────────────────────────────────
export const supplierInputSchema = z.object({
  name: z.string().trim().min(1).max(160),
  code: z.string().trim().max(40).optional().or(z.literal('')),
  contactName: z.string().trim().max(120).optional().or(z.literal('')),
  phone: z.string().trim().max(40).optional().or(z.literal('')),
  email: z.string().trim().email('VALIDATION_EMAIL').max(254).optional().or(z.literal('')),
  address: z.string().max(500).optional().or(z.literal('')),
  taxId: z.string().trim().max(20).optional().or(z.literal('')),
  notes: z.string().max(500).optional().or(z.literal('')),
});
export type SupplierInput = z.infer<typeof supplierInputSchema>;

export const purchaseOrderSchema = z.object({
  operationId: uuidSchema,
  supplierId: uuidSchema,
  expectedDate: dateStringSchema.optional(),
  notes: z.string().max(500).optional().or(z.literal('')),
  items: z
    .array(
      z.object({
        variantId: uuidSchema,
        qty: qtySchema,
        unitCostSatang: moneySchema,
      }),
    )
    .min(1)
    .max(200),
});
export type PurchaseOrderInput = z.infer<typeof purchaseOrderSchema>;

export const receivePurchaseSchema = z.object({
  operationId: uuidSchema,
  note: z.string().max(300).optional().or(z.literal('')),
  items: z
    .array(
      z.object({
        poItemId: uuidSchema,
        qty: z.number().int().min(1).max(100_000),
        unitCostSatang: moneySchema.optional(),
      }),
    )
    .min(1)
    .max(200),
});

export const supplierPaymentSchema = z.object({
  operationId: uuidSchema,
  amountSatang: z.number().int().min(1).max(1_000_000_000),
  method: z.string().max(40).default('transfer'),
  reference: z.string().max(120).optional().or(z.literal('')),
  paidAt: z.string().datetime({ offset: true }).optional(),
});

// ── Customers & promotions ──────────────────────────────────────────────────
export const customerInputSchema = z.object({
  name: z.string().trim().min(1).max(160),
  phone: z.string().trim().max(30).optional().or(z.literal('')),
  email: z.string().trim().email('VALIDATION_EMAIL').max(254).optional().or(z.literal('')),
  address: z.string().max(500).optional().or(z.literal('')),
  taxId: z.string().trim().max(20).optional().or(z.literal('')),
  birthday: dateStringSchema.optional().or(z.literal('')),
  consentMarketing: z.boolean().default(false),
  notes: z.string().max(500).optional().or(z.literal('')),
});
export type CustomerInput = z.infer<typeof customerInputSchema>;

export const promotionInputSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    code: z.string().trim().toUpperCase().max(40).optional().or(z.literal('')),
    kind: z.enum(['order_percent', 'order_amount', 'product_percent', 'category_percent']),
    valueBp: z.number().int().min(0).max(10_000).optional(),
    valueSatang: moneySchema.optional(),
    targetIds: z.array(uuidSchema).max(100).default([]),
    minSubtotalSatang: moneySchema.default(0),
    startsAt: z.string().datetime({ offset: true }).optional().or(z.literal('')),
    endsAt: z.string().datetime({ offset: true }).optional().or(z.literal('')),
    usageLimit: z.number().int().min(0).max(1_000_000).optional(),
    stackable: z.boolean().default(false),
    priority: z.number().int().min(0).max(1000).default(100),
    isActive: z.boolean().default(true),
    couponEnabled: z.boolean().default(false),
  })
  .superRefine((val, ctx) => {
    if (val.kind.endsWith('_percent') && (!val.valueBp || val.valueBp <= 0)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['valueBp'], message: 'PROMO_VALUE_REQUIRED' });
    }
    if (val.kind === 'order_amount' && (!val.valueSatang || val.valueSatang <= 0)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['valueSatang'], message: 'PROMO_VALUE_REQUIRED' });
    }
    if ((val.kind === 'product_percent' || val.kind === 'category_percent') && val.targetIds.length === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['targetIds'], message: 'PROMO_TARGET_REQUIRED' });
    }
  });
export type PromotionInput = z.infer<typeof promotionInputSchema>;

// ── People, stores, settings ────────────────────────────────────────────────
export const employeeInputSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: emailSchema,
  phone: z.string().trim().max(40).optional().or(z.literal('')),
  password: passwordSchema.optional(),
  roleCode: z.string().trim().min(1).max(40),
  storeIds: z.array(uuidSchema).min(1).max(50),
  employeeCode: z.string().trim().max(40).optional().or(z.literal('')),
});
export type EmployeeInput = z.infer<typeof employeeInputSchema>;

export const employeeUpdateSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  phone: z.string().trim().max(40).optional().or(z.literal('')),
  roleCode: z.string().trim().min(1).max(40).optional(),
  storeIds: z.array(uuidSchema).min(1).max(50).optional(),
  status: z.enum(['active', 'suspended']).optional(),
  newPassword: passwordSchema.optional(),
});

export const storeInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  code: z.string().trim().min(1).max(20),
  address: z.string().max(500).optional().or(z.literal('')),
  phone: z.string().trim().max(40).optional().or(z.literal('')),
  timezone: z.string().max(60).default('Asia/Bangkok'),
  taxId: z.string().trim().max(20).optional().or(z.literal('')),
  receiptPrefix: z.string().trim().max(10).default('R'),
  isActive: z.boolean().default(true),
});
export type StoreInput = z.infer<typeof storeInputSchema>;

export const businessSettingsSchema = z.object({
  name: z.string().trim().min(1).max(160).optional(),
  legalName: z.string().trim().max(200).optional().or(z.literal('')),
  taxId: z.string().trim().max(20).optional().or(z.literal('')),
  address: z.string().max(500).optional().or(z.literal('')),
  phone: z.string().trim().max(40).optional().or(z.literal('')),
  email: z.string().trim().max(254).optional().or(z.literal('')),
  currency: z.string().length(3).optional(),
  timezone: z.string().max(60).optional(),
  vatRateBp: z.number().int().min(0).max(5000).optional(),
  pricesIncludeTax: z.boolean().optional(),
  receiptFooter: z.string().max(500).optional().or(z.literal('')),
  receiptPrefix: z.string().trim().max(10).optional(),
  receiptAccent: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/, 'VALIDATION_COLOR')
    .optional(),
  receiptLogoUrl: z.string().max(500).optional().or(z.literal('')),
  receiptHeaderNote: z.string().max(200).optional().or(z.literal('')),
  receiptShowCashier: z.boolean().optional(),
  receiptShowTaxId: z.boolean().optional(),
  receiptPaperWidth: z.enum(['80mm', 'a4']).optional(),
  loyaltyEarnPerBaht: z.number().int().min(0).max(1000).optional(),
  pointValueSatang: z.number().int().min(0).max(100_000).optional(),
  loyaltyRedemptionEnabled: z.boolean().optional(),
  offlineCashEnabled: z.boolean().optional(),
  discountLimitBp: z.number().int().min(0).max(10_000).optional(),
});
export type BusinessSettingsInput = z.infer<typeof businessSettingsSchema>;

export const paymentMethodInputSchema = z.object({
  code: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(80),
  type: z.enum(['cash', 'card', 'qr', 'transfer', 'other']),
  requiresReference: z.boolean().default(false),
  opensDrawer: z.boolean().default(false),
  isActive: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(999).default(0),
});

export const platformTenantUpdateSchema = z.object({
  status: z.enum(['active', 'suspended', 'trial']).optional(),
  planCode: z.string().max(40).optional(),
  featureOverrides: z.record(z.string(), z.boolean()).optional(),
});

export const planInputSchema = z.object({
  code: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(80),
  priceSatang: moneySchema,
  interval: z.enum(['monthly', 'yearly']).default('monthly'),
  features: z.record(z.string(), z.boolean()).default({}),
  maxStores: z.number().int().min(1).max(1000),
  maxEmployees: z.number().int().min(1).max(100_000),
  isActive: z.boolean().default(true),
});

export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}
