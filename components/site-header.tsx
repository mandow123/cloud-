"use client";

import Link from "next/link";
import { LanguageControl } from "./language-control";
import { useLocale } from "./locale-provider";
import { MobileDemandCta } from "./mobile-demand-cta";
import { NavLinks } from "./nav-links";
import { PersonalMenu } from "./personal-menu";
import { ThemeControl } from "./theme-control";
import { KaiCloudBrand } from "./kai-cloud-brand";

export function SiteHeader() {
  const { t } = useLocale();
  return (
    <header className="site-header">
      <div className="shell header-inner">
        <Link className="wordmark" href="/" aria-label="KAI Cloud 首页">
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
