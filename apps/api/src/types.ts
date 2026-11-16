import type { DbClient } from '@nexora/db';

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  locale: 'th' | 'en';
  isPlatformAdmin: boolean;
  tenantId: string | null;
}

export interface EmployeeContext {
  id: string;
  displayName: string;
  defaultStoreId: string | null;
  roleCodes: string[];
  tenantScope: boolean;
  storeIds: string[];
}

export interface StoreContext {
  id: string;
  code: string;
  name: string;
  address: string;
  phone: string;
  timezone: string;
  taxId: string;
  receiptPrefix: string;
  isActive: boolean;
}

export interface TenantContext {
  id: string;
  name: string;
  slug: string;
  status: 'trial' | 'active' | 'suspended';
  onboardedAt: string | null;
  isDemo: boolean;
  planCode: string;
  subscriptionStatus: string;
  features: Record<string, boolean>;
  maxStores: number;
  maxEmployees: number;
}

export interface BusinessContext {
  id: string;
  name: string;
  legalName: string;
  taxId: string;
  address: string;
  phone: string;
  email: string;
  currency: string;
  timezone: string;
  vatRateBp: number;
  pricesIncludeTax: boolean;
  receiptPrefix: string;
  receiptFooter: string;
  receiptAccent: string;
  receiptLogoUrl: string;
  receiptHeaderNote: string;
  receiptShowCashier: boolean;
  receiptShowTaxId: boolean;
  receiptPaperWidth: '80mm' | 'a4';
  loyaltyEarnPerBaht: number;
  pointValueSatang: number;
  loyaltyRedemptionEnabled: boolean;
  offlineCashEnabled: boolean;
  discountLimitBp: number;
  allowNegativeStock: boolean;
}

export interface RequestContext {
  correlationId: string;
  sessionId: string;
  user: SessionUser;
  employee: EmployeeContext | null;
  tenant: TenantContext | null;
  business: BusinessContext | null;
  store: StoreContext | null;
  stores: StoreContext[];
  permissions: Set<string>;
  withDb: <T>(fn: (client: DbClient) => Promise<T>) => Promise<T>;
  withPlatform: <T>(fn: (client: DbClient) => Promise<T>) => Promise<T>;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      ctx: RequestContext;
    }
  }
}

export {};
