"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import styles from "./account-console-shell.module.css";

type ConsoleMode = "buyer" | "supplier";

type SessionSnapshot = {
  authenticated: boolean;
  account?: { displayName?: string; primaryEmail?: string | null } | null;
  organization?: { id?: string; name?: string } | null;
};

type ConsoleCapabilitySnapshot = {
  supplier?: { available?: boolean; approved?: boolean };
};

const buyerNavigation = [
  { href: "/member", label: "账户总览", exact: true },
  { href: "/member/purchases", label: "算力申请" },
  { href: "/member#card-hours", label: "卡时账户", anchor: "card-hours" },
  { href: "/member#compare", label: "资源对比", anchor: "compare" },
  { href: "/gpu", label: "GPU 市场", external: true },
] as const;

const supplierNavigation = [
  { href: "/supply", label: "供应概览", exact: true },
  { href: "/supply/apply", label: "提交上架" },
  { href: "/supply/applications", label: "上架申请" },
  { href: "/supply/devices", label: "托管设备", requiresApproval: true, requiresHosting: true },
  { href: "/supply/listings", label: "挂牌管理", requiresApproval: true, requiresHosting: true },
  { href: "/supply/orders", label: "订单与实例", requiresApproval: true, requiresHosting: true },
  { href: "/supply/earnings", label: "收益与结算", requiresApproval: true, requiresHosting: true },
] as const;

function currentRoute(pathname: string, href: string, exact = false) {
  const routePath = href.split("#")[0];
  return exact ? pathname === routePath : pathname === routePath || pathname.startsWith(`${routePath}/`);
}

export function AccountConsoleShell({
  children,
  mode,
  configurationMode = false,
}: {
  children: ReactNode;
  mode: ConsoleMode;
  configurationMode?: boolean;
}) {
  const pathname = usePathname();
  const [navigationOpen, setNavigationOpen] = useState(false);
  const [session, setSession] = useState<SessionSnapshot | null>(null);
  const [capabilities, setCapabilities] = useState<ConsoleCapabilitySnapshot | null>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const navigation = mode === "buyer" ? buyerNavigation : supplierNavigation;
  const mobilePrimaryNavigation = mode === "buyer"
    ? [buyerNavigation[0], buyerNavigation[1], buyerNavigation[4]]
    : supplierNavigation.slice(0, 3);

  useEffect(() => {
    if (!navigationOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setNavigationOpen(false);
      menuButtonRef.current?.focus();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [navigationOpen]);

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      fetch("/api/auth/session", { credentials: "same-origin", cache: "no-store", signal: controller.signal }),
      fetch("/api/v1/member/account-console-summary", { credentials: "same-origin", cache: "no-store", signal: controller.signal }),
    ]).then(async ([sessionResponse, capabilityResponse]) => {
      setSession(sessionResponse.ok ? await sessionResponse.json() as SessionSnapshot : { authenticated: false });
      setCapabilities(capabilityResponse.ok ? await capabilityResponse.json() as ConsoleCapabilitySnapshot : {});
    }).catch(() => {
      setSession({ authenticated: false });
      setCapabilities({});
    });
    return () => controller.abort();
  }, []);

  const organizationName = session?.organization?.name?.trim() || (session === null ? "正在读取当前组织" : "尚未绑定交易主体");
  const accountName = session?.account?.displayName?.trim() || session?.account?.primaryEmail?.trim() || (session === null ? "正在核对账户" : "未登录");
  const consoleTitle = mode === "buyer" ? "采购账户" : "供应工作台";

  return (
    <div className={styles.console} data-console-mode={mode}>
      <header className={styles.topbar}>
        <div className={styles.topbarInner}>
          <button
            aria-controls="account-console-navigation"
            aria-expanded={navigationOpen}
            className={styles.menuButton}
            onClick={() => setNavigationOpen((current) => !current)}
            ref={menuButtonRef}
            type="button"
          >
            <span aria-hidden="true">{navigationOpen ? "×" : "☰"}</span>
            <span>账户导航</span>
          </button>
          <div className={styles.organization}>
            <span>当前组织</span>
            <strong>{organizationName}</strong>
          </div>
          <div className={styles.topbarMeta}>
            <span className={styles.modeBadge}>{consoleTitle}</span>
            <div className={styles.account}>
              <span>当前账户</span>
              <strong>{accountName}</strong>
            </div>
          </div>
        </div>
      </header>

      <div className={styles.workspace}>
        <aside className={`${styles.sidebar} ${navigationOpen ? styles.sidebarOpen : ""}`} id="account-console-navigation">
          <div className={styles.sidebarHeading}>
            <span>KAI Cloud</span>
            <strong>{consoleTitle}</strong>
          </div>
          <nav aria-label={`${consoleTitle}导航`} className={styles.navigation}>
            {navigation.map((item) => {
              if ("requiresApproval" in item && item.requiresApproval && !capabilities?.supplier?.approved) return null;
              if ("requiresHosting" in item && item.requiresHosting && configurationMode) return null;
              const active = !("external" in item && item.external) && !("anchor" in item && item.anchor) && currentRoute(pathname, item.href, "exact" in item && item.exact);
              return (
                <Link aria-current={active ? "page" : undefined} href={item.href} key={item.href} onClick={() => setNavigationOpen(false)}>
                  {item.label}
                </Link>
              );
            })}
          </nav>
          <div className={styles.modeSwitch}>
            <span>工作视图</span>
            {mode === "buyer" ? (
              <Link href={capabilities?.supplier?.available ? "/supply" : "/supply/apply"} onClick={() => setNavigationOpen(false)}>
                <strong>{capabilities?.supplier?.available ? "切换到供应视图" : "申请成为供应商"}</strong>
                <small>{capabilities?.supplier?.approved ? "管理当前组织的供应资源" : "提交后由平台人工审核"}</small>
              </Link>
            ) : (
              <Link href="/member" onClick={() => setNavigationOpen(false)}><strong>返回采购账户</strong><small>查看当前组织的购买数据</small></Link>
            )}
          </div>
        </aside>

        <div className={styles.contentColumn}>
          {configurationMode ? (
            <div className={styles.setupBanner} role="status">
              <strong>预上线配置模式</strong>
              <span>可提交供应申请并查看人工审核进度；Agent、挂牌、公开成交、卡时扣减与收益结算仍保持关闭。</span>
            </div>
          ) : null}
          <div className={styles.content}>{children}</div>
        </div>
      </div>
      <nav aria-label={`${consoleTitle}移动导航`} className={styles.mobileDock}>
        {mobilePrimaryNavigation.map((item) => (
          <Link aria-current={currentRoute(pathname, item.href, "exact" in item && item.exact) ? "page" : undefined} href={item.href} key={item.href}>{item.label}</Link>
        ))}
        <button aria-expanded={navigationOpen} onClick={() => setNavigationOpen((current) => !current)} type="button">更多</button>
      </nav>
    </div>
  );
}
