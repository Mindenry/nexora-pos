import { api, qs } from './api';

export type PromptPayIdentifierType = 'mobile' | 'national_id';
export type PromptPayStatus =
  | 'pending'
  | 'paid'
  | 'cancelled'
  | 'expired'
  | 'failed'
  | 'refunded';

export interface PromptPayAccount {
  id: string;
  identifierType: PromptPayIdentifierType;
  maskedIdentifier: string;
  displayName: string;
  isDefault: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PromptPaySession {
  id: string;
  reference: string;
  status: PromptPayStatus;
  amountSatang: number;
  currency: string;
  expiresAt: string;
  createdAt: string;
  paidAt: string | null;
  cancelledAt: string | null;
  failureReason: string;
  account: {
    id: string;
    displayName: string;
    identifierType: PromptPayIdentifierType;
    maskedIdentifier: string;
  };
  sale: { id: string; number: string } | null;
  verifiedBy: { id: string; name: string } | null;
  verification: {
    id: string;
    verificationMethod: string;
    reference: string;
    provider: string;
    verifiedAt: string;
    metadata: Record<string, unknown>;
  } | null;
  qr: { pngDataUrl: string; svg: string; payload?: string } | null;
  verificationMode: {
    mode: 'manual' | 'automatic';
    autoConfirm: boolean;
    displayName: string | null;
  };
  audit: Array<{
    id: string;
    action: string;
    actorName: string | null;
    metadata: Record<string, unknown>;
    createdAt: string;
  }>;
}

export interface PromptPaySessionListRow {
  id: string;
  reference: string;
  status: PromptPayStatus;
  amountSatang: number;
  currency: string;
  createdAt: string;
  expiresAt: string;
  paidAt: string | null;
  accountName: string;
  identifierType: PromptPayIdentifierType;
  maskedIdentifier: string;
  saleId: string | null;
  saleNumber: string | null;
  verifierName: string | null;
}

export interface PromptPayListMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  summary: {
    count: number;
    paidCount: number;
    paidSatang: number;
    pendingCount: number;
  };
}

