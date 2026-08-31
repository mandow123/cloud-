import type { Metadata } from "next";
import { AdminManagedGpu } from "@/components/admin-managed-gpu";
import type { Locale } from "@/lib/i18n";
import { getRequestLocale } from "@/lib/server/request-locale";

const TITLES = { "zh-CN": "GPU 云托管运营", "zh-TW": "GPU 雲端託管營運", en: "Managed GPU Operations", ja: "GPU ホスティング運用", ko: "GPU 호스팅 운영", fr: "Opérations GPU hébergées", th: "การดำเนินงาน GPU แบบโฮสต์", vi: "Vận hành GPU lưu trữ", id: "Operasi GPU Terkelola", ms: "Operasi GPU Terurus" } satisfies Record<Locale, string>;
export async function generateMetadata(): Promise<Metadata> { return { title: TITLES[await getRequestLocale()] }; }
export default function AdminManagedGpuPage() { return <AdminManagedGpu />; }
