import type { Metadata } from "next";
import { SupplyOfferRecords } from "@/components/supply-offer-records";
import { isAgentTelemetryV1Enabled } from "@/lib/server/agent-telemetry-feature";

export const metadata: Metadata = {
  title: "上架申请",
  description: "查看当前交易主体提交的资源上架申请及人工审核状态。",
};

export default function SupplyApplicationsPage() {
  return isAgentTelemetryV1Enabled()
    ? <SupplyOfferRecords telemetryEnabled />
    : <SupplyOfferRecords />;
}
