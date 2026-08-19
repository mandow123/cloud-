import type { Metadata } from "next";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import "./fonts.css";
import "./globals.css";
import "./kai-cloud.css";

export async function generateMetadata(): Promise<Metadata> {
  const configuredOrigin = typeof process !== "undefined" ? process.env.KAI_PUBLIC_ORIGIN : undefined;
  const metadataBase = new URL(configuredOrigin ?? "https://cloud.kai.com");
  const title = "KAI Creator｜AI 创作挑战与活动广场";
  const description = "参加原创 AI 创作挑战，提交作品、参与投票、登上排行榜并赢取创作奖励。";

  return {
    metadataBase,
    title: { default: title, template: "%s｜KAI Cloud" },
    description,
    keywords: ["AI 创作", "创作比赛", "AI 活动", "作品投稿", "创作者社区", "KAI Creator"],
    openGraph: {
      type: "website",
      locale: "zh_CN",
      siteName: "KAI Creator",
      title,
      description,
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
    },
  };
}

const themeScript = `(() => {
  try {
    const saved = localStorage.getItem('kai-color-mode');
    const preference = saved === 'light' || saved === 'dark' ? saved : 'system';
    const resolved = preference === 'system'
      ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
      : preference;
    document.documentElement.dataset.colorPreference = preference;
    document.documentElement.dataset.colorMode = resolved;
  } catch (_) {
    document.documentElement.dataset.colorPreference = 'system';
  }
})();`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="kai-root">
        <a className="skip-link" href="#main-content">
          跳到主要内容
        </a>
        <SiteHeader />
        <main id="main-content">{children}</main>
        <SiteFooter />
      </body>
    </html>
  );
}
