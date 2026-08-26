import type { Metadata } from "next";
import { AccountRequired } from "@/components/account-required";
import { ManagedGpuMemberDashboard } from "@/components/managed-gpu-member-dashboard";
import styles from "@/components/managed-gpu.module.css";
export const metadata: Metadata = { title: "实体 GPU 购买订单", description: "查看实体 GPU 报价、付款确认、确权与交付进度。" };
export default function ManagedGpuOrdersPage() { return <main className={`shell ${styles.workspace}`}><AccountRequired purpose="查看实体 GPU 购买订单" redirectOnSignedOut><ManagedGpuMemberDashboard view="orders" /></AccountRequired></main>; }
