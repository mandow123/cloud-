import type { Metadata } from "next";
import { ActivityAdmin } from "@/components/activity-admin";

export const metadata: Metadata = { title: "活动与作品管理" };
export default function ActivityAdminPage() { return <ActivityAdmin />; }
