import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { SupplyResourceRegistration } from "@/components/supply-resource-registration";
import { requireSupplyHostingPageAccess } from "@/lib/server/account-console-page-gate";
import { isTelemetryApplicationEligibleForAccount } from "@/lib/server/agent-telemetry-application-eligibility";
import { isAgentTelemetryV1Enabled } from "@/lib/server/agent-telemetry-feature";
import { requireTradingAccountSession } from "@/lib/server/entity-ownership";

export const metadata: Metadata = {
  title: "连接托管设备",
  description: "选择设备模板并签发一次性 KAI Host Agent 配对凭证。",
};

export default async function SupplyDeviceRegistrationPage({ searchParams }: {
  searchParams: Promise<{ applicationId?: string | string[] }>;
}) {
  const params = await searchParams;
  const rawApplicationId = Array.isArray(params.applicationId) ? params.applicationId[0] : params.applicationId;
  const applicationId = rawApplicationId?.trim() || null;
  const telemetryEnabled = isAgentTelemetryV1Enabled();

  if (applicationId && !telemetryEnabled) redirect("/supply/applications");
  if (applicationId) {
    const incomingHeaders = await headers();
    const publicOrigin = process.env.KAI_PUBLIC_ORIGIN?.trim();
    let eligible = false;
    try {
      const requestUrl = new URL("/supply/devices/new", publicOrigin || "http://127.0.0.1");
      const account = await requireTradingAccountSession(new Request(requestUrl, { headers: new Headers(incomingHeaders) }));
      eligible = await isTelemetryApplicationEligibleForAccount(account, applicationId);
    } catch {
      eligible = false;
    }
    if (!eligible) redirect("/supply/applications");
  } else {
    requireSupplyHostingPageAccess();
  }

  return <SupplyResourceRegistration telemetryApplicationId={applicationId} />;
}
