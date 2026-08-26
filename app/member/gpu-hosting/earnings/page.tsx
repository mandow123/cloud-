import type { Metadata } from "next";
import { AccountRequired } from "@/components/account-required";
import { ManagedGpuMemberDashboard } from "@/components/managed-gpu-member-dashboard";
import styles from "@/components/managed-gpu.module.css";
export const metadata: Metadata = { title: "托管产出卡时", description: "查看真实成交形成的小时暂估、每日确认与月度入账卡时。" };
export default function ManagedGpuEarningsPage() { return <main className={`shell ${styles.workspace}`}><AccountRequired purpose="查看托管产出卡时" redirectOnSignedOut><ManagedGpuMemberDashboard view="earnings" /></AccountRequired></main>; }
