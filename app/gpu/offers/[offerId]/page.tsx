import type { Metadata } from "next";
import { HostingOfferCheckout } from "@/components/hosting-offer-checkout";

export const metadata: Metadata = {
  title: "GPU 报价详情",
  description: "查看经过验真的 GPU 报价；交易就绪后才可锁定 KAI 标准卡时。",
};

export default async function HostingOfferPage({ params }: { params: Promise<{ offerId: string }> }) {
  const { offerId } = await params;
  return <HostingOfferCheckout offerId={offerId} />;
}
