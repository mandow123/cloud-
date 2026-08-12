import type { Metadata } from "next";
import { AccountLogin } from "@/components/account-login";
import { LocalPreviewLogin } from "@/components/local-preview-login";

export const metadata: Metadata = {
  title: "个人账户登录",
  description: "登录 KAI Cloud 个人账户，查看购买申请、订单与验收进度。",
};

function safeReturnTo(value: string | string[] | undefined) {
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate?.startsWith("/") && !candidate.startsWith("//") ? candidate : "/member";
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ returnTo?: string | string[]; authError?: string | string[] }> }) {
  const params = await searchParams;
  const configured = Boolean(process.env.KAI_ACCOUNT_OIDC_CLIENT_ID?.trim() && process.env.KAI_ACCOUNT_OIDC_TRANSACTION_SECRET?.trim());
  const returnTo = safeReturnTo(params.returnTo);
  const localPreviewSecret = process.env.NODE_ENV !== "production" && process.env.KAI_ADMIN_LOCAL_AUTH === "1" && (process.env.KAI_ADMIN_LOCAL_SECRET?.trim().length ?? 0) >= 32
    ? process.env.KAI_ADMIN_LOCAL_SECRET!.trim()
    : null;
  return (
    <div className="shell py-12 sm:py-16">
      <AccountLogin authError={Array.isArray(params.authError) ? params.authError[0] : params.authError} configured={configured} returnTo={returnTo} />
      {localPreviewSecret ? <div className="mx-auto max-w-xl"><LocalPreviewLogin returnTo={returnTo} secret={localPreviewSecret} /></div> : null}
    </div>
  );
}
