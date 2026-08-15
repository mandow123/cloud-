"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function MobileDemandCta() {
  const pathname = usePathname();
  if (pathname === "/member") return null;
  return (
    <nav className="mobile-demand-cta" aria-label="购买与需求操作">
      {pathname !== "/buy" ? <Link className="mobile-purchase-cta" href="/buy">购买算力 <span aria-hidden="true">→</span></Link> : null}
      {pathname !== "/request" ? <Link className="mobile-request-cta" href="/request">提交算力需求</Link> : null}
    </nav>
  );
}
