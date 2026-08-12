import type { Metadata } from "next";
import { AccountLogin } from "@/components/account-login";
import { LocalPreviewLogin } from "@/components/local-preview-login";
import { probeKaiIdentityDiscovery } from "@/lib/server/kai-identity-oidc";

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
  const identityStatus = configured ? await probeKaiIdentityDiscovery() : null;
  const returnTo = safeReturnTo(params.returnTo);
  const localPreviewEnabled = process.env.KAI_ADMIN_LOCAL_AUTH === "1" && process.env.KAI_LOCAL_PREVIEW_UI === "1";
  return (
    <div className="shell py-12 sm:py-16">
      <AccountLogin
        authError={Array.isArray(params.authError) ? params.authError[0] : params.authError}
        configured={configured}
        identityError={identityStatus?.errorCode}
        returnTo={returnTo}
        serviceAvailable={identityStatus?.available ?? false}
      />
      {localPreviewEnabled ? <div className="mx-auto max-w-xl"><LocalPreviewLogin returnTo={returnTo} /></div> : null}
    </div>
  );
}
