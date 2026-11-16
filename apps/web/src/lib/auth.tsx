import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, setStoredStoreId, getStoredStoreId, ApiError } from './api';
import type { Locale } from './i18n';

export interface Me {
  user: {
    id: string;
    email: string;
    name: string;
    locale: Locale;
    isPlatformAdmin: boolean;
    tenantId: string | null;
  };
  tenant: {
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
  } | null;
  employee: {
    id: string;
    displayName: string;
    defaultStoreId: string | null;
    roleCodes: string[];
    tenantScope: boolean;
    storeIds: string[];
  } | null;
  business: {
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
    loyaltyEarnPerBaht: number;
    offlineCashEnabled: boolean;
    discountLimitBp: number;
    allowNegativeStock: boolean;
  } | null;
  store: {
    id: string;
    code: string;
    name: string;
    address: string;
    phone: string;
    timezone: string;
    taxId: string;
    receiptPrefix: string;
    isActive: boolean;
  } | null;
  stores: Array<{
    id: string;
    code: string;
    name: string;
    address: string;
    phone: string;
    timezone: string;
    taxId: string;
    receiptPrefix: string;
    isActive: boolean;
  }>;
  permissions: string[];
  roles: string[];
}

interface AuthContextValue {
  me: Me | null;
  isLoading: boolean;
  error: unknown;
  storeId: string | null;
  setStore: (id: string) => void;
  refresh: () => Promise<void>;
  login: (payload: Me) => void;
  logout: () => Promise<void>;
  can: (permission: string) => boolean;
  isPlatformAdmin: boolean;
  isDemo: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [storeId, setStoreIdState] = useState<string | null>(getStoredStoreId());

  const query = useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      try {
        const result = await api<Me>('/auth/me');
        return result.data;
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) return null;
        throw error;
      }
    },
    retry: false,
    staleTime: 30_000,
  });

  const me = query.data ?? null;

  useEffect(() => {
    const handler = () => {
      queryClient.setQueryData(['me'], null);
    };
    window.addEventListener('nexora:unauthorized', handler);
    return () => window.removeEventListener('nexora:unauthorized', handler);
  }, [queryClient]);

  useEffect(() => {
    if (!me) return;
    const valid = me.stores.some((s) => s.id === storeId);
    if (!valid) {
      const next = me.store?.id ?? me.stores[0]?.id ?? null;
      if (next) {
        setStoredStoreId(next);
        setStoreIdState(next);
      }
    }
  }, [me, storeId]);

  const setStore = useCallback(
    (id: string) => {
      setStoredStoreId(id);
      setStoreIdState(id);
      void queryClient.invalidateQueries({ predicate: (q) => q.queryKey[0] !== 'me' });
    },
    [queryClient],
  );

  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ['me'] });
  }, [queryClient]);

  const login = useCallback(
    (payload: Me) => {
      queryClient.setQueryData(['me'], payload);
      const nextStore = payload.store?.id ?? payload.stores[0]?.id ?? null;
      if (nextStore) {
        setStoredStoreId(nextStore);
        setStoreIdState(nextStore);
      }
      void queryClient.invalidateQueries();
    },
    [queryClient],
  );

  const logout = useCallback(async () => {
    try {
      await api('/auth/logout', { method: 'POST', body: {} });
    } catch {
      // The local session is cleared regardless.
    }
    setStoredStoreId(null);
    setStoreIdState(null);
    queryClient.setQueryData(['me'], null);
    queryClient.clear();
  }, [queryClient]);

  const value = useMemo<AuthContextValue>(
    () => ({
      me,
      isLoading: query.isLoading,
      error: query.error,
      storeId: me?.store?.id ?? storeId,
      setStore,
      refresh,
      login,
      logout,
      can: (permission) => Boolean(me?.permissions.includes(permission)),
      isPlatformAdmin: Boolean(me?.user.isPlatformAdmin),
      isDemo: Boolean(me?.tenant?.isDemo),
    }),
    [me, query.isLoading, query.error, storeId, setStore, refresh, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
