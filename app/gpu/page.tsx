import type { Metadata } from "next";
import { HostingGpuMarketplace } from "@/components/hosting-gpu-marketplace";

export const metadata: Metadata = {
  title: "GPU 云市场",
  description: "筛选、比较并租用经过验真的 GPU 算力资源。",
};

export default function GpuMarketplacePage() {
  return <HostingGpuMarketplace />;
}
