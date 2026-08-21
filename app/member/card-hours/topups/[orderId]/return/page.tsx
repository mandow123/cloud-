import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AccountRequired } from "@/components/account-required";
import { CardHourTopupReturn } from "@/components/card-hour-topup-return";

export const metadata: Metadata = { title: "卡时充值状态", description: "从平台服务端查询卡时付款单的真实入账状态。" };

export default async function CardHourTopupReturnPage({ params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;
  if (!/^KAI_CH_[A-Za-z0-9]{16,56}$/u.test(orderId)) notFound();
  return <AccountRequired purpose="查看卡时充值状态" redirectOnSignedOut><CardHourTopupReturn orderId={orderId} /></AccountRequired>;
}
