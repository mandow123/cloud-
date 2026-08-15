import Link from "next/link";
import { MobileDemandCta } from "./mobile-demand-cta";
import { NavLinks } from "./nav-links";
import { PersonalMenu } from "./personal-menu";
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
          <ThemeControl />
          <Link className="button button-primary button-compact" href="/buy">
            购买算力
          </Link>
          <Link className="button button-secondary button-compact" href="/request">
            提交算力需求
          </Link>
          <PersonalMenu />
        </div>
      </div>
      <MobileDemandCta />
    </header>
  );
}
