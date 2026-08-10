"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";

type AuthErrorEnvelope = { error?: { message?: string } };
type ChallengeEnvelope = { challengeId: string; expiresAt: string };

async function authPost<T>(path: string, body: Record<string, unknown>) {
  const response = await fetch(path, {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({})) as T & AuthErrorEnvelope;
  if (!response.ok) throw new Error(payload.error?.message || "登录服务暂时不可用，请稍后重试。");
  return payload;
}

export function AccountLogin({ returnTo }: { returnTo: string }) {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [challenge, setChallenge] = useState<ChallengeEnvelope | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function requestCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await authPost<ChallengeEnvelope>("/api/auth/email/request", { email });
      setChallenge(result);
      setCode("");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "验证码暂时无法发送。");
    } finally {
      setBusy(false);
    }
  }

  async function verifyCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!challenge || busy) return;
    setBusy(true);
    setError("");
    try {
      await authPost<{ authenticated: boolean }>("/api/auth/email/verify", {
        challengeId: challenge.challengeId,
        email,
        code,
      });
      window.location.assign(returnTo);
    } catch (verifyError) {
      setError(verifyError instanceof Error ? verifyError.message : "验证码校验失败。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mx-auto max-w-xl border-t-4 border-[var(--accent)] bg-[var(--surface)] p-6 ring-1 ring-[var(--border)] sm:p-9" aria-labelledby="account-login-title">
      <p className="kicker">KAI ACCOUNT</p>
      <h1 className="m-0 text-4xl" id="account-login-title">登录个人账户</h1>
      <p className="section-lead text-base">登录后查看购买申请、正式订单、待支付、待验收和本机对比。平台不会通过此页面索取支付密码。</p>

      {error ? <div className="mt-5 border-l-4 border-[var(--error)] bg-[var(--error-bg)] p-4 text-[var(--error)]" role="alert">{error}</div> : null}

      {!challenge ? (
        <form className="mt-7 grid gap-5" onSubmit={requestCode}>
          <label className="grid gap-2 text-sm font-semibold text-[var(--ink)]" htmlFor="account-email">
            登录邮箱
            <input
              autoComplete="email"
              className="min-h-12 border border-[var(--border-strong)] bg-[var(--canvas)] px-4 text-[var(--ink)]"
              id="account-email"
              maxLength={254}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="name@example.com"
              required
              type="email"
              value={email}
            />
          </label>
          <button className="button button-primary min-h-12 w-full justify-center" disabled={busy} type="submit">
            {busy ? "正在发送…" : "发送邮箱验证码"}
          </button>
        </form>
      ) : (
        <form className="mt-7 grid gap-5" onSubmit={verifyCode}>
          <div className="border-l-2 border-[var(--accent)] pl-4 text-sm">
            验证码已发送至 <strong>{email}</strong>，10 分钟内有效。
          </div>
          <label className="grid gap-2 text-sm font-semibold text-[var(--ink)]" htmlFor="account-code">
            6 位验证码
            <input
              autoComplete="one-time-code"
              className="min-h-12 border border-[var(--border-strong)] bg-[var(--canvas)] px-4 font-mono text-xl tracking-[0.3em] text-[var(--ink)]"
              id="account-code"
              inputMode="numeric"
              maxLength={6}
              minLength={6}
              onChange={(event) => setCode(event.target.value.replace(/\D/gu, "").slice(0, 6))}
              pattern="[0-9]{6}"
              required
              value={code}
            />
          </label>
          <button className="button button-primary min-h-12 w-full justify-center" disabled={busy || code.length !== 6} type="submit">
            {busy ? "正在登录…" : "验证并登录"}
          </button>
          <button className="min-h-11 cursor-pointer border-0 bg-transparent text-sm font-semibold text-[var(--accent)] underline underline-offset-4" onClick={() => { setChallenge(null); setCode(""); setError(""); }} type="button">
            更换邮箱或重新发送
          </button>
        </form>
      )}

      <div className="mt-7 border-t border-[var(--border)] pt-5 text-sm text-[var(--muted)]">
        <p className="m-0">账户服务尚未配置时，页面会明确阻断登录，不会创建默认密码或模拟身份。</p>
        <Link className="mt-3 inline-flex min-h-11 items-center font-semibold text-[var(--accent)] underline underline-offset-4" href="/resources">继续匿名浏览资源</Link>
      </div>
    </section>
  );
}
