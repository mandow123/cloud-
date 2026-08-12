"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import styles from "./supply-console.module.css";

const availableRoutes = [
  { href: "/supply", label: "总览" },
  { href: "/supply/onboarding", label: "供应商审核" },
  { href: "/supply/resources", label: "资源" },
  { href: "/supply/listings", label: "挂牌" },
  { href: "/supply/orders", label: "订单" },
  { href: "/supply/earnings", label: "收益" },
] as const;

function isCurrentRoute(pathname: string, href: string) {
  return href === "/supply" ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
}

export function SupplyConsoleShell({ children, configurationMode = false }: { children: ReactNode; configurationMode?: boolean }) {
  const pathname = usePathname();

  return (
    <div className={styles.console}>
      <header className={styles.consoleHeader}>
        <div className={styles.headerInner}>
          <div>
            <p className={styles.contextLabel}>KAI Hosting · Supplier workspace</p>
            <p className={styles.consoleTitle}>供应商控制台</p>
          </div>
          <nav aria-label="供应商控制台" className={styles.consoleNav}>
            {availableRoutes.map((route) => (
              configurationMode && ["/supply/orders", "/supply/earnings"].includes(route.href)
                ? <span aria-disabled="true" key={route.href} title="正式试运营开放后可用">{route.label}</span>
                : <Link aria-current={isCurrentRoute(pathname, route.href) ? "page" : undefined} href={route.href} key={route.href}>{route.label}</Link>
            ))}
          </nav>
        </div>
      </header>
      {configurationMode ? <div className={styles.setupBanner} role="status"><strong>预上线配置模式</strong><span>供应商审核、Agent 配对、设备验真和挂牌草稿可用；公开挂牌、租用、卡时扣减与结算仍保持关闭。</span></div> : null}
      <div className={styles.content}>{children}</div>
    </div>
  );
}
