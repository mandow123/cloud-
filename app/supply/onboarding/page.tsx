import type { Metadata } from "next";
import { SupplierOnboardingForm } from "@/components/supplier-onboarding-form";
import { requireSupplyHostingPageAccess } from "@/lib/server/account-console-page-gate";

export const metadata: Metadata = {
  title: "供应商审核",
  description: "创建供应主体资料、保存草稿并提交 KAI Hosting 人工审核。",
};

export default function SupplyOnboardingPage() {
  requireSupplyHostingPageAccess();
  return <SupplierOnboardingForm />;
}
