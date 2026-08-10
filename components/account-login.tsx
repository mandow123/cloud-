import Link from "next/link";

const accountLinks = [
  { href: "https://account.kai.com/", label: "用户中心" },
  { href: "https://account.kai.com/docs", label: "账户文档" },
] as const;

export function AccountLogin({ returnTo, configured, authError }: { returnTo: string; configured: boolean; authError?: string }) {
  const loginHref = `/api/auth/kai/start?returnTo=${encodeURIComponent(returnTo)}`;
  return (
    <section className="mx-auto max-w-xl border-t-4 border-[var(--accent)] bg-[var(--surface)] p-6 ring-1 ring-[var(--border)] sm:p-9" aria-labelledby="account-login-title">
      <p className="kicker">KAI IDENTITY</p>
      <h1 className="m-0 text-4xl" id="account-login-title">登录或注册个人账户</h1>
      <p className="section-lead text-base">使用 KAI 统一账户进入 Cloud。新用户可在统一账户完成邮箱注册和验证码验证，已有用户直接登录。</p>

      {authError ? <div className="mt-5 border-l-4 border-[var(--error)] bg-[var(--error-bg)] p-4 text-[var(--error)]" role="alert">登录未完成或事务已过期，请重新发起登录。</div> : null}
      {!configured ? <div className="mt-5 border-l-4 border-[var(--error)] bg-[var(--error-bg)] p-4 text-[var(--error)]" role="alert">统一账户应用尚未完成生产登记，登录入口暂不可用。</div> : null}

      <a aria-disabled={!configured} className={`button button-primary mt-7 min-h-12 w-full justify-center${configured ? "" : " pointer-events-none opacity-50"}`} href={configured ? loginHref : undefined}>
        使用 KAI Account 登录 / 注册
      </a>

      <dl className="mt-7 grid gap-3 border-t border-[var(--border)] pt-6 text-sm sm:grid-cols-2">
        <div><dt className="font-semibold text-[var(--ink)]">注册与邮箱验证</dt><dd className="mt-1 text-[var(--muted)]">由 account.kai.com 安全完成</dd></div>
        <div><dt className="font-semibold text-[var(--ink)]">Cloud 本地会话</dt><dd className="mt-1 text-[var(--muted)]">登录成功后独立管理与退出</dd></div>
      </dl>

      <div className="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-sm">
        {accountLinks.map((item) => <a className="font-semibold text-[var(--accent)] underline underline-offset-4" href={item.href} key={item.href} rel="noreferrer">{item.label}</a>)}
        <Link className="font-semibold text-[var(--accent)] underline underline-offset-4" href="/resources">继续匿名浏览资源</Link>
      </div>
    </section>
  );
}
