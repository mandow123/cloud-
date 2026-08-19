export type ActivityCampaign = Readonly<{
  id: string; slug: string; title: string; summary: string;
  status: "UPCOMING" | "ACTIVE" | "EVERGREEN" | "CLOSED";
  startsAt: string | null; endsAt: string | null; rewardLabel: string;
}>;

export type ActivitySubmission = Readonly<{
  id: string; campaignId: string; campaignTitle: string; authorName: string;
  title: string; description: string; promptExcerpt: string;
  status: "PENDING" | "PUBLISHED" | "REJECTED";
  voteCount: number; rewardUnits: number; createdAt: string;
  assetUrl: string; votedByViewer: boolean;
}>;

export type ActivityIdentity = Readonly<{
  id: string; displayName: string; email: string | null;
  source: "account" | "chatgpt";
}>;

export type ActivitySnapshot = Readonly<{
  campaigns: ActivityCampaign[];
  submissions: ActivitySubmission[];
  leaderboard: ActivitySubmission[];
  viewer: ActivityIdentity | null;
  mySubmissions: ActivitySubmission[];
  rewardBalance: number;
}>;
