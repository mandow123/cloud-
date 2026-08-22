import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AdminShell } from "@/components/admin-shell";
import { manualAppealsEnabled } from "@/lib/server/manual-appeals";
import "./admin.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { default: "管理后台", template: "%s｜KAI ADMIN" },
  robots: { index: false, follow: false, nocache: true },
};

function environmentLabel() {
  const configured = process.env.KAI_ENVIRONMENT ?? process.env.KAI_ENV ?? process.env.DEPLOYMENT_ENV;
  if (configured?.trim()) return configured.trim().toUpperCase();
  return process.env.NODE_ENV === "development" && process.env.KAI_ADMIN_LOCAL_AUTH === "1" ? "LOCAL" : process.env.NODE_ENV === "development" ? "DEVELOPMENT" : "UNKNOWN";
}

export default function AdminLayout({ children }: { children: ReactNode }) {
  return <AdminShell appealsEnabled={manualAppealsEnabled()} environment={environmentLabel()}>{children}</AdminShell>;
}
