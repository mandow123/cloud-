"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { formatCardHourValue } from "@/lib/card-hours";
import { useLocale } from "@/components/locale-provider";
import type { Locale } from "@/lib/i18n";

export type HomeMarketSummary = {
  publishedAt: string;
  quoteCount: number;
  indexCurrent: number;
  indexChange1d: number | null;
  indexChange7d: number | null;
  indexChange30d: number | null;
  gpuP50: number;
  gpuCurrency: "CNY";
  gpuPricingUnit: string;
  gpuResourceTitle: string;
};

type RemoteModelMarketSummary = Omit<
  HomeMarketSummary,
  "gpuP50" | "gpuCurrency" | "gpuPricingUnit" | "gpuResourceTitle"
>;

type HeroCopy = {
  invalidTime: string;
  sitePrice: string;
  oneHourDue: string;
  cardHours: string;
  fixedExchange: string;
  cnyPerCardHour: string;
  tradableQuotes: string;
  verifiedResources: string;
  eyebrow: string;
  title: string;
  secondaryTitle: string;
  lead: string;
  exploreMarket: string;
  learnCardHours: string;
  liveResources: string;
  cardHourSettlement: string;
  trustedDelivery: string;
  tradingInfo: string;
  syncError: string;
  checking: string;
  synced: string;
  safeSnapshot: string;
  lastPublished: string;
  settlementNotice: string;
  retry: string;
};

