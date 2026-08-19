"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const navigation = [
  { href: "/", label: "创作活动" },
  { href: "/market", label: "行情中心" },
  { href: "/resources", label: "资源市场" },
  { href: "/partners", label: "供应商合作" },
  { href: "/member", label: "会员中心" },
];

export function NavLinks() {
  const pathname = usePathname();

  return (
    <nav aria-label="全局导航" className="primary-nav">
      {navigation.map((item) => {
        const active = item.href === "/" ? pathname === "/" || pathname.startsWith("/activity") : pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link key={item.href} href={item.href} aria-current={active ? "page" : undefined}>
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
