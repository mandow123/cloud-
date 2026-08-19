import type { Metadata } from "next";
import { AccountConsoleOverview } from "@/components/account-console-overview";
import { SupplyDashboard } from "@/components/supply-dashboard";
import { isAccountConsoleV2Enabled } from "@/lib/server/account-console-feature";

export const metadata: Metadata = {
  title: "供应概览",
  description: "查看当前组织的供应资源申请、人工审核状态与最近提交记录。",
};

export default function SupplyPage() {
  return isAccountConsoleV2Enabled() ? <AccountConsoleOverview mode="supplier" /> : <SupplyDashboard />;
}
