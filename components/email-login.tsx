"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";

type RequestReceipt = {
  challengeId: string;
  expiresAt: string;
  delivery: "SENT" | "LOCAL_INBOX";
};

function errorMessage(value: unknown) {
  if (!value || typeof value !== "object") return "登录服务暂时不可用，请稍后重试。";
  const candidate = value as { error?: { message?: unknown } };
  return typeof candidate.error?.message === "string"
    ? candidate.error.message
    : "登录服务暂时不可用，请稍后重试。";
}

export function EmailLogin() {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [challenge, setChallenge] = useState<RequestReceipt | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function requestCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/auth/email/request", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      });
      const payload = await response.json() as RequestReceipt | { error?: { message?: string } };
      if (!response.ok || !("challengeId" in payload)) throw payload;
      setChallenge(payload);
      setCode("");
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setBusy(false);
    }
  }

  async function verifyCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!challenge) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/auth/email/verify", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ challengeId: challenge.challengeId, email: email.trim().toLowerCase(), code: code.trim() }),
      });
      const payload = await response.json() as { authenticated?: boolean; error?: { message?: string } };
      if (!response.ok || !payload.authenticated) throw payload;
      const target = new URLSearchParams(window.location.search).get("returnTo");
      window.location.assign(target?.startsWith("/") && !target.startsWith("//") ? target : "/member");
    } catch (verifyError) {
      setError(errorMessage(verifyError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-panel">
      <div>
        <p className="kicker">KAI ACCOUNT</p>
        <h1>登录算力交易账户</h1>
        <p>买家和供应商使用邮箱验证码登录；同一个账户可以加入多个主体，但每笔业务都必须选择明确的个人或企业主体。</p>
      </div>

      {error ? <div className="login-alert" role="alert">{error}</div> : null}

      {!challenge ? (
        <form onSubmit={requestCode}>
          <label className="field">
            <span>工作邮箱</span>
            <input
              autoComplete="email"
              inputMode="email"
              name="email"
              onChange={(event) => setEmail(event.target.value)}
              placeholder="name@company.com"
              required
              type="email"
              value={email}
            />
          </label>
          <button className="button button-primary" disabled={busy} type="submit">
            {busy ? "正在发送…" : "获取验证码"}
          </button>
        </form>
      ) : (
        <form onSubmit={verifyCode}>
          <div className="login-receipt" role="status">
            <strong>{challenge.delivery === "SENT" ? "验证码已发送" : "验证码已进入本地开发收件箱"}</strong>
            <span>10 分钟内有效，连续输错 5 次后需要重新申请。</span>
          </div>
          <label className="field">
            <span>6 位验证码</span>
            <input
              autoComplete="one-time-code"
              inputMode="numeric"
              maxLength={6}
              onChange={(event) => setCode(event.target.value.replace(/\D/gu, ""))}
              required
              value={code}
            />
          </label>
          <div className="login-actions">
            <button className="button button-primary" disabled={busy || code.length !== 6} type="submit">
              {busy ? "正在验证…" : "登录"}
            </button>
            <button className="button button-secondary" disabled={busy} onClick={() => setChallenge(null)} type="button">
              更换邮箱
            </button>
          </div>
        </form>
      )}

      <p className="login-admin-link">KAI 员工请前往 <Link href="/admin/login">飞书组织登录</Link>。</p>
    </div>
  );
}

