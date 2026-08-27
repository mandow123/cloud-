"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLocale } from "./locale-provider";

export function MobileDemandCta() {
  const { t } = useLocale();
  const pathname = usePathname();
  if (pathname === "/member") return null;
  return (
    <nav className="mobile-demand-cta" aria-label={`${t("buy")} / ${t("request")}`}>
      {pathname !== "/buy" ? <Link className="mobile-purchase-cta" href="/buy">{t("buy")} <span aria-hidden="true">→</span></Link> : null}
      {pathname !== "/request" ? <Link className="mobile-request-cta" href="/request">{t("request")}</Link> : null}
    </nav>
  );
}
