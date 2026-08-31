import "server-only";

import { cookies } from "next/headers";
import { DEFAULT_LOCALE, LOCALE_COOKIE_KEY, normalizeLocale, type Locale } from "@/lib/i18n";

export async function getRequestLocale(): Promise<Locale> {
  try {
    const cookieStore = await cookies();
    return normalizeLocale(cookieStore.get(LOCALE_COOKIE_KEY)?.value);
  } catch {
    return DEFAULT_LOCALE;
  }
}
