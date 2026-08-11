import Link from "next/link";
import { MobileDemandCta } from "./mobile-demand-cta";
import { NavLinks } from "./nav-links";
import { PersonalMenu } from "./personal-menu";
import { ThemeControl } from "./theme-control";
import { isHostingV2Enabled } from "@/lib/server/hosting-v2-feature";

export function SiteHeader() {
  const hostingV2 = isHostingV2Enabled();

  return (
    <header className="site-header">
      <div className="shell header-inner">
        <Link className="wordmark" href="/" aria-label="KAI Cloud 首页">
          <span className="wordmark-kai">KAI</span>
          <span className="wordmark-cloud">Cloud</span>
        </Link>
        <NavLinks hostingV2={hostingV2} />
        <div className="header-actions">
          <ThemeControl />
          <Link className="button button-primary button-compact" href="/request">
            发布算力需求
          </Link>
          <PersonalMenu />
        </div>
      </div>
      <MobileDemandCta />
    </header>
  );
}
