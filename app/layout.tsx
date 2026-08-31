import type { Metadata } from "next";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { LocaleProvider } from "@/components/locale-provider";
import { translate } from "@/lib/i18n";
import { getRequestLocale } from "@/lib/server/request-locale";
import "./fonts.css";
import "./globals.css";
import "./kai-cloud.css";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getRequestLocale();
  const configuredOrigin = typeof process !== "undefined" ? process.env.KAI_PUBLIC_ORIGIN : undefined;
  const metadataBase = new URL(configuredOrigin ?? "https://cloud.kai.com");
  const metadataCopy = {
    "zh-CN": ["KAI Cloud｜让算力抵达每一个需要它的时刻", "连接可信算力供给与真实需求，以 KAI 卡时统一购买 GPU、Token、模型容量、云主机与企业算力资源。", ["算力租赁", "GPU 租赁", "GPU 置换", "Token 服务", "算力行情", "KAI Cloud"]],
    "zh-TW": ["KAI Cloud｜讓算力抵達每一個需要它的時刻", "連接可信算力供給與真實需求，以 KAI 卡時統一購買 GPU、Token、模型容量、雲主機與企業算力資源。", ["算力租賃", "GPU 租賃", "GPU 置換", "Token 服務", "算力行情", "KAI Cloud"]],
    en: ["KAI Cloud | Compute where it is needed", "Connect verified compute supply with real demand and purchase GPU, model, token, cloud and enterprise capacity with KAI card-hours.", ["compute rental", "GPU rental", "GPU marketplace", "Token services", "compute pricing", "KAI Cloud"]],
    ja: ["KAI Cloud｜必要な場所へ計算資源を", "信頼できる計算資源と実需をつなぎ、KAI カード時で GPU、モデル、Token、クラウド、企業向け容量を購入できます。", ["計算資源レンタル", "GPU レンタル", "GPU 市場", "Token サービス", "計算資源価格", "KAI Cloud"]],
    ko: ["KAI Cloud | 필요한 곳에 컴퓨팅을", "검증된 컴퓨팅 공급과 실제 수요를 연결하고 KAI 카드시간으로 GPU, 모델, Token, 클라우드 및 기업 용량을 구매합니다.", ["컴퓨팅 대여", "GPU 대여", "GPU 시장", "Token 서비스", "컴퓨팅 가격", "KAI Cloud"]],
    fr: ["KAI Cloud | Le calcul là où il est nécessaire", "Reliez une offre de calcul vérifiée à la demande réelle et achetez des GPU, modèles, tokens, ressources cloud et capacités d’entreprise en heures-carte KAI.", ["location de calcul", "location GPU", "marché GPU", "services Token", "prix du calcul", "KAI Cloud"]],
    th: ["KAI Cloud | พลังประมวลผลในทุกที่ที่ต้องการ", "เชื่อมต่อทรัพยากรประมวลผลที่ตรวจสอบแล้วกับความต้องการจริง และซื้อ GPU โมเดล Token คลาวด์ และทรัพยากรองค์กรด้วยชั่วโมงการ์ด KAI", ["เช่าพลังประมวลผล", "เช่า GPU", "ตลาด GPU", "บริการ Token", "ราคาพลังประมวลผล", "KAI Cloud"]],
    vi: ["KAI Cloud | Năng lực tính toán đúng nơi cần thiết", "Kết nối nguồn lực tính toán đã xác minh với nhu cầu thực và mua GPU, mô hình, Token, đám mây và năng lực doanh nghiệp bằng giờ-thẻ KAI.", ["thuê năng lực tính toán", "thuê GPU", "thị trường GPU", "dịch vụ Token", "giá năng lực", "KAI Cloud"]],
    id: ["KAI Cloud | Komputasi di tempat yang dibutuhkan", "Hubungkan pasokan komputasi terverifikasi dengan kebutuhan nyata dan beli GPU, model, Token, cloud, serta kapasitas perusahaan dengan jam-kartu KAI.", ["sewa komputasi", "sewa GPU", "pasar GPU", "layanan Token", "harga komputasi", "KAI Cloud"]],
    ms: ["KAI Cloud | Pengkomputeran di tempat yang diperlukan", "Hubungkan bekalan pengkomputeran yang disahkan dengan permintaan sebenar dan beli GPU, model, Token, awan serta kapasiti perusahaan dengan jam-kad KAI.", ["sewa pengkomputeran", "sewa GPU", "pasaran GPU", "perkhidmatan Token", "harga pengkomputeran", "KAI Cloud"]],
  } as const;
  const [title, description, keywords] = metadataCopy[locale];

  return {
    metadataBase,
    title: { default: title, template: "%s｜KAI Cloud" },
    description,
    keywords: [...keywords],
    openGraph: {
      type: "website",
      locale: locale.replace("-", "_"),
      siteName: "KAI Cloud",
      title,
      description,
      images: [{ url: "/og-home-v2.png", width: 1730, height: 909, alt: title }],
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

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getRequestLocale();
  return (
    <html lang={locale} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="kai-root">
        <LocaleProvider initialLocale={locale}>
          <a className="skip-link" href="#main-content">
            {translate(locale, "skipToContent")}
          </a>
          <SiteHeader />
          <main id="main-content">{children}</main>
          <SiteFooter />
        </LocaleProvider>
      </body>
    </html>
  );
}
