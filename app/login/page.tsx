import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "账户入口",
  description: "KAI Cloud 不提供飞书或邮箱验证码登录。",
};

export default function LoginPage() {
  return (
    <div className="shell py-12 sm:py-16">
      <section className="mx-auto max-w-xl border-t-4 border-[var(--accent)] bg-[var(--surface)] p-6 ring-1 ring-[var(--border)] sm:p-9" aria-labelledby="account-login-title">
        <p className="kicker">KAI ACCOUNT</p>
        <h1 className="m-0 text-4xl" id="account-login-title">账户登录入口已移除</h1>
        <p className="section-lead text-base">本站不提供飞书登录或邮箱验证码登录，也不会以未配置状态保留相关认证接口。</p>
        <div className="mt-7 grid gap-3 sm:grid-cols-2">
          <Link className="button button-primary min-h-12 justify-center" href="/resources">继续浏览算力资源</Link>
          <Link className="button button-secondary min-h-12 justify-center" href="/admin/login">管理员账号登录</Link>
        </div>
      </section>
    </div>
  );
}
