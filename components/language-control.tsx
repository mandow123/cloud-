"use client";

import { localeOptions, type Locale } from "@/lib/i18n";
import { useLocale } from "./locale-provider";

export function LanguageControl() {
  const { locale, setLocale, t } = useLocale();
  const currentOption = localeOptions.find((option) => option.value === locale) ?? localeOptions[0];

  return (
    <label className="language-control" title={t("languageScope")}>
      <span className="language-control-label">{t("language")}</span>
      <span aria-hidden="true" className="language-control-short">{currentOption.shortLabel}</span>
      <select
        aria-describedby="kai-language-scope"
        aria-label={t("languageLabel")}
        value={locale}
        onChange={(event) => setLocale(event.target.value as Locale)}
      >
        {localeOptions.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
      <span className="language-control-scope" id="kai-language-scope">{t("languageScope")}</span>
    </label>
  );
}
