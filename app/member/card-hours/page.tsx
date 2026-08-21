import type { Metadata } from "next";
import { AccountRequired } from "@/components/account-required";
import { MemberCardHourAssets } from "@/components/member-card-hour-assets";

export const metadata: Metadata = { title: "我的资产与卡时账户", description: "查看 KAI 标准卡时资产并选择已开放的充值支付方式。" };

export default function MemberCardHoursPage() {
  return <AccountRequired purpose="管理卡时资产" redirectOnSignedOut><MemberCardHourAssets /></AccountRequired>;
}
