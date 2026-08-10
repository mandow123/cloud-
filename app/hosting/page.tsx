import type { Metadata } from "next";
import { GpuHostingLab } from "@/components/gpu-cloud-lab";

export const metadata: Metadata = {
  title: "Hosting 算力上架",
  description: "个人 GPU、云服务器与数据中心统一上架、验真、交付与结算。",
};

export default function HostingPage() {
  return <GpuHostingLab />;
}
