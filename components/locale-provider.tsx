"use client";

import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE_KEY,
  LOCALE_STORAGE_KEY,
  type Locale,
  type MessageKey,
  normalizeLocale,
  translate,
} from "@/lib/i18n";

type LocaleContextValue = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: MessageKey) => string;
};

const LocaleContext = createContext<LocaleContextValue | null>(null);

function persistLocale(locale: Locale) {
  try {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // Storage may be unavailable in privacy mode. The cookie remains the server source of truth.
  }
  try {
    document.cookie = `${LOCALE_COOKIE_KEY}=${encodeURIComponent(locale)}; Path=/; Max-Age=31536000; SameSite=Lax`;
  } catch {
    // The in-memory locale still keeps the current document usable.
  }
  document.documentElement.lang = locale;
  document.documentElement.dataset.locale = locale;
}

export function LocaleProvider({ children, initialLocale = DEFAULT_LOCALE }: { children: ReactNode; initialLocale?: Locale }) {
  const router = useRouter();
  const latestLocaleRef = useRef<Locale>(initialLocale);
  const refreshInFlightRef = useRef(false);
  const refreshQueuedRef = useRef(false);
  const [refreshPending, startRefreshTransition] = useTransition();
  const [locale, setLocaleState] = useState<Locale>(initialLocale);

  useEffect(() => {
    if (latestLocaleRef.current !== initialLocale) return;
    setLocaleState(initialLocale);
    persistLocale(initialLocale);
  }, [initialLocale]);

  const refreshServerContent = useCallback(() => {
    if (refreshInFlightRef.current) {
      refreshQueuedRef.current = true;
      return;
    }
    refreshInFlightRef.current = true;
    startRefreshTransition(() => router.refresh());
  }, [router]);

  useEffect(() => {
    if (refreshPending || !refreshInFlightRef.current) return;
    refreshInFlightRef.current = false;
    if (!refreshQueuedRef.current) return;
    refreshQueuedRef.current = false;
    refreshServerContent();
  }, [refreshPending, refreshServerContent]);

  useEffect(() => {
    function syncAcrossTabs(event: StorageEvent) {
      if (event.key !== LOCALE_STORAGE_KEY) return;
      const next = normalizeLocale(event.newValue ?? DEFAULT_LOCALE);
      latestLocaleRef.current = next;
      setLocaleState(next);
      persistLocale(next);
      refreshServerContent();
    }
    window.addEventListener("storage", syncAcrossTabs);
    return () => window.removeEventListener("storage", syncAcrossTabs);
  }, [refreshServerContent]);

  const setLocale = useCallback((next: Locale) => {
    const normalized = normalizeLocale(next);
    latestLocaleRef.current = normalized;
    setLocaleState(normalized);
    persistLocale(normalized);
    refreshServerContent();
  }, [refreshServerContent]);

  const value = useMemo<LocaleContextValue>(() => ({
    locale,
    setLocale,
    t: (key) => translate(locale, key),
  }), [locale, setLocale]);

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale() {
  const context = useContext(LocaleContext);
  if (!context) throw new Error("useLocale must be used within LocaleProvider");
  return context;
}
