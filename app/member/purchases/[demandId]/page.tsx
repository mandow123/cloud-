import type { Metadata } from "next";
import { AccountRequired } from "@/components/account-required";
import { MemberPurchaseIntentDetail } from "@/components/member-purchase-intents";

export const metadata: Metadata = { title: "算力申请详情", description: "查看提交时冻结的算力规格、卡时参考与人工交付进度。" };

export default async function MemberPurchaseDetailPage({ params }: { params: Promise<{ demandId: string }> }) {
  const { demandId } = await params;
  return <AccountRequired purpose="查看算力申请详情" redirectOnSignedOut><MemberPurchaseIntentDetail demandId={demandId} /></AccountRequired>;
}
