import type { Metadata } from "next";
import { SupplyOfferForm } from "@/components/supply-offer-form";

export const metadata: Metadata = {
  title: "提交上架申请",
  description: "提交资源规格、数量、地区和交付方式，保存到 KAI Cloud 供给数据库等待人工审核。",
};

export default function SupplyResourceApplicationPage() {
  return <SupplyOfferForm />;
}
