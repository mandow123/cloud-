"use client";

import Link from "next/link";
import { LanguageControl } from "./language-control";
import { useLocale } from "./locale-provider";
import { MobileDemandCta } from "./mobile-demand-cta";
import { NavLinks } from "./nav-links";
import { PersonalMenu } from "./personal-menu";
import { ThemeControl } from "./theme-control";
import { KaiCloudBrand } from "./kai-cloud-brand";
import type { Locale } from "@/lib/i18n";

const HOME_LABEL: Record<Locale, string> = {
  "zh-CN": "KAI Cloud 首页",
  "zh-TW": "KAI Cloud 首頁",
  en: "KAI Cloud home",
  ja: "KAI Cloud ホーム",
  ko: "KAI Cloud 홈",
  fr: "Accueil KAI Cloud",
  th: "หน้าแรก KAI Cloud",
  vi: "Trang chủ KAI Cloud",
  id: "Beranda KAI Cloud",
  ms: "Laman utama KAI Cloud",
};

export function SiteHeader() {
  const { locale, t } = useLocale();
  return (
    <header className="site-header">
      <div className="shell header-inner">
        <Link className="wordmark" href="/" aria-label={HOME_LABEL[locale]}>
          <KaiCloudBrand />
        </Link>
        <NavLinks />
        <div className="header-actions">
          <ThemeControl />
          <LanguageControl />
          <Link className="button button-primary button-compact" href="/buy">
            {t("buy")}
          </Link>
          <Link className="button button-secondary button-compact" href="/request">
            {t("request")}
          </Link>
          <PersonalMenu />
        </div>
      </div>
      <MobileDemandCta />
    </header>
  );
}
