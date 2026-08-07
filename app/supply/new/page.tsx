import type { Metadata } from "next";
import { AccountRequired } from "@/components/account-required";
import { SupplyOfferForm } from "@/components/supply-offer-form";

export const metadata: Metadata = {
  title: "通用资源上架",
  description: "登记 GPU、服务器、Mac、Token、模型、存储、机柜和云厂商资源供给。",
};

export default function NewSupplyOfferPage() {
  return (
    <AccountRequired purpose="上架算力资源">
      <SupplyOfferForm />
    </AccountRequired>
  );
}
