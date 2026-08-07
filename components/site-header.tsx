import Link from "next/link";
import { AccountNav } from "./account-nav";
import { MobileDemandCta } from "./mobile-demand-cta";
import { NavLinks } from "./nav-links";
import { ThemeControl } from "./theme-control";

export function SiteHeader() {
  return (
    <header className="site-header">
      <div className="shell header-inner">
        <Link className="wordmark" href="/" aria-label="KAI Cloud 首页">
          <span className="wordmark-kai">KAI</span>
          <span className="wordmark-cloud">Cloud</span>
        </Link>
        <NavLinks />
        <div className="header-actions">
          <AccountNav />
          <ThemeControl />
          <Link className="button button-primary button-compact" href="/request">
            发布算力需求
          </Link>
        </div>
      </div>
      <MobileDemandCta />
    </header>
  );
}
