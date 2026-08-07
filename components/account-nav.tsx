"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type SessionSnapshot = {
  authenticated: boolean;
  account?: { displayName?: string; primaryEmail?: string | null } | null;
  admin?: unknown;
};

export function AccountNav() {
  const [session, setSession] = useState<SessionSnapshot | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/auth/session", {
      credentials: "same-origin",
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => response.ok ? response.json() as Promise<SessionSnapshot> : null)
      .then((value) => setSession(value))
      .catch(() => setSession({ authenticated: false }));
    return () => controller.abort();
  }, []);

  if (session?.authenticated) {
    return (
      <div className="account-nav" aria-label="账户入口">
        {session.admin ? <Link href="/admin">运营管理</Link> : null}
        <Link href="/member">我的账户</Link>
      </div>
    );
  }

  return (
    <div className="account-nav" aria-label="账户入口">
      <Link href="/login">登录</Link>
    </div>
  );
}

