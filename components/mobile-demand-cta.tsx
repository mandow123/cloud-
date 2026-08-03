"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function MobileDemandCta() {
  const pathname = usePathname();
  if (pathname === "/request" || pathname === "/member") return null;
  return (
    <Link className="mobile-demand-cta" href="/request">
      <span>发布算力需求</span><span aria-hidden="true">→</span>
    </Link>
  );
}
