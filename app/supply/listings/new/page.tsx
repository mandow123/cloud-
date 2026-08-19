import type { Metadata } from "next";
import { SupplyOfferCreate } from "@/components/supply-offer-create";
import { requireSupplyHostingPageAccess } from "@/lib/server/account-console-page-gate";

export const metadata: Metadata = {
  title: "创建 GPU 挂牌",
  description: "选择验真设备并创建按 KAI 标准卡时计价的 GPU 报价。",
};

export default function SupplyOfferCreatePage() {
  requireSupplyHostingPageAccess();
  return <SupplyOfferCreate />;
}
