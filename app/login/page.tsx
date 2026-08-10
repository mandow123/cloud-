import type { Metadata } from "next";
import { AccountLogin } from "@/components/account-login";

export const metadata: Metadata = {
  title: "个人账户登录",
  description: "登录 KAI Cloud 个人账户，查看购买申请、订单与验收进度。",
};

function safeReturnTo(value: string | string[] | undefined) {
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate?.startsWith("/") && !candidate.startsWith("//") ? candidate : "/member";
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ returnTo?: string | string[] }> }) {
  const params = await searchParams;
  return (
    <div className="shell py-12 sm:py-16">
      <AccountLogin returnTo={safeReturnTo(params.returnTo)} />
    </div>
  );
}
