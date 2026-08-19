import type { Metadata } from "next";
import { AccountRequired } from "@/components/account-required";
import { MemberPurchaseIntentList } from "@/components/member-purchase-intents";

export const metadata: Metadata = { title: "算力申请记录", description: "查看当前交易主体提交的算力询价快照与人工交付进度。" };

export default function MemberPurchasesPage() {
  return <main className="shell py-12 sm:py-16"><AccountRequired purpose="查看算力申请" redirectOnSignedOut><MemberPurchaseIntentList /></AccountRequired></main>;
}
