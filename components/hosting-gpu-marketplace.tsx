"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useLocale } from "@/components/locale-provider";
import { MarketplaceApiError, marketplaceGet } from "@/lib/client/marketplace-client";
import type { PublicHostingOffer } from "@/lib/hosting-v2-client";
import { formatCardHours, formatHostingTime } from "@/lib/hosting-v2-client";
import type { Locale } from "@/lib/i18n";
import styles from "./hosting-marketplace.module.css";

type HostingGpuMarketCopy = {
  eyebrow: string;
  title: string;
  lead: string;
  myRentals: string;
  listGpu: string;
  pricingAria: string;
  fixedReference: string;
  minimumRental: string;
  filtersAria: string;
  gpuModel: string;
  allModels: string;
  sort: string;
  priceFirst: string;
  windowFirst: string;
  currentQuotes: string;
  readFailed: string;
  requestId: string;
  marketClosed: string;
  marketClosedCopy: string;
  loading: string;
  offersAria: string;
  resource: string;
  regionAndTime: string;
  deliveryStandard: string;
  cardHourPrice: string;
  action: string;
  verified: string;
  singleGpuExclusive: string;
  timeSeparator: string;
  sshDelivery: string;
  minutes: string;
  cardHourUnit: string;
  viewAndRent: string;
  empty: string;
};

