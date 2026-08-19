import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ActivityDetail } from "@/components/activity-detail";
import { activityBySlug, activityCatalog } from "@/lib/activity-catalog";

export function generateStaticParams() {
  return activityCatalog.map((activity) => ({ slug: activity.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const activity = activityBySlug((await params).slug);
  if (!activity) return {};
  return { title: activity.title, description: activity.brief, openGraph: { title: activity.title, description: activity.brief, images: [] }, twitter: { title: activity.title, description: activity.brief, images: [] } };
}

export default async function ActivityDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const activity = activityBySlug((await params).slug);
  if (!activity) notFound();
  return <ActivityDetail activity={activity} />;
}
