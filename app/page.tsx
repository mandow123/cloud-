import type { Metadata } from "next";
import { ActivityHub } from "@/components/activity-hub";

export const metadata: Metadata = {
  title: "创作挑战与活动广场",
  description: "参加 KAI Creator AI 创作挑战，提交作品、参与投票、登上排行榜并赢取创作奖励。",
};

export default function Home() {
  return <ActivityHub />;
}