const GPU_MARKET_COPY: Record<Locale, HostingGpuMarketCopy> = {
  "zh-CN": {
    eyebrow: "KAI 验真 GPU 市场", title: "GPU 算力市场", lead: "报价、可用时间和交付模板在成交时冻结；租用统一使用 KAI 标准卡时。", myRentals: "我的租赁", listGpu: "上架 GPU",
    pricingAria: "市场计价说明", fixedReference: "固定参考：1 KAI 标准卡时 = ¥1.002", minimumRental: "最低租用 3 分钟 · 按秒计量 · 余额先锁定", filtersAria: "GPU 筛选", gpuModel: "GPU 型号", allModels: "全部型号", sort: "排序", priceFirst: "卡时价格优先", windowFirst: "可用窗口优先", currentQuotes: "个当前可成交报价",
    readFailed: "GPU 市场暂时无法读取。", requestId: "请求编号", marketClosed: "GPU 市场尚未开放", marketClosedCopy: "统一身份、真实 Agent、费率、交付镜像、计量与清理全部就绪前，平台不会展示或接受成交。", loading: "正在读取经过验真的 GPU 报价…",
    offersAria: "可成交 GPU 报价", resource: "资源", regionAndTime: "区域与可用时间", deliveryStandard: "交付标准", cardHourPrice: "卡时价格", action: "操作", verified: "KAI 已验真", singleGpuExclusive: "单卡独享", timeSeparator: "至", sshDelivery: "SSH · 审核 OCI 模板", minutes: "分钟", cardHourUnit: "KAI 标准卡时 / GPU 小时", viewAndRent: "查看并租用", empty: "当前没有符合条件且验真有效的 GPU 报价。",
  },
  "zh-TW": {
    eyebrow: "KAI 驗真 GPU 市場", title: "GPU 算力市場", lead: "報價、可用時間和交付範本在成交時凍結；租用統一使用 KAI 標準卡時。", myRentals: "我的租賃", listGpu: "上架 GPU",
    pricingAria: "市場計價說明", fixedReference: "固定參考：1 KAI 標準卡時 = ¥1.002", minimumRental: "最低租用 3 分鐘 · 按秒計量 · 餘額先鎖定", filtersAria: "GPU 篩選", gpuModel: "GPU 型號", allModels: "全部型號", sort: "排序", priceFirst: "卡時價格優先", windowFirst: "可用時段優先", currentQuotes: "筆目前可成交報價",
    readFailed: "GPU 市場暫時無法讀取。", requestId: "請求編號", marketClosed: "GPU 市場尚未開放", marketClosedCopy: "統一身分、真實 Agent、費率、交付映像、計量與清理全部就緒前，平台不會展示或接受成交。", loading: "正在讀取經過驗真的 GPU 報價…",
    offersAria: "可成交 GPU 報價", resource: "資源", regionAndTime: "區域與可用時間", deliveryStandard: "交付標準", cardHourPrice: "卡時價格", action: "操作", verified: "KAI 已驗真", singleGpuExclusive: "單卡獨享", timeSeparator: "至", sshDelivery: "SSH · 審核 OCI 範本", minutes: "分鐘", cardHourUnit: "KAI 標準卡時 / GPU 小時", viewAndRent: "查看並租用", empty: "目前沒有符合條件且驗真有效的 GPU 報價。",
  },
  en: {
    eyebrow: "KAI VERIFIED GPU MARKET", title: "GPU Compute Market", lead: "Quotes, availability windows, and delivery templates are frozen at transaction time. Rentals settle in KAI standard card-hours.", myRentals: "My rentals", listGpu: "List a GPU",
    pricingAria: "Market pricing information", fixedReference: "Fixed reference: 1 KAI standard card-hour = ¥1.002", minimumRental: "3-minute minimum · Per-second metering · Balance locked first", filtersAria: "GPU filters", gpuModel: "GPU model", allModels: "All models", sort: "Sort", priceFirst: "Card-hour price first", windowFirst: "Availability first", currentQuotes: "currently tradable quotes",
    readFailed: "The GPU market is temporarily unavailable.", requestId: "Request ID", marketClosed: "GPU market not yet open", marketClosedCopy: "The platform will not display or accept transactions until unified identity, verified Agents, rates, delivery images, metering, and cleanup are ready.", loading: "Loading verified GPU quotes…",
    offersAria: "Tradable GPU quotes", resource: "Resource", regionAndTime: "Region and availability", deliveryStandard: "Delivery standard", cardHourPrice: "Card-hour price", action: "Action", verified: "KAI VERIFIED", singleGpuExclusive: "Dedicated single GPU", timeSeparator: "to", sshDelivery: "SSH · Reviewed OCI template", minutes: "minutes", cardHourUnit: "KAI standard card-hours / GPU hour", viewAndRent: "View and rent", empty: "No eligible, currently verified GPU quotes match these filters.",
  },
  ja: {
    eyebrow: "KAI 検証済み GPU 市場", title: "GPU 計算資源市場", lead: "価格、利用可能時間、納品テンプレートは成約時に固定され、レンタルは KAI 標準カード時で決済されます。", myRentals: "レンタル一覧", listGpu: "GPU を掲載",
    pricingAria: "市場価格の説明", fixedReference: "固定参考：1 KAI 標準カード時 = ¥1.002", minimumRental: "最低 3 分 · 秒単位計測 · 残高を先に確保", filtersAria: "GPU フィルター", gpuModel: "GPU モデル", allModels: "すべてのモデル", sort: "並び順", priceFirst: "カード時価格を優先", windowFirst: "利用可能時間を優先", currentQuotes: "件の取引可能価格",
    readFailed: "GPU 市場を一時的に読み込めません。", requestId: "リクエスト ID", marketClosed: "GPU 市場はまだ公開されていません", marketClosedCopy: "統一認証、実 Agent、料金、納品イメージ、計測、清掃がすべて整うまで、取引の表示・受付は行いません。", loading: "検証済み GPU 価格を読み込み中…",
    offersAria: "取引可能な GPU 価格", resource: "資源", regionAndTime: "地域と利用可能時間", deliveryStandard: "納品基準", cardHourPrice: "カード時価格", action: "操作", verified: "KAI 検証済み", singleGpuExclusive: "1 GPU 専有", timeSeparator: "から", sshDelivery: "SSH · 審査済み OCI テンプレート", minutes: "分", cardHourUnit: "KAI 標準カード時 / GPU 時間", viewAndRent: "詳細・レンタル", empty: "条件に合い、検証が有効な GPU 価格はありません。",
  },
  ko: {
    eyebrow: "KAI 검증 GPU 시장", title: "GPU 컴퓨팅 시장", lead: "견적, 사용 가능 시간 및 인도 템플릿은 거래 시 고정되며 대여는 KAI 표준 카드시간으로 정산됩니다.", myRentals: "내 대여", listGpu: "GPU 등록",
    pricingAria: "시장 가격 안내", fixedReference: "고정 기준: 1 KAI 표준 카드시간 = ¥1.002", minimumRental: "최소 3분 · 초 단위 계량 · 잔액 우선 잠금", filtersAria: "GPU 필터", gpuModel: "GPU 모델", allModels: "전체 모델", sort: "정렬", priceFirst: "카드시간 가격 우선", windowFirst: "사용 가능 시간 우선", currentQuotes: "개의 현재 거래 가능 견적",
    readFailed: "GPU 시장을 일시적으로 불러올 수 없습니다.", requestId: "요청 ID", marketClosed: "GPU 시장이 아직 열리지 않았습니다", marketClosedCopy: "통합 신원, 실제 Agent, 요율, 인도 이미지, 계량 및 정리가 모두 준비되기 전에는 거래를 표시하거나 받지 않습니다.", loading: "검증된 GPU 견적 불러오는 중…",
    offersAria: "거래 가능한 GPU 견적", resource: "자원", regionAndTime: "지역 및 사용 가능 시간", deliveryStandard: "인도 기준", cardHourPrice: "카드시간 가격", action: "작업", verified: "KAI 검증 완료", singleGpuExclusive: "단일 GPU 전용", timeSeparator: "~", sshDelivery: "SSH · 검토된 OCI 템플릿", minutes: "분", cardHourUnit: "KAI 표준 카드시간 / GPU 시간", viewAndRent: "보기 및 대여", empty: "조건에 맞고 검증이 유효한 GPU 견적이 없습니다.",
  },
  fr: {
    eyebrow: "MARCHÉ GPU VÉRIFIÉ PAR KAI", title: "Marché du calcul GPU", lead: "Les prix, fenêtres de disponibilité et modèles de livraison sont figés à la transaction. Les locations sont réglées en heures-carte KAI standard.", myRentals: "Mes locations", listGpu: "Publier un GPU",
    pricingAria: "Informations de tarification", fixedReference: "Référence fixe : 1 heure-carte KAI standard = ¥1.002", minimumRental: "Minimum 3 minutes · Mesure à la seconde · Solde verrouillé d’abord", filtersAria: "Filtres GPU", gpuModel: "Modèle GPU", allModels: "Tous les modèles", sort: "Trier", priceFirst: "Prix en heures-carte", windowFirst: "Disponibilité", currentQuotes: "offres actuellement négociables",
    readFailed: "Le marché GPU est temporairement indisponible.", requestId: "ID de requête", marketClosed: "Marché GPU pas encore ouvert", marketClosedCopy: "La plateforme n’affiche ni n’accepte de transaction avant que l’identité unifiée, les Agents vérifiés, les tarifs, images de livraison, mesures et nettoyages soient prêts.", loading: "Chargement des offres GPU vérifiées…",
    offersAria: "Offres GPU négociables", resource: "Ressource", regionAndTime: "Région et disponibilité", deliveryStandard: "Standard de livraison", cardHourPrice: "Prix en heures-carte", action: "Action", verified: "VÉRIFIÉ PAR KAI", singleGpuExclusive: "GPU unique dédié", timeSeparator: "au", sshDelivery: "SSH · Modèle OCI examiné", minutes: "minutes", cardHourUnit: "Heures-carte KAI standard / heure GPU", viewAndRent: "Voir et louer", empty: "Aucune offre GPU éligible et vérifiée ne correspond aux filtres.",
  },
  th: {
    eyebrow: "ตลาด GPU ที่ KAI ตรวจสอบแล้ว", title: "ตลาดพลังประมวลผล GPU", lead: "ราคา ช่วงเวลาที่ใช้ได้ และแม่แบบส่งมอบจะถูกล็อกเมื่อทำธุรกรรม การเช่าชำระด้วยชั่วโมงการ์ดมาตรฐาน KAI", myRentals: "การเช่าของฉัน", listGpu: "ลงรายการ GPU",
    pricingAria: "ข้อมูลราคาตลาด", fixedReference: "อัตราอ้างอิงคงที่: 1 ชั่วโมงการ์ดมาตรฐาน KAI = ¥1.002", minimumRental: "ขั้นต่ำ 3 นาที · วัดเป็นวินาที · ล็อกยอดก่อน", filtersAria: "ตัวกรอง GPU", gpuModel: "รุ่น GPU", allModels: "ทุกรุ่น", sort: "เรียง", priceFirst: "ราคาชั่วโมงการ์ดก่อน", windowFirst: "ช่วงเวลาที่ใช้ได้ก่อน", currentQuotes: "ราคาที่ซื้อขายได้ในขณะนี้",
    readFailed: "ไม่สามารถอ่านตลาด GPU ได้ชั่วคราว", requestId: "รหัสคำขอ", marketClosed: "ตลาด GPU ยังไม่เปิด", marketClosedCopy: "แพลตฟอร์มจะไม่แสดงหรือรับธุรกรรมจนกว่าระบบตัวตน Agent จริง อัตรา อิมเมจส่งมอบ การวัด และการล้างจะพร้อมทั้งหมด", loading: "กำลังโหลดราคา GPU ที่ตรวจสอบแล้ว…",
    offersAria: "ราคา GPU ที่ซื้อขายได้", resource: "ทรัพยากร", regionAndTime: "ภูมิภาคและเวลาที่ใช้ได้", deliveryStandard: "มาตรฐานส่งมอบ", cardHourPrice: "ราคาชั่วโมงการ์ด", action: "การทำงาน", verified: "KAI ตรวจสอบแล้ว", singleGpuExclusive: "ใช้ GPU เดี่ยวโดยเฉพาะ", timeSeparator: "ถึง", sshDelivery: "SSH · แม่แบบ OCI ที่ตรวจสอบแล้ว", minutes: "นาที", cardHourUnit: "ชั่วโมงการ์ดมาตรฐาน KAI / ชั่วโมง GPU", viewAndRent: "ดูและเช่า", empty: "ไม่มีราคา GPU ที่ตรงเงื่อนไขและยังผ่านการตรวจสอบ",
  },
  vi: {
    eyebrow: "THỊ TRƯỜNG GPU ĐÃ ĐƯỢC KAI XÁC MINH", title: "Thị trường năng lực GPU", lead: "Báo giá, thời gian khả dụng và mẫu bàn giao được khóa khi giao dịch. Việc thuê dùng giờ-thẻ KAI tiêu chuẩn.", myRentals: "Giao dịch thuê của tôi", listGpu: "Đăng GPU",
    pricingAria: "Thông tin định giá thị trường", fixedReference: "Tham chiếu cố định: 1 giờ-thẻ KAI tiêu chuẩn = ¥1.002", minimumRental: "Tối thiểu 3 phút · Đo theo giây · Khóa số dư trước", filtersAria: "Bộ lọc GPU", gpuModel: "Mẫu GPU", allModels: "Tất cả mẫu", sort: "Sắp xếp", priceFirst: "Ưu tiên giá giờ-thẻ", windowFirst: "Ưu tiên thời gian khả dụng", currentQuotes: "báo giá hiện có thể giao dịch",
    readFailed: "Tạm thời không thể đọc thị trường GPU.", requestId: "Mã yêu cầu", marketClosed: "Thị trường GPU chưa mở", marketClosedCopy: "Nền tảng không hiển thị hoặc nhận giao dịch cho đến khi danh tính thống nhất, Agent thực, biểu phí, ảnh bàn giao, đo lường và dọn dẹp đều sẵn sàng.", loading: "Đang tải báo giá GPU đã xác minh…",
    offersAria: "Báo giá GPU có thể giao dịch", resource: "Tài nguyên", regionAndTime: "Khu vực và thời gian", deliveryStandard: "Tiêu chuẩn bàn giao", cardHourPrice: "Giá giờ-thẻ", action: "Thao tác", verified: "KAI ĐÃ XÁC MINH", singleGpuExclusive: "Dùng riêng một GPU", timeSeparator: "đến", sshDelivery: "SSH · Mẫu OCI đã duyệt", minutes: "phút", cardHourUnit: "Giờ-thẻ KAI tiêu chuẩn / giờ GPU", viewAndRent: "Xem và thuê", empty: "Không có báo giá GPU hợp lệ và đã xác minh phù hợp điều kiện.",
  },
  id: {
    eyebrow: "PASAR GPU TERVERIFIKASI KAI", title: "Pasar Komputasi GPU", lead: "Penawaran, waktu ketersediaan, dan templat pengiriman dibekukan saat transaksi. Sewa diselesaikan dalam jam-kartu standar KAI.", myRentals: "Sewa saya", listGpu: "Daftarkan GPU",
    pricingAria: "Informasi harga pasar", fixedReference: "Referensi tetap: 1 jam-kartu standar KAI = ¥1.002", minimumRental: "Minimum 3 menit · Metering per detik · Saldo dikunci lebih dulu", filtersAria: "Filter GPU", gpuModel: "Model GPU", allModels: "Semua model", sort: "Urutkan", priceFirst: "Harga jam-kartu", windowFirst: "Waktu ketersediaan", currentQuotes: "penawaran yang dapat diperdagangkan",
    readFailed: "Pasar GPU sementara tidak tersedia.", requestId: "ID permintaan", marketClosed: "Pasar GPU belum dibuka", marketClosedCopy: "Platform tidak menampilkan atau menerima transaksi sebelum identitas terpadu, Agent nyata, tarif, citra pengiriman, metering, dan pembersihan siap.", loading: "Memuat penawaran GPU terverifikasi…",
    offersAria: "Penawaran GPU yang dapat diperdagangkan", resource: "Sumber daya", regionAndTime: "Wilayah dan ketersediaan", deliveryStandard: "Standar pengiriman", cardHourPrice: "Harga jam-kartu", action: "Tindakan", verified: "DIVERIFIKASI KAI", singleGpuExclusive: "Satu GPU khusus", timeSeparator: "hingga", sshDelivery: "SSH · Templat OCI yang ditinjau", minutes: "menit", cardHourUnit: "Jam-kartu standar KAI / jam GPU", viewAndRent: "Lihat dan sewa", empty: "Tidak ada penawaran GPU valid dan terverifikasi yang sesuai.",
  },
  ms: {
    eyebrow: "PASARAN GPU DISAHKAN KAI", title: "Pasaran Pengkomputeran GPU", lead: "Sebut harga, tempoh ketersediaan dan templat penghantaran dibekukan semasa transaksi. Sewaan diselesaikan dalam jam-kad standard KAI.", myRentals: "Sewaan saya", listGpu: "Senaraikan GPU",
    pricingAria: "Maklumat harga pasaran", fixedReference: "Rujukan tetap: 1 jam-kad standard KAI = ¥1.002", minimumRental: "Minimum 3 minit · Pengukuran sesaat · Baki dikunci dahulu", filtersAria: "Penapis GPU", gpuModel: "Model GPU", allModels: "Semua model", sort: "Susun", priceFirst: "Harga jam-kad", windowFirst: "Tempoh ketersediaan", currentQuotes: "sebut harga yang boleh didagangkan",
    readFailed: "Pasaran GPU tidak tersedia buat sementara.", requestId: "ID permintaan", marketClosed: "Pasaran GPU belum dibuka", marketClosedCopy: "Platform tidak memaparkan atau menerima transaksi sehingga identiti bersepadu, Agent sebenar, kadar, imej penghantaran, pengukuran dan pembersihan tersedia.", loading: "Memuatkan sebut harga GPU yang disahkan…",
    offersAria: "Sebut harga GPU boleh dagang", resource: "Sumber", regionAndTime: "Wilayah dan ketersediaan", deliveryStandard: "Standard penghantaran", cardHourPrice: "Harga jam-kad", action: "Tindakan", verified: "DISAHKAN KAI", singleGpuExclusive: "Satu GPU khusus", timeSeparator: "hingga", sshDelivery: "SSH · Templat OCI yang disemak", minutes: "minit", cardHourUnit: "Jam-kad standard KAI / jam GPU", viewAndRent: "Lihat dan sewa", empty: "Tiada sebut harga GPU sah dan disahkan yang sepadan.",
  },
};

