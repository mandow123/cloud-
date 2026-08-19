import type { Metadata } from "next";
import { AccountLogin } from "@/components/account-login";

export const metadata: Metadata = {
  title: "登录创作者账户",
  description: "登录 KAI Creator，投稿作品、参与投票并查看奖励记录。",
};

function safeReturnTo(value: string | string[] | undefined) {
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate?.startsWith("/") && !candidate.startsWith("//") ? candidate : "/#community";
}

function emailOtpConfigured() {
  const secret = process.env.KAI_EMAIL_OTP_HMAC_SECRET?.trim() ?? "";
  return new TextEncoder().encode(secret).byteLength >= 32
    && Boolean(process.env.KAI_EMAIL_OTP_WEBHOOK_URL?.trim())
    && Boolean(process.env.KAI_EMAIL_OTP_WEBHOOK_TOKEN?.trim());
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ returnTo?: string | string[] }> }) {
  const params = await searchParams;
  return (
    <div className="shell py-12 sm:py-16">
      <AccountLogin emailOtpConfigured={emailOtpConfigured()} returnTo={safeReturnTo(params.returnTo)} />
    </div>
  );
}
