import type { Metadata } from "next";
import { AccountRequired } from "@/components/account-required";
import { ManagedGpuQuoteForm } from "@/components/managed-gpu-quote-form";
import styles from "@/components/managed-gpu.module.css";

export const metadata: Metadata = { title: "申请 GPU 云托管报价", description: "申请实体 GPU 的供应商正式报价并选择托管或寄送。" };

export default async function ManagedGpuConfigurePage({ searchParams }: { searchParams: Promise<{ product?: string }> }) {
  const productId = (await searchParams).product?.trim() ?? "";
  return <main className={`narrow-shell ${styles.workspace}`}><AccountRequired purpose="申请实体 GPU 报价" redirectOnSignedOut><ManagedGpuQuoteForm productId={productId} /></AccountRequired></main>;
}
