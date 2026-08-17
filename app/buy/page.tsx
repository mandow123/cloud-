import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AccountRequired } from "@/components/account-required";
import { BuyWorkspace } from "@/components/buy-workspace";
import { PRODUCT_PATHS } from "@/lib/product-surface-policy";
import { isMarketV1Enabled } from "@/lib/server/market-v1-feature";

export const metadata: Metadata = {
  title: "购买算力",
  description: "使用 KAI 卡时查看并租用当前经过验真、可成交的 GPU 算力。",
};

export default function BuyPage() {
  if (isMarketV1Enabled()) redirect(PRODUCT_PATHS.gpu);
  return (
    <AccountRequired purpose="进入购买算力工作台" redirectOnSignedOut>
      <BuyWorkspace />
    </AccountRequired>
  );
}