export function HostingGpuMarketplace() {
  const { locale } = useLocale();
  const copy = GPU_MARKET_COPY[locale];
  const [offers, setOffers] = useState<PublicHostingOffer[] | null>(null);
  const [model, setModel] = useState("ALL");
  const [sort, setSort] = useState("PRICE");
  const [error, setError] = useState<{ requestId?: string } | null>(null);
  const [marketOpen, setMarketOpen] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    void marketplaceGet<{ records: PublicHostingOffer[] }>("/api/v2/offers")
      .then((result) => {
        if (!cancelled) { setMarketOpen(true); setOffers(result.records); }
      })
      .catch((cause) => {
        if (cancelled) return;
        if (cause instanceof MarketplaceApiError && cause.code === "HOSTING_V2_DISABLED") {
          setMarketOpen(false);
          setOffers([]);
          return;
        }
        setError({ requestId: cause instanceof MarketplaceApiError ? cause.requestId : undefined });
      });
    return () => { cancelled = true; };
  }, []);

  const records = useMemo(() => {
    const filtered = (offers ?? []).filter((offer) => model === "ALL" || offer.gpuModel === model);
    return [...filtered].sort((left, right) => sort === "PRICE"
      ? left.pricing.cardHourMicrosPerGpuHour - right.pricing.cardHourMicrosPerGpuHour
      : Date.parse(left.availableUntil) - Date.parse(right.availableUntil));
  }, [model, offers, sort]);

  return (
    <div className={styles.market}>
      <header className={styles.marketHeader}>
        <div><p className={styles.eyebrow}>{copy.eyebrow}</p><h1>{copy.title}</h1><p>{copy.lead}</p></div>
        <div className={styles.headerActions}><Link href="/gpu/contracts">{copy.myRentals}</Link><Link className={styles.primary} href="/hosting/personal-gpu">{copy.listGpu}</Link></div>
      </header>

      <section className={styles.rateBar} aria-label={copy.pricingAria}>
        <span>{copy.fixedReference}</span><span>{copy.minimumRental}</span>
      </section>

      <section className={styles.toolbar} aria-label={copy.filtersAria}>
        <label><span>{copy.gpuModel}</span><select value={model} onChange={(event) => setModel(event.target.value)}><option value="ALL">{copy.allModels}</option><option value="RTX_4090">RTX 4090</option><option value="H100_80GB">H100 80GB</option><option value="H100_94GB">H100 94GB</option></select></label>
        <label><span>{copy.sort}</span><select value={sort} onChange={(event) => setSort(event.target.value)}><option value="PRICE">{copy.priceFirst}</option><option value="WINDOW">{copy.windowFirst}</option></select></label>
        <div className={styles.marketCount}><strong>{records.length}</strong><span>{copy.currentQuotes}</span></div>
      </section>

      {error ? <section className={styles.error} role="alert"><strong>{copy.readFailed}</strong>{error.requestId ? <span>{copy.requestId}: {error.requestId}</span> : null}</section> : null}
      {marketOpen === false ? <section className={styles.error} role="status"><strong>{copy.marketClosed}</strong><span>{copy.marketClosedCopy}</span></section> : null}
      {!offers && !error ? <div className={styles.loading} role="status">{copy.loading}</div> : null}
      {offers ? (
        <section className={styles.offerTable} aria-label={copy.offersAria}>
          <div className={styles.tableHead}><span>{copy.resource}</span><span>{copy.regionAndTime}</span><span>{copy.deliveryStandard}</span><span>{copy.cardHourPrice}</span><span>{copy.action}</span></div>
          {records.map((offer) => (
            <article className={styles.offerRow} key={offer.id}>
              <div><span className={styles.verified}>{copy.verified}</span><h2>{offer.title}</h2><small>{offer.gpuModel} · {copy.singleGpuExclusive}</small></div>
              <div><strong>{offer.region}</strong><small>{formatHostingTime(offer.availableFrom, locale)} {copy.timeSeparator} {formatHostingTime(offer.availableUntil, locale)}</small></div>
              <div><strong>{copy.sshDelivery}</strong><small>{Math.ceil(offer.minRentalSeconds / 60)}–{Math.floor(offer.maxRentalSeconds / 60)} {copy.minutes}</small></div>
              <div><strong>{formatCardHours(offer.pricing.cardHourMicrosPerGpuHour)}</strong><small>{copy.cardHourUnit}</small></div>
              <Link className={styles.rowAction} href={`/gpu/offers/${encodeURIComponent(offer.id)}`}>{copy.viewAndRent}</Link>
            </article>
          ))}
          {!records.length ? <div className={styles.empty}>{copy.empty}</div> : null}
        </section>
      ) : null}
    </div>
  );
}
