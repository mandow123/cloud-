import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AdminManualAppeals } from "@/components/admin-manual-appeals";
import { manualAppealsEnabled } from "@/lib/server/manual-appeals";

export const metadata: Metadata = { title: "人工申诉", description: "处理人工交付申请的申诉、双方消息和线下凭证核验状态。" };
export default function AdminAppealsPage() { if (!manualAppealsEnabled()) notFound(); return <AdminManualAppeals />; }
