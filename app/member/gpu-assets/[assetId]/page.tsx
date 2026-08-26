import type { Metadata } from "next";
import { AccountRequired } from "@/components/account-required";
import { ManagedGpuAssetDetail } from "@/components/managed-gpu-asset-detail";
import styles from "@/components/managed-gpu.module.css";

export const metadata: Metadata = { title: "GPU 资产详情", description: "查看实体 GPU 确权、托管与退出寄送状态。" };

export default async function ManagedGpuAssetDetailPage({ params }: { params: Promise<{ assetId: string }> }) {
  const { assetId } = await params;
  return <main className={`shell ${styles.workspace}`}><AccountRequired purpose="查看 GPU 资产详情" redirectOnSignedOut><ManagedGpuAssetDetail assetId={assetId} /></AccountRequired></main>;
}
