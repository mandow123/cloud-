import type { Metadata } from "next";
import { AdminManagedGpu } from "@/components/admin-managed-gpu";
export const metadata: Metadata = { title: "GPU 云托管运营" };
export default function AdminManagedGpuPage() { return <AdminManagedGpu />; }
