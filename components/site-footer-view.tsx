"use client";

import Link from "next/link";
import { KaiCloudBrand } from "./kai-cloud-brand";
import { useLocale } from "./locale-provider";

function dateLabel(value: string, locale: string, pending: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? pending
    : new Intl.DateTimeFormat(locale, { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

export function SiteFooterView({
  hostingV2,
  infrastructureUpdatedAt,
  publishedAt,
}: {
  hostingV2: boolean;
  infrastructureUpdatedAt: string;
  publishedAt: string;
}) {
  const { locale, t } = useLocale();
  return (
    <footer className="site-footer">
      <div className="shell footer-grid">
        <div>
          <p className="footer-brand"><KaiCloudBrand size="footer" /></p>
          <p className="footer-copy">{t("footerTagline")}</p>
        </div>
        <div>
          <p className="footer-label">{t("marketServices")}</p>
          <Link href="/market">{t("marketCenter")}</Link>
          <Link href="/resources">{t("resourceMarket")}</Link>
          <Link href="/request">{t("rentalSwap")}</Link>
        </div>
        <div>
          <p className="footer-label">{t("platformInfo")}</p>
          <Link href="/methodology">{t("methodology")}</Link>
          <Link href={hostingV2 ? "/hosting/partners" : "/partners"}>{t("suppliers")}</Link>
          <Link href="/member">{t("memberWorkspace")}</Link>
        </div>
        <div className="footer-disclaimer">
          <p className="footer-label">{t("quoteNotice")}</p>
          <p>{t("disclaimer")}</p>
          <p>{t("modelPublished")}: {dateLabel(publishedAt, locale, t("pending"))} · {t("infrastructureSample")}: {dateLabel(infrastructureUpdatedAt, locale, t("pending"))}</p>
        </div>
      </div>
      <div className="shell footer-bottom">
        <span>© 2026 KAI Cloud</span>
        <span>{t("marketLanguage")}</span>
      </div>
    </footer>
  );
}
