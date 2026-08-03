import type { Metadata } from "next";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import "./fonts.css";
import "./globals.css";
import "./kai-cloud.css";

export async function generateMetadata(): Promise<Metadata> {
  const configuredOrigin = typeof process !== "undefined" ? process.env.KAI_PUBLIC_ORIGIN : undefined;
  const metadataBase = new URL(configuredOrigin ?? "https://cloud.kai.com");
  const title = "KAI Cloud｜中国 Token 学院算力市场";
  const description = "聚合 GPU、Token、模型容量、整机柜与云厂商资源，以标准化行情驱动算力租赁与置换。";

  return {
    metadataBase,
    title: { default: title, template: "%s｜KAI Cloud" },
    description,
    keywords: ["算力租赁", "GPU 租赁", "GPU 置换", "Token 服务", "算力行情", "KAI Cloud"],
    openGraph: {
      type: "website",
      locale: "zh_CN",
      siteName: "KAI Cloud",
      title,
      description,
      images: [{ url: "/og.png", width: 1734, height: 907, alt: "KAI Cloud 算力行情与资源撮合" }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: ["/og.png"],
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
