import type { Metadata } from "next";
import { DM_Sans, Noto_Sans_SC, Work_Sans } from "next/font/google";
import { headers } from "next/headers";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import "./globals.css";

const displayFont = DM_Sans({
  variable: "--font-display",
  subsets: ["latin"],
  display: "swap",
});

const textFont = Work_Sans({
  variable: "--font-text-latin",
  subsets: ["latin"],
  display: "swap",
});

const chineseFont = Noto_Sans_SC({
  variable: "--font-text-cjk",
  subsets: ["latin"],
  weight: ["400", "600", "700"],
  display: "swap",
});

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "cloud.kai.com";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const metadataBase = new URL(`${protocol}://${host}`);
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
      images: [{ url: "/og.png", width: 1730, height: 909, alt: "KAI Cloud 中国 Token 学院算力市场" }],
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
      <body className={`${displayFont.variable} ${textFont.variable} ${chineseFont.variable}`}>
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
