import type { Metadata } from "next";
import { AdminLogin } from "@/components/admin-login";

export const metadata: Metadata = { title: "管理员登录" };

function environmentLabel() {
  const configured = process.env.KAI_ENVIRONMENT ?? process.env.KAI_ENV ?? process.env.DEPLOYMENT_ENV;
  if (configured?.trim()) return configured.trim().toUpperCase();
  return process.env.NODE_ENV === "development" && process.env.KAI_ADMIN_LOCAL_AUTH === "1" ? "LOCAL" : process.env.NODE_ENV === "development" ? "DEVELOPMENT" : "UNKNOWN";
}

export default function AdminLoginPage() {
  const environment = environmentLabel();
  const localLoginEnabled = environment === "LOCAL" && process.env.KAI_ADMIN_LOCAL_AUTH === "1";
  return <AdminLogin environment={environment} localLoginEnabled={localLoginEnabled} />;
}
