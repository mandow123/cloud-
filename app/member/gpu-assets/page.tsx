import type { Metadata } from "next";
import { AccountRequired } from "@/components/account-required";
import { ManagedGpuMemberDashboard } from "@/components/managed-gpu-member-dashboard";
import styles from "@/components/managed-gpu.module.css";
export const metadata: Metadata = { title: "我的 GPU", description: "查看当前组织独立确权的实体 GPU 与托管状态。" };
export default function MemberGpuAssetsPage() { return <main className={`shell ${styles.workspace}`}><AccountRequired purpose="查看实体 GPU 资产" redirectOnSignedOut><ManagedGpuMemberDashboard view="assets" /></AccountRequired></main>; }
