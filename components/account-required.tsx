"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";

type AccountSession = {
  authenticated: boolean;
  account?: { displayName?: string; primaryEmail?: string | null } | null;
  organization?: { id?: string; name?: string } | null;
  memberships?: Array<{ organizationId?: string; status?: string }>;
};

export function AccountRequired({ children, purpose }: { children: ReactNode; purpose: string }) {
  const [session, setSession] = useState<AccountSession | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/auth/session", { credentials: "same-origin", cache: "no-store", signal: controller.signal })
      .then(async (response) => response.ok ? response.json() as Promise<AccountSession> : { authenticated: false })
      .then(setSession)
      .catch(() => setSession({ authenticated: false }));
    return () => controller.abort();
  }, []);

  if (session === null) {
    return <div className="account-gate" role="status">正在核对账户与交易主体…</div>;
  }

  if (!session.authenticated) {
    const returnTo = typeof window === "undefined" ? "/member" : window.location.pathname + window.location.search;
    return (
      <section className="account-gate" aria-labelledby="account-gate-title">
        <p className="kicker">ACCOUNT REQUIRED</p>
        <h2 id="account-gate-title">登录后继续{purpose}</h2>
        <p>正式上架、发布需求和创建订单必须绑定个人或企业主体。行情与公开资源仍可匿名浏览。</p>
        <Link className="button button-primary" href={`/login?returnTo=${encodeURIComponent(returnTo)}`}>
          查看账户入口说明
        </Link>
      </section>
    );
  }

  if (!session.organization) {
    return (
      <section className="account-gate" aria-labelledby="organization-gate-title">
        <p className="kicker">ORGANIZATION REQUIRED</p>
        <h2 id="organization-gate-title">需要一个已启用的交易主体</h2>
        <p>当前账户尚未绑定可用的个人、企业、IDC 或云厂商主体。请联系 KAI 运营完成主体登记或审核。</p>
      </section>
    );
  }

  const activeMembership = session.memberships?.find((membership) => membership.organizationId === session.organization?.id);
  if (!activeMembership || activeMembership.status !== "ACTIVE") {
    return (
      <section className="account-gate" aria-labelledby="membership-gate-title">
        <p className="kicker">SUBJECT APPROVAL REQUIRED</p>
        <h2 id="membership-gate-title">当前交易主体尚未启用</h2>
        <p>可以继续浏览行情、资源和个人资料；购买、供应、订单和支付操作会保持关闭，直到主体审核通过。</p>
      </section>
    );
  }

  return <>{children}</>;
}
