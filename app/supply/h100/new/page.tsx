import type { Metadata } from "next";
import { SupplyH100Form } from "@/components/supply-h100-form";

export const metadata: Metadata = {
  title: "新建 H100 8 卡资源池",
  description: "申报 H100 SXM5 80GB 8 卡整机试运行资源，创建验真任务与发布预览。",
};

export default function NewH100SupplyPage() {
  return <SupplyH100Form />;
}
