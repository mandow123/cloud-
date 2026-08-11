"use client";

import { FormEvent, useState } from "react";

type AuthResponse = { error?: { message?: string }; admin?: { principal?: { roles?: string[] } } };

export function AdminLogin() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/auth/admin/password", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const payload = await response.json().catch(() => ({})) as AuthResponse;
      if (!response.ok) throw new Error(payload.error?.message || "管理员登录暂时不可用。");
      window.location.assign(payload.admin?.principal?.roles?.includes("FINANCE_APPROVER") ? "/admin/hosting" : "/admin");
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : "管理员登录暂时不可用。");
      setBusy(false);
    }
  }

  return (
    <div className="admin-login-main">
      <section className="admin-login-card" aria-labelledby="admin-login-title">
        <p className="admin-kicker">Protected operations</p>
        <h1 id="admin-login-title">登录 KAI 管理后台</h1>
        <p>后台包含供应、需求、订单、卡时账本与交付运营数据。Root 与独立财务审批员使用不同账号登录，服务端逐请求检查各自权限。</p>

        {error ? <div className="admin-inline-error" role="alert"><strong>登录未完成</strong><span>{error}</span></div> : null}

        <form className="admin-login-form" onSubmit={login}>
          <label htmlFor="admin-username"><span>管理员账号</span><input autoComplete="username" id="admin-username" maxLength={64} onChange={(event) => setUsername(event.target.value)} required value={username} /></label>
          <label htmlFor="admin-password"><span>管理员密码</span><input autoComplete="current-password" id="admin-password" maxLength={256} minLength={12} onChange={(event) => setPassword(event.target.value)} required type="password" value={password} /></label>
          <button className="admin-button primary" disabled={busy || username.trim().length < 3 || password.length < 12} type="submit">{busy ? "正在验证并进入…" : "登录管理员后台"}</button>
        </form>

        <dl className="admin-login-rules">
          <div><dt>未登录</dt><dd>不读取任何后台业务数据</dd></div>
          <div><dt>无权限</dt><dd>显示 403，不降级到普通用户数据</dd></div>
          <div><dt>登录方式</dt><dd>后台仅接受 Root 或独立审批账号密码</dd></div>
          <div><dt>操作记录</dt><dd>登录与写操作均进入安全审计</dd></div>
        </dl>
      </section>
    </div>
  );
}
