import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AccountRequired } from "@/components/account-required";
import { SupplyConsoleShell } from "@/components/supply-console-shell";
import { isHostingV2Enabled, isHostingV2SetupEnabled } from "@/lib/server/hosting-v2-feature";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { default: "供应商控制台", template: "%s｜供应商控制台｜KAI Cloud" },
  description: "管理 KAI Cloud 供应主体、设备、挂牌、订单、收益和风险状态。",
};

export default function SupplyLayout({ children }: { children: React.ReactNode }) {
  if (!isHostingV2SetupEnabled()) redirect("/hosting");

  return (
    <AccountRequired purpose="管理供应资源">
      <SupplyConsoleShell configurationMode={!isHostingV2Enabled()}>{children}</SupplyConsoleShell>
    </AccountRequired>
  );
}