const HERO_COPY: Record<Locale, HeroCopy> = {
  "zh-CN": {
    invalidTime: "待确认", sitePrice: "H100 网站价", oneHourDue: "1 小时应付", cardHours: "KAI 卡时", fixedExchange: "固定兑换", cnyPerCardHour: "人民币 / KAI 卡时", tradableQuotes: "可交易报价", verifiedResources: "条已核验资源",
    eyebrow: "KAI CLOUD · 算力市场", title: "让算力，抵达每一个需要它的时刻。", secondaryTitle: "Compute, ready for every moment that matters.", lead: "连接可信算力供给与真实需求，以 KAI 卡时统一结算；从资源锁定到交付验收，全程清晰、可查、可验。", exploreMarket: "探索算力市场", learnCardHours: "了解 KAI 卡时", liveResources: "实时资源", cardHourSettlement: "卡时结算", trustedDelivery: "可信交付", tradingInfo: "当前交易信息",
    syncError: "目录同步异常，使用安全快照", checking: "正在核对可交易目录", synced: "可交易目录已同步", safeSnapshot: "可交易目录安全快照", lastPublished: "最近发布", settlementNotice: "全站资源仅支持 KAI 卡时结算 · 结账时锁定网站价", retry: "重试",
  },
  "zh-TW": {
    invalidTime: "待確認", sitePrice: "H100 網站價", oneHourDue: "1 小時應付", cardHours: "KAI 卡時", fixedExchange: "固定兌換", cnyPerCardHour: "人民幣 / KAI 卡時", tradableQuotes: "可交易報價", verifiedResources: "筆已核驗資源",
    eyebrow: "KAI CLOUD · 算力市場", title: "讓算力，抵達每一個需要它的時刻。", secondaryTitle: "Compute, ready for every moment that matters.", lead: "連接可信算力供給與真實需求，以 KAI 卡時統一結算；從資源鎖定到交付驗收，全程清晰、可查、可驗。", exploreMarket: "探索算力市場", learnCardHours: "了解 KAI 卡時", liveResources: "即時資源", cardHourSettlement: "卡時結算", trustedDelivery: "可信交付", tradingInfo: "目前交易資訊",
    syncError: "目錄同步異常，使用安全快照", checking: "正在核對可交易目錄", synced: "可交易目錄已同步", safeSnapshot: "可交易目錄安全快照", lastPublished: "最近發布", settlementNotice: "全站資源僅支援 KAI 卡時結算 · 結帳時鎖定網站價", retry: "重試",
  },
  en: {
    invalidTime: "Pending", sitePrice: "H100 site price", oneHourDue: "Due for 1 hour", cardHours: "KAI card-hours", fixedExchange: "Fixed exchange", cnyPerCardHour: "CNY / KAI card-hour", tradableQuotes: "Tradable quotes", verifiedResources: "verified resources",
    eyebrow: "KAI CLOUD · COMPUTE MARKETPLACE", title: "Compute, ready for every moment that matters.", secondaryTitle: "Verified supply, clear settlement, trusted delivery.", lead: "Connect verified compute supply with real demand and settle in KAI card-hours. Resource locking, delivery, and acceptance remain clear, traceable, and verifiable.", exploreMarket: "Explore compute market", learnCardHours: "Learn about KAI card-hours", liveResources: "Live resources", cardHourSettlement: "Card-hour settlement", trustedDelivery: "Trusted delivery", tradingInfo: "Current trading information",
    syncError: "Catalog sync unavailable; using a safe snapshot", checking: "Checking the tradable catalog", synced: "Tradable catalog synced", safeSnapshot: "Safe tradable catalog snapshot", lastPublished: "Last published", settlementNotice: "All resources settle only in KAI card-hours · Site price is locked at checkout", retry: "Retry",
  },
  ja: {
    invalidTime: "確認待ち", sitePrice: "H100 サイト価格", oneHourDue: "1 時間の支払額", cardHours: "KAI カード時", fixedExchange: "固定交換", cnyPerCardHour: "人民元 / KAI カード時", tradableQuotes: "取引可能価格", verifiedResources: "件の検証済み資源",
    eyebrow: "KAI CLOUD · コンピュート市場", title: "必要な瞬間へ、計算資源を届けます。", secondaryTitle: "検証済み供給、明確な決済、信頼できる納品。", lead: "信頼できる計算資源と実需を結び、KAI カード時で統一決済。資源の確保から納品・検収まで、明確で追跡・検証可能です。", exploreMarket: "計算資源市場を見る", learnCardHours: "KAI カード時について", liveResources: "リアルタイム資源", cardHourSettlement: "カード時決済", trustedDelivery: "信頼できる納品", tradingInfo: "現在の取引情報",
    syncError: "カタログ同期に失敗したため安全なスナップショットを使用中", checking: "取引可能カタログを確認中", synced: "取引可能カタログを同期済み", safeSnapshot: "取引可能カタログの安全なスナップショット", lastPublished: "最終公開", settlementNotice: "すべての資源は KAI カード時のみで決済 · チェックアウト時にサイト価格を固定", retry: "再試行",
  },
  ko: {
    invalidTime: "확인 대기", sitePrice: "H100 사이트 가격", oneHourDue: "1시간 결제액", cardHours: "KAI 카드시간", fixedExchange: "고정 환산", cnyPerCardHour: "위안 / KAI 카드시간", tradableQuotes: "거래 가능 견적", verifiedResources: "개의 검증된 자원",
    eyebrow: "KAI CLOUD · 컴퓨팅 시장", title: "필요한 순간마다 컴퓨팅을 연결합니다.", secondaryTitle: "검증된 공급, 명확한 정산, 신뢰할 수 있는 인도.", lead: "검증된 컴퓨팅 공급과 실제 수요를 연결하고 KAI 카드시간으로 통합 정산합니다. 자원 확정부터 인도와 검수까지 명확하고 추적·검증할 수 있습니다.", exploreMarket: "컴퓨팅 시장 둘러보기", learnCardHours: "KAI 카드시간 알아보기", liveResources: "실시간 자원", cardHourSettlement: "카드시간 정산", trustedDelivery: "신뢰할 수 있는 인도", tradingInfo: "현재 거래 정보",
    syncError: "카탈로그 동기화 오류로 안전 스냅샷 사용 중", checking: "거래 가능 카탈로그 확인 중", synced: "거래 가능 카탈로그 동기화 완료", safeSnapshot: "거래 가능 카탈로그 안전 스냅샷", lastPublished: "최근 게시", settlementNotice: "모든 자원은 KAI 카드시간으로만 정산 · 결제 시 사이트 가격 고정", retry: "다시 시도",
  },
  fr: {
    invalidTime: "À confirmer", sitePrice: "Prix H100 du site", oneHourDue: "Montant pour 1 heure", cardHours: "Heures-carte KAI", fixedExchange: "Conversion fixe", cnyPerCardHour: "CNY / heure-carte KAI", tradableQuotes: "Cotations négociables", verifiedResources: "ressources vérifiées",
    eyebrow: "KAI CLOUD · MARCHÉ DU CALCUL", title: "La puissance de calcul, disponible au bon moment.", secondaryTitle: "Offre vérifiée, règlement clair, livraison fiable.", lead: "Reliez l’offre de calcul vérifiée à la demande réelle et réglez en heures-carte KAI. Du verrouillage de la ressource à la réception, tout reste clair, traçable et vérifiable.", exploreMarket: "Explorer le marché du calcul", learnCardHours: "Découvrir les heures-carte KAI", liveResources: "Ressources en direct", cardHourSettlement: "Règlement en heures-carte", trustedDelivery: "Livraison fiable", tradingInfo: "Informations de transaction actuelles",
    syncError: "Synchronisation indisponible ; utilisation d’un instantané sécurisé", checking: "Vérification du catalogue négociable", synced: "Catalogue négociable synchronisé", safeSnapshot: "Instantané sécurisé du catalogue", lastPublished: "Dernière publication", settlementNotice: "Toutes les ressources sont réglées uniquement en heures-carte KAI · Le prix du site est verrouillé au paiement", retry: "Réessayer",
  },
  th: {
    invalidTime: "รอยืนยัน", sitePrice: "ราคา H100 บนเว็บไซต์", oneHourDue: "ยอดชำระ 1 ชั่วโมง", cardHours: "ชั่วโมงการ์ด KAI", fixedExchange: "อัตราแลกเปลี่ยนคงที่", cnyPerCardHour: "หยวน / ชั่วโมงการ์ด KAI", tradableQuotes: "ราคาที่ซื้อขายได้", verifiedResources: "ทรัพยากรที่ตรวจสอบแล้ว",
    eyebrow: "KAI CLOUD · ตลาดพลังประมวลผล", title: "พลังประมวลผลพร้อมในทุกช่วงเวลาที่สำคัญ", secondaryTitle: "ทรัพยากรที่ตรวจสอบแล้ว การชำระที่ชัดเจน การส่งมอบที่เชื่อถือได้", lead: "เชื่อมต่อทรัพยากรประมวลผลที่ตรวจสอบแล้วกับความต้องการจริง และชำระด้วยชั่วโมงการ์ด KAI ตั้งแต่ล็อกทรัพยากรจนถึงส่งมอบและตรวจรับ ทุกขั้นตอนชัดเจน ตรวจสอบย้อนหลังและยืนยันได้", exploreMarket: "สำรวจตลาดพลังประมวลผล", learnCardHours: "รู้จักชั่วโมงการ์ด KAI", liveResources: "ทรัพยากรแบบเรียลไทม์", cardHourSettlement: "ชำระด้วยชั่วโมงการ์ด", trustedDelivery: "การส่งมอบที่เชื่อถือได้", tradingInfo: "ข้อมูลการซื้อขายปัจจุบัน",
    syncError: "ซิงก์แค็ตตาล็อกไม่ได้ กำลังใช้สแนปช็อตที่ปลอดภัย", checking: "กำลังตรวจสอบแค็ตตาล็อกที่ซื้อขายได้", synced: "ซิงก์แค็ตตาล็อกที่ซื้อขายได้แล้ว", safeSnapshot: "สแนปช็อตแค็ตตาล็อกที่ปลอดภัย", lastPublished: "เผยแพร่ล่าสุด", settlementNotice: "ทรัพยากรทั้งหมดชำระด้วยชั่วโมงการ์ด KAI เท่านั้น · ล็อกราคาเว็บไซต์เมื่อชำระเงิน", retry: "ลองอีกครั้ง",
  },
  vi: {
    invalidTime: "Chờ xác nhận", sitePrice: "Giá H100 trên trang", oneHourDue: "Phải trả cho 1 giờ", cardHours: "Giờ-thẻ KAI", fixedExchange: "Quy đổi cố định", cnyPerCardHour: "CNY / giờ-thẻ KAI", tradableQuotes: "Báo giá có thể giao dịch", verifiedResources: "tài nguyên đã xác minh",
    eyebrow: "KAI CLOUD · THỊ TRƯỜNG TÍNH TOÁN", title: "Năng lực tính toán sẵn sàng đúng lúc cần thiết.", secondaryTitle: "Nguồn lực đã xác minh, quyết toán rõ ràng, bàn giao đáng tin cậy.", lead: "Kết nối nguồn lực tính toán đã xác minh với nhu cầu thực và quyết toán bằng giờ-thẻ KAI. Từ khóa tài nguyên đến bàn giao và nghiệm thu, mọi bước đều rõ ràng, truy xuất và xác minh được.", exploreMarket: "Khám phá thị trường tính toán", learnCardHours: "Tìm hiểu giờ-thẻ KAI", liveResources: "Tài nguyên trực tiếp", cardHourSettlement: "Quyết toán giờ-thẻ", trustedDelivery: "Bàn giao đáng tin cậy", tradingInfo: "Thông tin giao dịch hiện tại",
    syncError: "Không thể đồng bộ danh mục; đang dùng ảnh chụp an toàn", checking: "Đang kiểm tra danh mục có thể giao dịch", synced: "Đã đồng bộ danh mục giao dịch", safeSnapshot: "Ảnh chụp danh mục giao dịch an toàn", lastPublished: "Công bố gần nhất", settlementNotice: "Mọi tài nguyên chỉ quyết toán bằng giờ-thẻ KAI · Giá trang được khóa khi thanh toán", retry: "Thử lại",
  },
  id: {
    invalidTime: "Menunggu konfirmasi", sitePrice: "Harga H100 di situs", oneHourDue: "Tagihan 1 jam", cardHours: "Jam-kartu KAI", fixedExchange: "Konversi tetap", cnyPerCardHour: "CNY / jam-kartu KAI", tradableQuotes: "Kutipan yang dapat diperdagangkan", verifiedResources: "sumber daya terverifikasi",
    eyebrow: "KAI CLOUD · PASAR KOMPUTASI", title: "Komputasi siap di setiap momen yang penting.", secondaryTitle: "Pasokan terverifikasi, penyelesaian jelas, pengiriman tepercaya.", lead: "Hubungkan pasokan komputasi terverifikasi dengan kebutuhan nyata dan selesaikan transaksi dalam jam-kartu KAI. Dari penguncian sumber daya hingga pengiriman dan penerimaan, semuanya jelas, terlacak, dan dapat diverifikasi.", exploreMarket: "Jelajahi pasar komputasi", learnCardHours: "Pelajari jam-kartu KAI", liveResources: "Sumber daya langsung", cardHourSettlement: "Penyelesaian jam-kartu", trustedDelivery: "Pengiriman tepercaya", tradingInfo: "Informasi perdagangan saat ini",
    syncError: "Sinkronisasi katalog tidak tersedia; memakai snapshot aman", checking: "Memeriksa katalog yang dapat diperdagangkan", synced: "Katalog perdagangan tersinkron", safeSnapshot: "Snapshot katalog perdagangan aman", lastPublished: "Terakhir diterbitkan", settlementNotice: "Semua sumber daya hanya diselesaikan dalam jam-kartu KAI · Harga situs dikunci saat checkout", retry: "Coba lagi",
  },
  ms: {
    invalidTime: "Menunggu pengesahan", sitePrice: "Harga H100 di laman", oneHourDue: "Bayaran 1 jam", cardHours: "Jam-kad KAI", fixedExchange: "Penukaran tetap", cnyPerCardHour: "CNY / jam-kad KAI", tradableQuotes: "Sebut harga boleh dagang", verifiedResources: "sumber yang disahkan",
    eyebrow: "KAI CLOUD · PASARAN PENGKOMPUTERAN", title: "Pengkomputeran tersedia pada setiap saat yang penting.", secondaryTitle: "Bekalan disahkan, penyelesaian jelas, penghantaran dipercayai.", lead: "Hubungkan bekalan pengkomputeran yang disahkan dengan permintaan sebenar dan selesaikan dalam jam-kad KAI. Daripada penguncian sumber hingga penghantaran dan penerimaan, semuanya jelas, boleh dijejaki dan disahkan.", exploreMarket: "Terokai pasaran pengkomputeran", learnCardHours: "Ketahui jam-kad KAI", liveResources: "Sumber masa nyata", cardHourSettlement: "Penyelesaian jam-kad", trustedDelivery: "Penghantaran dipercayai", tradingInfo: "Maklumat dagangan semasa",
    syncError: "Penyegerakan katalog tidak tersedia; menggunakan petikan selamat", checking: "Memeriksa katalog boleh dagang", synced: "Katalog boleh dagang disegerakkan", safeSnapshot: "Petikan selamat katalog boleh dagang", lastPublished: "Terakhir diterbitkan", settlementNotice: "Semua sumber hanya diselesaikan dalam jam-kad KAI · Harga laman dikunci semasa pembayaran", retry: "Cuba lagi",
  },
};

