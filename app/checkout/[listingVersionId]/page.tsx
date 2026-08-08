import type { Metadata } from "next";
import { CapacityCheckout } from "@/components/capacity-checkout";

export const metadata: Metadata = {
  title: "确认资源与服务时间",
  description: "选择购买数量和连续服务时间，提交供应商确认并锁定容量。",
};

type CheckoutPageProps = {
  params: Promise<{ listingVersionId: string }>;
};

export default async function CheckoutPage({ params }: CheckoutPageProps) {
  const { listingVersionId } = await params;
  return (
    <div className="shell py-10 sm:py-14">
      <CapacityCheckout listingVersionId={listingVersionId} />
    </div>
  );
}
