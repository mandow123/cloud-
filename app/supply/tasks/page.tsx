import type { Metadata } from "next";
import { SupplyTaskQueue } from "@/components/supply-task-queue";
import { requireSupplyHostingPageAccess } from "@/lib/server/account-console-page-gate";

export const metadata: Metadata = {
  title: "待办",
  description: "处理托管设备、验真、挂牌与履约中的真实阻塞事项。",
};

export default function SupplyTasksPage() {
  requireSupplyHostingPageAccess();
  return <SupplyTaskQueue />;
}
