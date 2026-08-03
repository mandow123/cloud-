import Link from "next/link";
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
          <ThemeControl />
          <Link className="button button-primary button-compact" href="/request">
            发布算力需求
          </Link>
        </div>
      </div>
      <Link className="mobile-demand-cta" href="/request">
        <span>发布算力需求</span><span aria-hidden="true">→</span>
      </Link>
    </header>
  );
}