export interface PaymentProviderConfig {
  id: string;
  provider: string;
  displayName: string;
  publicId: string;
  webhookPath: string;
  isActive: boolean;
  autoConfirm: boolean;
  lastEventAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PaymentProviderEvent {
  id: string;
  eventId: string;
  status: 'processed' | 'already_paid' | 'ignored' | 'rejected';
  reason: string;
  amountSatang: number | null;
  reference: string;
  createdAt: string;
}

export interface PromptPaySessionCreateBody {
  operationId: string;
  items: Array<{
    variantId: string;
    qty: number;
    lineDiscount?: { type: 'percent'; basisPoints: number } | { type: 'amount'; satang: number } | null;
  }>;
  orderDiscount?: { type: 'percent'; basisPoints: number } | { type: 'amount'; satang: number } | null;
  couponCode?: string;
  customerId?: string | null;
  redeemPoints?: number;
  accountId?: string;
  amountSatang?: number;
  expiresInSeconds?: number;
}

export const promptPayApi = {
  listAccounts: (includeInactive = false) =>
    api<PromptPayAccount[]>(`/promptpay/accounts${qs({ includeInactive })}`),
  createAccount: (body: {
    identifierType: PromptPayIdentifierType;
    identifier: string;
    displayName: string;
    isDefault?: boolean;
    isActive?: boolean;
  }) => api<PromptPayAccount>('/promptpay/accounts', { method: 'POST', body }),
  updateAccount: (
    id: string,
    body: Partial<{
      identifierType: PromptPayIdentifierType;
      identifier: string;
      displayName: string;
      isDefault: boolean;
      isActive: boolean;
    }>,
  ) => api<PromptPayAccount>(`/promptpay/accounts/${id}`, { method: 'PATCH', body }),
  deleteAccount: (id: string) =>
    api<null>(`/promptpay/accounts/${id}`, { method: 'DELETE' }),
  setDefault: (id: string) =>
    api<PromptPayAccount>(`/promptpay/accounts/${id}/default`, { method: 'POST' }),
  getStaticQr: (id: string) =>
    api<{
      account: PromptPayAccount;
      generatedAt: string;
      pngDataUrl: string;
      svg: string;
      payload?: string;
    }>(`/promptpay/accounts/${id}/static-qr`),
  getProvider: () => api<PaymentProviderConfig | null>('/promptpay/provider'),
  createProvider: (body: { displayName?: string; autoConfirm?: boolean; isActive?: boolean }) =>
    api<{ config: PaymentProviderConfig; secret: string }>('/promptpay/provider', {
      method: 'POST',
      body,
    }),
  updateProvider: (body: { displayName?: string; autoConfirm?: boolean; isActive?: boolean }) =>
    api<PaymentProviderConfig>('/promptpay/provider', { method: 'PATCH', body }),
  rotateProvider: () =>
    api<{ config: PaymentProviderConfig; secret: string }>('/promptpay/provider/rotate', {
      method: 'POST',
    }),
  deleteProvider: () => api<null>('/promptpay/provider', { method: 'DELETE' }),
  listProviderEvents: () => api<PaymentProviderEvent[]>('/promptpay/provider/events?limit=20'),
  listSessions: (params: {
    page?: number;
    pageSize?: number;
    status?: PromptPayStatus | '';
    search?: string;
    from?: string;
    to?: string;
  }) =>
    api<PromptPaySessionListRow[]>(
      `/promptpay/sessions${qs({
        page: params.page ?? 1,
        pageSize: params.pageSize ?? 20,
        status: params.status || undefined,
        search: params.search || undefined,
        from: params.from || undefined,
        to: params.to || undefined,
      })}`,
    ),
  createSession: (body: PromptPaySessionCreateBody) =>
    api<PromptPaySession>('/promptpay/sessions', { method: 'POST', body }),
  getSession: (id: string) => api<PromptPaySession>(`/promptpay/sessions/${id}`),
  confirmSession: (
    id: string,
    body: {
      receivedAmountSatang?: number;
      reference?: string;
      note?: string;
      overrideExpired?: boolean;
    },
  ) =>
    api<PromptPaySession>(`/promptpay/sessions/${id}/confirm`, {
      method: 'POST',
      body,
    }),
  cancelSession: (id: string, reason?: string) =>
    api<PromptPaySession>(`/promptpay/sessions/${id}/cancel`, {
      method: 'POST',
      body: { reason: reason ?? '' },
    }),
  regenerateSession: (id: string) =>
    api<PromptPaySession>(`/promptpay/sessions/${id}/regenerate`, { method: 'POST' }),
};

export function identifierErrorMessage(reason: string | undefined, locale: 'th' | 'en'): string {
  const messages: Record<string, { th: string; en: string }> = {
    empty: { th: 'กรุณากรอกหมายเลขพร้อมเพย์', en: 'Enter a PromptPay identifier.' },
    length: { th: 'จำนวนหลักไม่ถูกต้อง', en: 'The number of digits is incorrect.' },
    prefix: {
      th: 'เบอร์มือถือต้องขึ้นต้นด้วย 06, 08 หรือ 09',
      en: 'A Thai mobile number must start with 06, 08 or 09.',
    },
    checksum: {
      th: 'เลขประจำตัวประชาชนไม่ผ่านการตรวจสอบหลักสุดท้าย',
      en: 'The national ID checksum is invalid.',
    },
    characters: {
      th: 'กรุณาใช้เฉพาะตัวเลข ช่องว่าง หรือขีด',
      en: 'Use digits, spaces or dashes only.',
    },
  };
  const item = messages[reason ?? ''] ?? {
    th: 'หมายเลขพร้อมเพย์ไม่ถูกต้อง',
    en: 'The PromptPay identifier is invalid.',
  };
  return locale === 'th' ? item.th : item.en;
}

export function identifierTypeLabel(type: PromptPayIdentifierType, locale: 'th' | 'en'): string {
  if (type === 'national_id') {
    return locale === 'th' ? 'เลขประจำตัวประชาชน' : 'National ID';
  }
  return locale === 'th' ? 'เบอร์โทรศัพท์มือถือ' : 'Mobile number';
}
