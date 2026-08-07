import type { Metadata } from "next";
import { SupplyMacImport } from "@/components/supply-mac-import";

export const metadata: Metadata = {
  title: "Mac mini 批量入库",
  description: "批量导入最多 300 台 Mac mini，创建检测任务并按规格分组；首期不开放成交。",
};

export default function MacSupplyImportPage() {
  return <SupplyMacImport />;
}
