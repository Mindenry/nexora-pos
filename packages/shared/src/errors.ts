export type ErrorClass = 'VALIDATION' | 'AUTH' | 'CONFLICT' | 'DOMAIN' | 'INFRA' | 'DEVICE';

export interface ErrorDefinition {
  status: number;
  retryable: boolean;
  messageTh: string;
  messageEn: string;
}

export const ERROR_DEFINITIONS: Record<string, ErrorDefinition> = {
  VALIDATION_FAILED: { status: 422, retryable: false, messageTh: 'ข้อมูลไม่ถูกต้อง กรุณาตรวจสอบอีกครั้ง', messageEn: 'Some fields are invalid.' },
  VALIDATION_QTY_INVALID: { status: 422, retryable: false, messageTh: 'จำนวนสินค้าไม่ถูกต้อง', messageEn: 'Quantity is invalid.' },
  AUTH_REQUIRED: { status: 401, retryable: false, messageTh: 'กรุณาเข้าสู่ระบบ', messageEn: 'Please sign in.' },
  AUTH_INVALID_CREDENTIALS: { status: 401, retryable: false, messageTh: 'อีเมลหรือรหัสผ่านไม่ถูกต้อง', messageEn: 'Incorrect email or password.' },
  AUTH_PERMISSION_DENIED: { status: 403, retryable: false, messageTh: 'คุณไม่มีสิทธิ์ดำเนินการนี้', messageEn: 'You do not have permission for this action.' },
  AUTH_STORE_FORBIDDEN: { status: 403, retryable: false, messageTh: 'คุณไม่มีสิทธิ์เข้าถึงสาขานี้', messageEn: 'You do not have access to this store.' },
  AUTH_SESSION_EXPIRED: { status: 401, retryable: false, messageTh: 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่', messageEn: 'Your session has expired.' },
  AUTH_RATE_LIMITED: { status: 429, retryable: true, messageTh: 'ลองอีกครั้งในอีกสักครู่', messageEn: 'Too many attempts. Try again shortly.' },
  CONFLICT_OPERATION_REUSED: { status: 409, retryable: false, messageTh: 'รหัสคำสั่งซ้ำกับรายการอื่น', messageEn: 'This operation id was used with a different request.' },
  CONFLICT_DUPLICATE: { status: 409, retryable: false, messageTh: 'ข้อมูลซ้ำกับที่มีอยู่', messageEn: 'This record already exists.' },
  CONFLICT_VERSION: { status: 409, retryable: false, messageTh: 'ข้อมูลถูกแก้ไขโดยผู้อื่น กรุณาโหลดใหม่', messageEn: 'This record changed. Reload and try again.' },
  DOMAIN_SHIFT_NOT_OPEN: { status: 409, retryable: false, messageTh: 'ยังไม่ได้เปิดกะ กรุณาเปิดกะก่อนขาย', messageEn: 'No open shift. Open a shift before selling.' },
  DOMAIN_SHIFT_ALREADY_OPEN: { status: 409, retryable: false, messageTh: 'มีกะที่เปิดอยู่แล้ว', messageEn: 'A shift is already open.' },
  DOMAIN_SHIFT_CLOSED: { status: 409, retryable: false, messageTh: 'กะนี้ปิดแล้ว', messageEn: 'This shift is closed.' },
  DOMAIN_SHIFT_PENDING_PAYMENTS: { status: 409, retryable: false, messageTh: 'ยังมีการชำระเงินที่รอยืนยัน', messageEn: 'A payment is still awaiting confirmation.' },
  DOMAIN_INSUFFICIENT_STOCK: { status: 422, retryable: false, messageTh: 'สินค้าในสต๊อกไม่พอ', messageEn: 'Not enough stock for this item.' },
  DOMAIN_CART_EMPTY: { status: 422, retryable: false, messageTh: 'ตะกร้าสินค้าว่าง', messageEn: 'The cart is empty.' },
  DOMAIN_PAYMENT_MISMATCH: { status: 422, retryable: false, messageTh: 'ยอดชำระไม่ตรงกับยอดรวม', messageEn: 'Payment does not match the total.' },
  DOMAIN_PAYMENT_PENDING: { status: 409, retryable: false, messageTh: 'การชำระเงินยังไม่ได้รับการยืนยัน', messageEn: 'The payment is not confirmed yet.' },
  DOMAIN_PROMPTPAY_NOT_CONFIGURED: { status: 422, retryable: false, messageTh: 'ยังไม่ได้ตั้งค่าบัญชีพร้อมเพย์สำหรับรับเงิน', messageEn: 'No active PromptPay receiving account is configured.' },
  DOMAIN_PROMPTPAY_IDENTIFIER_INVALID: { status: 422, retryable: false, messageTh: 'หมายเลขพร้อมเพย์ไม่ถูกต้อง กรุณาตรวจสอบอีกครั้ง', messageEn: 'The PromptPay identifier is invalid.' },
  DOMAIN_PROMPTPAY_SESSION_STATE: { status: 409, retryable: false, messageTh: 'สถานะรายการพร้อมเพย์ไม่รองรับขั้นตอนนี้', messageEn: 'This PromptPay session is not in a valid state for that action.' },
  DOMAIN_PROMPTPAY_EXPIRED: { status: 409, retryable: false, messageTh: 'QR นี้หมดอายุแล้ว กรุณาสร้าง QR ใหม่', messageEn: 'This PromptPay QR has expired. Generate a new one.' },
  DOMAIN_PROMPTPAY_NOT_PAID: { status: 409, retryable: false, messageTh: 'ยังไม่ได้รับการยืนยันรับเงินสำหรับ QR นี้', messageEn: 'This PromptPay QR has not been confirmed as paid.' },
  DOMAIN_PROMPTPAY_AMOUNT_MISMATCH: { status: 422, retryable: false, messageTh: 'ยอดเงินพร้อมเพย์ไม่ตรงกับยอดขาย กรุณาสร้าง QR ใหม่', messageEn: 'The PromptPay amount does not match the sale total. Regenerate the QR.' },
  DOMAIN_PROMPTPAY_ALREADY_LINKED: { status: 409, retryable: false, messageTh: 'QR นี้ถูกใช้กับรายการขายอื่นแล้ว', messageEn: 'This PromptPay QR is already linked to another sale.' },
  DOMAIN_SALE_IMMUTABLE: { status: 409, retryable: false, messageTh: 'รายการขายที่ปิดแล้วแก้ไขไม่ได้', messageEn: 'A completed sale is immutable.' },
  DOMAIN_REFUND_EXCEEDS: { status: 422, retryable: false, messageTh: 'ยอดคืนเกินกว่าที่ซื้อหรือชำระไว้', messageEn: 'Refund exceeds the sold or captured amount.' },
  DOMAIN_TRANSFER_STATE: { status: 409, retryable: false, messageTh: 'สถานะการโอนไม่ถูกต้องสำหรับขั้นตอนนี้', messageEn: 'This transfer is not in a valid state for that action.' },
  DOMAIN_PURCHASE_STATE: { status: 409, retryable: false, messageTh: 'สถานะใบสั่งซื้อไม่ถูกต้องสำหรับขั้นตอนนี้', messageEn: 'This purchase order is not in a valid state for that action.' },
  DOMAIN_RECEIVE_EXCEEDS: { status: 422, retryable: false, messageTh: 'รับสินค้าเกินจำนวนที่สั่ง', messageEn: 'Receiving exceeds the ordered quantity.' },
  DOMAIN_COUPON_INVALID: { status: 422, retryable: false, messageTh: 'คูปองไม่ถูกต้องหรือหมดอายุ', messageEn: 'Coupon is invalid or expired.' },
  DOMAIN_POINTS_INSUFFICIENT: { status: 422, retryable: false, messageTh: 'คะแนนสะสมไม่เพียงพอ', messageEn: 'Not enough loyalty points.' },
  DOMAIN_LOYALTY_DISABLED: { status: 422, retryable: false, messageTh: 'ร้านนี้ยังไม่เปิดใช้การแลกคะแนน', messageEn: 'Loyalty redemption is disabled.' },
  DOMAIN_SUBSCRIPTION_INACTIVE: { status: 402, retryable: false, messageTh: 'การสมัครใช้งานไม่พร้อมใช้งาน', messageEn: 'The subscription is not active.' },
  DOMAIN_LAST_OWNER: { status: 409, retryable: false, messageTh: 'ต้องมีเจ้าของธุรกิจอย่างน้อยหนึ่งคน', messageEn: 'At least one owner must remain.' },
  DOMAIN_OFFLINE_DISABLED: { status: 422, retryable: false, messageTh: 'ร้านนี้ไม่อนุญาตให้ขายแบบออฟไลน์', messageEn: 'Offline sales are disabled for this store.' },
  NOT_FOUND: { status: 404, retryable: false, messageTh: 'ไม่พบข้อมูล', messageEn: 'Not found.' },
  INFRA_DB_UNAVAILABLE: { status: 503, retryable: true, messageTh: 'ระบบฐานข้อมูลไม่พร้อมใช้งาน', messageEn: 'Database unavailable.' },
  INFRA_INTERNAL: { status: 500, retryable: true, messageTh: 'เกิดข้อผิดพลาดภายในระบบ', messageEn: 'Internal error.' },
};

export class NexoraError extends Error {
  readonly code: string;
  readonly status: number;
  readonly retryable: boolean;
  readonly details?: unknown;
  readonly messageTh: string;
  readonly messageEn: string;

  constructor(code: keyof typeof ERROR_DEFINITIONS | string, details?: unknown) {
    const def = ERROR_DEFINITIONS[code] ?? ERROR_DEFINITIONS.INFRA_INTERNAL!;
    super(code);
    this.name = 'NexoraError';
    this.code = code;
    this.status = def.status;
    this.retryable = def.retryable;
    this.messageTh = def.messageTh;
    this.messageEn = def.messageEn;
    this.details = details;
  }
}
