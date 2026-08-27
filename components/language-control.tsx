"use client";

import { localeOptions, type Locale } from "@/lib/i18n";
import { useLocale } from "./locale-provider";

export function LanguageControl() {
  const { locale, setLocale, t } = useLocale();

  return (
    <label className="language-control">
      <span>{t("language")}</span>
      <select
        aria-label={t("languageLabel")}
        value={locale}
        onChange={(event) => setLocale(event.target.value as Locale)}
      >
        {localeOptions.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </label>
  );
}
