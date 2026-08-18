import type { Metadata } from "next";
import { HostingContractList } from "@/components/hosting-contract-list";

export const metadata: Metadata = {
  title: "我的 GPU 租赁",
  description: "查看 GPU 租赁、实例交付、计量、验收和清理状态。",
};

export default function HostingContractsPage() {
  return <HostingContractList />;
}
