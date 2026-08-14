import Link from "next/link";

const accountLinks = [
  { href: "https://auth.kai.com/", label: "身份中心" },
  { href: "https://auth.kai.com/sign-up", label: "注册账户" },
] as const;

export function AccountLogin({ returnTo, configured, serviceAvailable, identityError, authError }: {
  returnTo: string;
  configured: boolean;
  serviceAvailable: boolean;
  identityError?: string;
  authError?: string;
}) {
  const loginHref = `/api/auth/kai/start?returnTo=${encodeURIComponent(returnTo)}`;
  const retryHref = `/login?returnTo=${encodeURIComponent(returnTo)}`;
  return (
    <section className="mx-auto max-w-xl border-t-4 border-[var(--accent)] bg-[var(--surface)] p-6 ring-1 ring-[var(--border)] sm:p-9" aria-labelledby="account-login-title">
      <p className="kicker">KAI IDENTITY</p>
      <h1 className="m-0 text-4xl" id="account-login-title">登录或注册个人账户</h1>
      <p className="section-lead text-base">使用 KAI 统一账户进入 Cloud。新用户可在统一账户完成邮箱注册和验证码验证，已有用户直接登录。</p>

      {authError ? <div className="mt-5 border-l-4 border-[var(--error)] bg-[var(--error-bg)] p-4 text-[var(--error)]" role="alert">登录未完成或事务已过期，请重新发起登录。</div> : null}
      {!configured ? <div className="mt-5 border-l-4 border-[var(--error)] bg-[var(--error-bg)] p-4 text-[var(--error)]" role="alert">统一账户应用尚未完成生产登记，登录入口暂不可用。</div> : null}
      {configured && !serviceAvailable ? <div className="mt-5 border-l-4 border-[var(--error)] bg-[var(--error-bg)] p-4 text-[var(--error)]" role="alert">
        <strong className="block text-[var(--ink)]">KAI Identity 当前不可用</strong>
        <span className="mt-1 block">这不是您的账号或授权选择问题。平台已识别上游连接异常，请修复后重试。</span>
        <span className="sr-only">故障代码：{identityError ?? "KAI_IDENTITY_UNAVAILABLE"}</span>
      </div> : null}

      <a aria-disabled={!serviceAvailable} className={`button button-primary mt-7 min-h-12 w-full justify-center${serviceAvailable ? "" : " pointer-events-none opacity-50"}`} href={serviceAvailable ? loginHref : undefined}>
        使用 KAI Identity 登录 / 注册
      </a>
      {configured && !serviceAvailable ? <Link className="button mt-3 min-h-11 w-full justify-center" href={retryHref}>重新检查账户中心</Link> : null}

      <dl className="mt-7 grid gap-3 border-t border-[var(--border)] pt-6 text-sm sm:grid-cols-2">
        <div><dt className="font-semibold text-[var(--ink)]">注册与邮箱验证</dt><dd className="mt-1 text-[var(--muted)]">由 auth.kai.com 安全完成</dd></div>
        <div><dt className="font-semibold text-[var(--ink)]">Cloud 本地会话</dt><dd className="mt-1 text-[var(--muted)]">登录成功后独立管理与退出</dd></div>
      </dl>

      <div className="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-sm">
        {accountLinks.map((item) => <a className="font-semibold text-[var(--accent)] underline underline-offset-4" href={item.href} key={item.href} rel="noreferrer">{item.label}</a>)}
        <Link className="font-semibold text-[var(--accent)] underline underline-offset-4" href="/resources">继续匿名浏览资源</Link>
      </div>
    </section>
  );
}
