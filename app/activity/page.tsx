import type { Metadata } from "next";
import { ActivityHub } from "@/components/activity-hub";

export const metadata: Metadata = {
  title: "创作活动广场",
  description: "参加 KAI Cloud 创作任务、社区共创赛与限时算力挑战。",
};

export default function ActivityPage() {
  return <ActivityHub />;
}
