import type { Metadata } from "next";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { LocaleProvider } from "@/components/locale-provider";
import "./fonts.css";
import "./globals.css";
import "./kai-cloud.css";

export async function generateMetadata(): Promise<Metadata> {
  const configuredOrigin = typeof process !== "undefined" ? process.env.KAI_PUBLIC_ORIGIN : undefined;
  const metadataBase = new URL(configuredOrigin ?? "https://cloud.kai.com");
  const title = "KAI Cloud｜让算力抵达每一个需要它的时刻";
  const description = "连接可信算力供给与真实需求，以 KAI 卡时统一购买 GPU、Token、模型容量、云主机与企业算力资源。";

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
      images: [{ url: "/og-home-v2.png", width: 1730, height: 909, alt: "KAI Cloud，让算力抵达每一个需要它的时刻" }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: ["/og-home-v2.png"],
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
        <LocaleProvider>
          <a className="skip-link" href="#main-content">
            跳到主要内容
          </a>
          <SiteHeader />
          <main id="main-content">{children}</main>
          <SiteFooter />
        </LocaleProvider>
      </body>
    </html>
  );
}
