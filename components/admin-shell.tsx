"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { adminGetSession, adminLogout } from "@/components/admin-api-client";
import { adminNavigation } from "@/lib/admin-view-models";

function currentLabel(pathname: string) {
  for (const group of adminNavigation) {
    for (const item of group.items) {
      if (("exact" in item && item.exact && pathname === item.href) || (!("exact" in item) && pathname.startsWith(item.href))) return item.label;
    }
  }
  return "管理后台";
}

export function AdminShell({ children, environment, appealsEnabled = false }: { children: ReactNode; environment: string; appealsEnabled?: boolean }) {
  const pathname = usePathname();
  const isLogin = pathname === "/admin/login";
  const env = environment.toUpperCase();
  const [session, setSession] = useState<Record<string, unknown> | null>(null);
  const [sessionChecked, setSessionChecked] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void adminGetSession()
      .then((record) => { if (!cancelled) setSession(record); })
      .catch(() => undefined)
      .finally(() => { if (!cancelled) setSessionChecked(true); });
    return () => { cancelled = true; };
  }, []);

  async function logout() {
    setLoggingOut(true);
    try {
      await adminLogout();
      window.location.assign("/admin/login");
    } catch {
      setLoggingOut(false);
    }
  }

  const adminEnvelope = session?.admin && typeof session.admin === "object" && !Array.isArray(session.admin) ? session.admin as Record<string, unknown> : {};
  const identity = session && (session.user ?? session.actor ?? adminEnvelope.principal ?? session.account);
  const identityObject = identity && typeof identity === "object" && !Array.isArray(identity) ? identity as Record<string, unknown> : {};
  const name = String(identityObject.displayName ?? identityObject.name ?? session?.displayName ?? "会话未确认");
  const rolesValue = session?.roles ?? identityObject.roles ?? session?.role;
  const roleList = Array.isArray(rolesValue) ? rolesValue.filter((role): role is string => typeof role === "string") : typeof rolesValue === "string" ? [rolesValue] : [];
  const roles = roleList.length ? roleList.join(" / ") : "服务端鉴权";
  const financeApproverOnly = roleList.includes("FINANCE_APPROVER") && !roleList.includes("ROOT");
  const featureNavigation = adminNavigation.map((group) => ({ ...group, items: group.items.filter((item) => !("requiresManualAppeals" in item && item.requiresManualAppeals) || appealsEnabled) })).filter((group) => group.items.length);
  const visibleNavigation = financeApproverOnly
    ? featureNavigation.map((group) => ({ ...group, items: group.items.filter((item) => ["/admin/hosting", "/admin/audit"].includes(item.href)) })).filter((group) => group.items.length)
    : featureNavigation;
  const adminHome = financeApproverOnly ? "/admin/hosting" : "/admin";
  const authenticated = session?.authenticated === true;

  if (isLogin) {
    return (
      <div className="admin-app admin-login-app" data-environment={env}>
        <div className="admin-login-topbar">
          <Link className="admin-brand" href="/admin/login"><span>KAI</span> ADMIN</Link>
          <span className={`admin-env ${env === "LOCAL" ? "is-local" : ""}`}>{env}</span>
          <Link className="admin-text-link" href="/" target="_blank">返回网站 ↗</Link>
        </div>
        {children}
      </div>
    );
  }

  return (
    <div className="admin-app" data-environment={env}>
      <aside className="admin-sidebar">
        <div className="admin-sidebar-head">
          <Link className="admin-brand" href={adminHome}><span>KAI</span> ADMIN</Link>
          <span className={`admin-env ${env === "LOCAL" ? "is-local" : ""}`}>{env}</span>
        </div>
        <nav aria-label="管理员主导航" className="admin-navigation">
          {visibleNavigation.map((group) => (
            <section className="admin-nav-group" key={group.label}>
              <h2>{group.label}</h2>
              <div>
                {group.items.map((item) => {
                  const active = ("exact" in item && item.exact) ? pathname === item.href : pathname.startsWith(item.href);
                  return <Link aria-current={active ? "page" : undefined} href={item.href} key={item.href}>{item.label}</Link>;
                })}
              </div>
            </section>
          ))}
        </nav>
        <div className="admin-sidebar-foot">
          <p>权限由服务端逐请求校验。</p>
          <Link href="/" target="_blank">返回普通网站 ↗</Link>
        </div>
      </aside>

      <div className="admin-workspace">
        <header className="admin-topbar">
          <div>
            <span className="admin-topbar-eyebrow">KAI Cloud 运营控制台</span>
            <strong>{currentLabel(pathname)}</strong>
          </div>
          <div className="admin-topbar-actions">
            {env === "LOCAL" ? <span className="admin-local-warning">LOCAL · 非生产数据</span> : null}
            {!financeApproverOnly ? <><Link href="/admin/work-items">我的待办</Link><Link href="/admin/exceptions">严重异常</Link></> : null}
            {!sessionChecked ? <span className="admin-session"><strong>正在校验会话</strong><small>服务端鉴权</small></span> : authenticated ? <><span className="admin-session"><strong>{name}</strong><small>{roles}</small></span><button disabled={loggingOut} onClick={() => void logout()} type="button">{loggingOut ? "退出中…" : "退出"}</button></> : <Link href="/admin/login">登录</Link>}
          </div>
        </header>
        <div className="admin-main" id="admin-main-content">{children}</div>
      </div>
    </div>
  );
}
