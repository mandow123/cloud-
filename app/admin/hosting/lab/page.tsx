import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AdminGpuLab } from "@/components/admin-gpu-lab";

export const metadata: Metadata = {
  title: "本地 GPU 闭环实验室",
  description: "仅供本地管理员验证旧版 GPU 闭环，不连接生产市场。",
};

export default function AdminHostingLabPage() {
  if (process.env.KAI_ENVIRONMENT !== "LOCAL" || process.env.KAI_GPU_LAB_ENABLED !== "1") notFound();
  return <AdminGpuLab />;
}
