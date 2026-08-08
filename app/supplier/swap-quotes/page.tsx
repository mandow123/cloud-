import type { Metadata } from "next";
import { SupplierSwapWorkspace } from "@/components/supplier-swap-workspace";

export const metadata: Metadata = {
  title: "供应商资源置换报价",
  description: "选择两条在售容量生成有时效的置换价值快照。",
};

type SwapQuotesPageProps = {
  searchParams: Promise<{ wanted?: string | string[] }>;
};

export default async function SupplierSwapQuotesPage({ searchParams }: SwapQuotesPageProps) {
  const { wanted } = await searchParams;
  const initialWantedListingId = Array.isArray(wanted) ? wanted[0] ?? "" : wanted ?? "";
  return (
    <div className="shell py-10 sm:py-14">
      <SupplierSwapWorkspace initialWantedListingId={initialWantedListingId} />
    </div>
  );
}
