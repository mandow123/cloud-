import type { Metadata } from "next";
import { AdminCardHourTopupAppeals } from "@/components/admin-card-hour-topup-appeals";

export const metadata: Metadata = { title: "充值异常申诉", description: "按付款单查看和处理用户充值异常申诉，不直接修改支付或卡时状态。" };
export default function AdminCardHourTopupAppealsPage() { return <AdminCardHourTopupAppeals />; }
