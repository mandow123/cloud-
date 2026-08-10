import type { Metadata } from "next";
import { GpuMarketplaceLab } from "@/components/gpu-cloud-lab";

export const metadata: Metadata = {
  title: "GPU 云市场",
  description: "筛选、比较并租用经过验真的 GPU 算力资源。",
};

export default function GpuMarketplacePage() {
  return <GpuMarketplaceLab />;
}
