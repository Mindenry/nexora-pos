import { createContext, createElement, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

export type Locale = 'th' | 'en';

interface LangContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (th: string, en: string) => string;
}

const LangContext = createContext<LangContextValue | null>(null);
const LOCALE_KEY = 'nexora.locale';

export function LangProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => {
    const stored = localStorage.getItem(LOCALE_KEY);
    return stored === 'en' ? 'en' : 'th';
  });

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    localStorage.setItem(LOCALE_KEY, next);
    document.documentElement.lang = next;
  }, []);

  const t = useCallback((th: string, en: string) => (locale === 'th' ? th : en), [locale]);
  const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t]);

  return createElement(LangContext.Provider, { value }, children);
}

export function useLang(): LangContextValue {
  const ctx = useContext(LangContext);
  if (!ctx) throw new Error('useLang must be used inside LangProvider');
  return ctx;
}
