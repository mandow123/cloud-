import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AccountRequired } from "@/components/account-required";
import { CardHourTopupAppealForm } from "@/components/card-hour-topup-appeal-form";

export const metadata: Metadata = { title: "充值申诉", description: "针对指定付款单提交充值异常人工核对申请。" };

export default async function CardHourTopupAppealPage({ params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;
  if (!/^KAI_CH_[A-Za-z0-9]{16,56}$/u.test(orderId)) notFound();
  return <AccountRequired purpose="提交充值异常申诉" redirectOnSignedOut><CardHourTopupAppealForm orderId={orderId} /></AccountRequired>;
}
