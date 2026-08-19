import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AccountRequired } from "@/components/account-required";
import { AccountConsoleShell } from "@/components/account-console-shell";
import { SupplyConsoleShell } from "@/components/supply-console-shell";
import { isAccountConsoleV2Enabled } from "@/lib/server/account-console-feature";
import { isHostingV2Enabled, isHostingV2SetupEnabled } from "@/lib/server/hosting-v2-feature";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { default: "供应商控制台", template: "%s｜供应商控制台｜KAI Cloud" },
  description: "管理 KAI Cloud 供应主体、设备、挂牌、订单、收益和风险状态。",
};

function hostingLandingUrl() {
  const origin = process.env.KAI_PUBLIC_ORIGIN?.trim();
  return origin ? new URL("/hosting", origin).toString() : "/hosting";
}

export default function SupplyLayout({ children }: { children: React.ReactNode }) {
  const accountConsoleV2Enabled = isAccountConsoleV2Enabled();
  if (!accountConsoleV2Enabled && !isHostingV2SetupEnabled()) redirect(hostingLandingUrl());

  const configurationMode = !isHostingV2Enabled();
  const console = accountConsoleV2Enabled
    ? <AccountConsoleShell configurationMode={configurationMode} mode="supplier">{children}</AccountConsoleShell>
    : <SupplyConsoleShell configurationMode={configurationMode}>{children}</SupplyConsoleShell>;

  return (
    <AccountRequired purpose="管理供应资源">
      {console}
    </AccountRequired>
  );
}
