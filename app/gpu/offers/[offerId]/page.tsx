import type { Metadata } from "next";
import { HostingOfferCheckout } from "@/components/hosting-offer-checkout";

export const metadata: Metadata = {
  title: "确认 GPU 租用",
  description: "确认经过验真的 GPU 报价，并锁定 KAI 标准卡时。",
};

export default async function HostingOfferPage({ params }: { params: Promise<{ offerId: string }> }) {
  const { offerId } = await params;
  return <HostingOfferCheckout offerId={offerId} />;
}
