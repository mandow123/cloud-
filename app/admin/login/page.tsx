import type { Metadata } from "next";
import { AdminLogin } from "@/components/admin-login";
import { getRequestLocale } from "@/lib/server/request-locale";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getRequestLocale();
  const titles = { "zh-CN": "管理员登录", "zh-TW": "管理員登入", en: "Administrator sign-in", ja: "管理者ログイン", ko: "관리자 로그인", fr: "Connexion administrateur", th: "เข้าสู่ระบบผู้ดูแล", vi: "Đăng nhập quản trị", id: "Masuk administrator", ms: "Log masuk pentadbir" } as const;
  return { title: titles[locale] };
}

export default function AdminLoginPage() {
  return <AdminLogin />;
}
