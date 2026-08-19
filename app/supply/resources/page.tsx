import type { Metadata } from "next";
import { SupplyOfferRecords } from "@/components/supply-offer-records";

export const metadata: Metadata = {
  title: "上架申请",
  description: "查看当前交易主体提交的资源上架申请及人工审核状态。",
};

export default function SupplyResourceApplicationsPage() {
  return <SupplyOfferRecords />;
}