function formatSnapshotTime(value: string, locale: Locale, fallback: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return new Intl.DateTimeFormat(locale, {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

export function LiveHomeMarketHero({
  initialSummary,
  initialSource,
}: {
  initialSummary: HomeMarketSummary;
  initialSource: "persistent" | "bundled";
}) {
  const { locale } = useLocale();
  const copy = HERO_COPY[locale];
  const [summary, setSummary] = useState(initialSummary);
  const [source, setSource] = useState<"persistent" | "bundled">(initialSource);
  const [checkState, setCheckState] = useState<"checking" | "ready" | "error">("checking");
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      setCheckState("error");
      controller.abort();
    }, 12_000);
    fetch("/api/market?summary=1", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("market unavailable");
        return response.json() as Promise<{ summary: RemoteModelMarketSummary; source: "persistent" | "bundled" }>;
      })
      .then((result) => {
        setSummary((current) => ({ ...current, ...result.summary }));
        setSource(result.source);
        setCheckState("ready");
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setCheckState("error");
      })
      .finally(() => window.clearTimeout(timeout));
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [refreshKey]);

  const marketFacts = useMemo(() => {
    const payableCardHours = Math.ceil((summary.gpuP50 / 1.002) * 1_000_000) / 1_000_000;
    return [
      {
        label: copy.sitePrice,
        value: new Intl.NumberFormat("zh-CN", {
          style: "currency",
          currency: summary.gpuCurrency,
          minimumFractionDigits: 2,
        }).format(summary.gpuP50),
        note: `/ ${summary.gpuPricingUnit}`,
      },
      {
        label: copy.oneHourDue,
        value: formatCardHourValue(payableCardHours),
        note: copy.cardHours,
      },
      { label: copy.fixedExchange, value: "1.002", note: copy.cnyPerCardHour },
      { label: copy.tradableQuotes, value: String(summary.quoteCount), note: copy.verifiedResources },
    ];
  }, [copy, summary]);

  return (
    <section className="kai-hero">
      <div aria-hidden="true" className="hero-grid-lines" />
      <div className="shell">
        <div className="hero-copy">
          <p className="hero-eyebrow">{copy.eyebrow}</p>
          <h1 className="hero-title">{copy.title}</h1>
          <p className="hero-title-en" lang={locale === "zh-CN" || locale === "zh-TW" ? "en" : locale}>{copy.secondaryTitle}</p>
          <p className="hero-lead">{copy.lead}</p>
          <div className="hero-actions">
            <Link className="button hero-primary-action" href="/resources">{copy.exploreMarket}</Link>
            <Link className="hero-text-action" href="/member#card-hours">{copy.learnCardHours} <span aria-hidden="true">→</span></Link>
          </div>
          <p className="hero-boundary"><span>{copy.liveResources}</span><span>{copy.cardHourSettlement}</span><span>{copy.trustedDelivery}</span></p>
        </div>

        <dl aria-label={copy.tradingInfo} className="hero-market-rail">
          {marketFacts.map((fact) => (
            <div key={fact.label}>
              <dt>{fact.label}</dt>
              <dd>{fact.value}<span>{fact.note}</span></dd>
            </div>
          ))}
        </dl>

        <div aria-live="polite" className="hero-status" role="status">
          <span><strong>{checkState === "error" ? copy.syncError : checkState === "checking" ? copy.checking : source === "persistent" ? copy.synced : copy.safeSnapshot}</strong> · {copy.lastPublished} {formatSnapshotTime(summary.publishedAt, locale, copy.invalidTime)}</span>
          <span>{copy.settlementNotice}{checkState === "error" ? <button className="hero-retry" onClick={() => {
            setCheckState("checking");
            setRefreshKey((value) => value + 1);
          }} type="button">{copy.retry}</button> : null}</span>
        </div>
      </div>
    </section>
  );
}
