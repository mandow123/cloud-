import type { Metadata } from "next";
import { AccountLogin } from "@/components/account-login";
import { LocalPreviewLogin } from "@/components/local-preview-login";
import type { Locale } from "@/lib/i18n";
import { probeKaiIdentityDiscovery } from "@/lib/server/kai-identity-oidc";
import { getRequestLocale } from "@/lib/server/request-locale";

const metadataCopy = {
  "zh-CN": ["个人账户登录", "登录 KAI Cloud 个人账户，查看购买申请、订单与验收进度。"],
  "zh-TW": ["個人帳戶登入", "登入 KAI Cloud 個人帳戶，查看購買申請、訂單與驗收進度。"],
  en: ["Personal account sign-in", "Sign in to KAI Cloud to view purchase requests, orders and acceptance progress."],
  ja: ["個人アカウントログイン", "KAI Cloud にログインして、購入申請、注文、検収状況を確認します。"],
  ko: ["개인 계정 로그인", "KAI Cloud에 로그인하여 구매 신청, 주문 및 검수 진행 상황을 확인하세요."],
  fr: ["Connexion au compte personnel", "Connectez-vous à KAI Cloud pour consulter les demandes d’achat, commandes et réceptions."],
  th: ["เข้าสู่ระบบบัญชีส่วนบุคคล", "เข้าสู่ระบบ KAI Cloud เพื่อดูคำขอซื้อ คำสั่งซื้อ และความคืบหน้าการตรวจรับ"],
  vi: ["Đăng nhập tài khoản cá nhân", "Đăng nhập KAI Cloud để xem yêu cầu mua, đơn hàng và tiến độ nghiệm thu."],
  id: ["Masuk akun pribadi", "Masuk ke KAI Cloud untuk melihat permintaan pembelian, pesanan, dan progres penerimaan."],
  ms: ["Log masuk akaun peribadi", "Log masuk KAI Cloud untuk melihat permohonan pembelian, pesanan dan kemajuan penerimaan."],
} as const satisfies Record<Locale, readonly [string, string]>;

export async function generateMetadata(): Promise<Metadata> {
  const [title, description] = metadataCopy[await getRequestLocale()];
  return { title, description };
}

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
