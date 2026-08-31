import type { Metadata } from "next";
import Link from "next/link";
import { ManagedGpuCatalog } from "@/components/managed-gpu-catalog";
import styles from "@/components/managed-gpu.module.css";
import type { Locale } from "@/lib/i18n";
import { getRequestLocale } from "@/lib/server/request-locale";

type ManagedGpuPageCopy = Readonly<{
  metadataTitle: string;
  metadataDescription: string;
  eyebrow: string;
  title: string;
  description: string;
  quickNavLabel: string;
  myGpu: string;
  orders: string;
  cardHourOutput: string;
  rentCompute: string;
  serviceTypeLabel: string;
  rentGpu: string;
  managedGpu: string;
}>;

const PAGE_COPY = {
  "zh-CN": { metadataTitle: "GPU 云托管", metadataDescription: "购买独立确权的实体 GPU，选择机房托管或全球寄送。", eyebrow: "实体 GPU 托管", title: "GPU 云托管", description: "向认证供应商购买整张实体 GPU，选择机房托管或全球寄送。托管设备只按真实成交产生不可提现、不可转让的 KAI 标准卡时。", quickNavLabel: "GPU 云托管快捷入口", myGpu: "我的 GPU", orders: "购买订单", cardHourOutput: "托管产出卡时", rentCompute: "租用 GPU 算力", serviceTypeLabel: "GPU 服务类型", rentGpu: "租用 GPU", managedGpu: "GPU 云托管" },
  "zh-TW": { metadataTitle: "GPU 雲端託管", metadataDescription: "購買獨立確權的實體 GPU，選擇機房託管或全球寄送。", eyebrow: "實體 GPU 託管", title: "GPU 雲端託管", description: "向認證供應商購買整張實體 GPU，選擇機房託管或全球寄送。託管設備只按真實成交產生不可提現、不可轉讓的 KAI 標準卡時。", quickNavLabel: "GPU 雲端託管快捷入口", myGpu: "我的 GPU", orders: "購買訂單", cardHourOutput: "託管產出卡時", rentCompute: "租用 GPU 算力", serviceTypeLabel: "GPU 服務類型", rentGpu: "租用 GPU", managedGpu: "GPU 雲端託管" },
  en: { metadataTitle: "Managed GPU cloud", metadataDescription: "Purchase an independently owned physical GPU and choose facility hosting or global shipping.", eyebrow: "MANAGED PHYSICAL GPU", title: "Managed GPU cloud", description: "Purchase a complete physical GPU from a verified supplier and choose facility hosting or global shipping. Hosted devices generate non-withdrawable, non-transferable KAI standard card-hours only from actual completed sales.", quickNavLabel: "Managed GPU quick links", myGpu: "My GPUs", orders: "Purchase orders", cardHourOutput: "Hosted card-hour output", rentCompute: "Rent GPU compute", serviceTypeLabel: "GPU service type", rentGpu: "Rent GPU", managedGpu: "Managed GPU cloud" },
  ja: { metadataTitle: "GPU クラウド運用", metadataDescription: "所有権が個別に確定する物理 GPU を購入し、施設運用または海外配送を選択できます。", eyebrow: "物理 GPU 運用", title: "GPU クラウド運用", description: "認証済みサプライヤーから物理 GPU を1枚単位で購入し、施設運用または海外配送を選択できます。運用中の機器は実際の成約に基づいてのみ、出金・譲渡不可の KAI 標準カード時間を生みます。", quickNavLabel: "GPU クラウド運用クイックリンク", myGpu: "自分の GPU", orders: "購入注文", cardHourOutput: "運用カード時間", rentCompute: "GPU 算力を借りる", serviceTypeLabel: "GPU サービス種別", rentGpu: "GPU をレンタル", managedGpu: "GPU クラウド運用" },
  ko: { metadataTitle: "GPU 클라우드 위탁운영", metadataDescription: "독립 소유권이 확인되는 실물 GPU를 구매하고 시설 위탁운영 또는 해외 배송을 선택하세요.", eyebrow: "실물 GPU 위탁운영", title: "GPU 클라우드 위탁운영", description: "인증된 공급업체에서 실물 GPU 한 장 전체를 구매하고 시설 위탁운영 또는 해외 배송을 선택할 수 있습니다. 위탁운영 장비는 실제 완료된 거래에 따라서만 출금·양도할 수 없는 KAI 표준 카드 시간을 생성합니다.", quickNavLabel: "GPU 위탁운영 바로가기", myGpu: "내 GPU", orders: "구매 주문", cardHourOutput: "위탁운영 카드 시간", rentCompute: "GPU 컴퓨팅 대여", serviceTypeLabel: "GPU 서비스 유형", rentGpu: "GPU 대여", managedGpu: "GPU 클라우드 위탁운영" },
  fr: { metadataTitle: "GPU cloud géré", metadataDescription: "Achetez un GPU physique avec propriété indépendante et choisissez l’hébergement en centre ou l’expédition internationale.", eyebrow: "GPU PHYSIQUE GÉRÉ", title: "GPU cloud géré", description: "Achetez un GPU physique complet auprès d’un fournisseur vérifié, puis choisissez l’hébergement en centre ou l’expédition internationale. Les équipements hébergés ne génèrent des heures-carte KAI ni retirables ni transférables qu’à partir de ventes réellement réalisées.", quickNavLabel: "Accès rapides au GPU géré", myGpu: "Mes GPU", orders: "Commandes d’achat", cardHourOutput: "Production d’heures-carte", rentCompute: "Louer du calcul GPU", serviceTypeLabel: "Type de service GPU", rentGpu: "Louer un GPU", managedGpu: "GPU cloud géré" },
  th: { metadataTitle: "GPU คลาวด์แบบดูแล", metadataDescription: "ซื้อ GPU จริงที่ยืนยันกรรมสิทธิ์แยกต่างหาก แล้วเลือกฝากดูแลในศูนย์หรือจัดส่งทั่วโลก", eyebrow: "GPU จริงแบบดูแล", title: "GPU คลาวด์แบบดูแล", description: "ซื้อ GPU จริงทั้งใบจากผู้ให้บริการที่ผ่านการรับรอง แล้วเลือกฝากดูแลในศูนย์หรือจัดส่งทั่วโลก อุปกรณ์ที่ฝากดูแลจะสร้างชั่วโมงการ์ดมาตรฐาน KAI ที่ถอนไม่ได้และโอนไม่ได้จากยอดขายจริงที่เสร็จสมบูรณ์เท่านั้น", quickNavLabel: "ทางลัด GPU แบบดูแล", myGpu: "GPU ของฉัน", orders: "คำสั่งซื้อ", cardHourOutput: "ชั่วโมงการ์ดจากการดูแล", rentCompute: "เช่าพลังประมวลผล GPU", serviceTypeLabel: "ประเภทบริการ GPU", rentGpu: "เช่า GPU", managedGpu: "GPU คลาวด์แบบดูแล" },
  vi: { metadataTitle: "GPU đám mây được quản lý", metadataDescription: "Mua GPU vật lý có quyền sở hữu độc lập và chọn lưu trữ tại cơ sở hoặc giao hàng toàn cầu.", eyebrow: "GPU VẬT LÝ ĐƯỢC QUẢN LÝ", title: "GPU đám mây được quản lý", description: "Mua trọn một GPU vật lý từ nhà cung cấp đã xác minh và chọn lưu trữ tại cơ sở hoặc giao hàng toàn cầu. Thiết bị lưu trữ chỉ tạo giờ-thẻ KAI tiêu chuẩn không thể rút hoặc chuyển nhượng từ các giao dịch thực tế đã hoàn tất.", quickNavLabel: "Lối tắt GPU được quản lý", myGpu: "GPU của tôi", orders: "Đơn mua", cardHourOutput: "Giờ-thẻ từ lưu trữ", rentCompute: "Thuê năng lực GPU", serviceTypeLabel: "Loại dịch vụ GPU", rentGpu: "Thuê GPU", managedGpu: "GPU đám mây được quản lý" },
  id: { metadataTitle: "Cloud GPU terkelola", metadataDescription: "Beli GPU fisik dengan kepemilikan mandiri dan pilih hosting fasilitas atau pengiriman global.", eyebrow: "GPU FISIK TERKELOLA", title: "Cloud GPU terkelola", description: "Beli satu GPU fisik utuh dari pemasok terverifikasi lalu pilih hosting fasilitas atau pengiriman global. Perangkat yang di-host hanya menghasilkan jam-kartu standar KAI yang tidak dapat ditarik atau dialihkan dari penjualan nyata yang telah selesai.", quickNavLabel: "Tautan cepat GPU terkelola", myGpu: "GPU saya", orders: "Pesanan pembelian", cardHourOutput: "Hasil jam-kartu hosting", rentCompute: "Sewa komputasi GPU", serviceTypeLabel: "Jenis layanan GPU", rentGpu: "Sewa GPU", managedGpu: "Cloud GPU terkelola" },
  ms: { metadataTitle: "Awan GPU terurus", metadataDescription: "Beli GPU fizikal dengan pemilikan bebas dan pilih pengehosan kemudahan atau penghantaran global.", eyebrow: "GPU FIZIKAL TERURUS", title: "Awan GPU terurus", description: "Beli satu GPU fizikal lengkap daripada pembekal yang disahkan lalu pilih pengehosan kemudahan atau penghantaran global. Peranti yang dihoskan hanya menghasilkan jam-kad standard KAI yang tidak boleh dikeluarkan atau dipindah milik daripada jualan sebenar yang selesai.", quickNavLabel: "Pautan pantas GPU terurus", myGpu: "GPU saya", orders: "Pesanan pembelian", cardHourOutput: "Hasil jam-kad pengehosan", rentCompute: "Sewa pengkomputeran GPU", serviceTypeLabel: "Jenis perkhidmatan GPU", rentGpu: "Sewa GPU", managedGpu: "Awan GPU terurus" },
} as const satisfies Record<Locale, ManagedGpuPageCopy>;

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getRequestLocale();
  const copy = PAGE_COPY[locale];
  return { title: copy.metadataTitle, description: copy.metadataDescription };
}

export default async function ManagedGpuPage() {
  const locale = await getRequestLocale();
  const copy = PAGE_COPY[locale];
  return <div className={styles.page}>
    <header className={styles.hero}><div className={`shell ${styles.heroInner}`}>
      <div><p className={styles.eyebrow}>{copy.eyebrow}</p><h1>{copy.title}</h1><p>{copy.description}</p></div>
      <nav className={styles.routeLinks} aria-label={copy.quickNavLabel}><Link href="/member/gpu-assets">{copy.myGpu}</Link><Link href="/member/gpu-hosting/orders">{copy.orders}</Link><Link href="/member/gpu-hosting/earnings">{copy.cardHourOutput}</Link><Link href="/buy">{copy.rentCompute}</Link></nav>
    </div></header>
    <main className={`shell ${styles.workspace}`}>
      <nav className={styles.modeTabs} aria-label={copy.serviceTypeLabel}><Link href="/buy">{copy.rentGpu}</Link><Link className={styles.active} aria-current="page" href="/managed-gpu">{copy.managedGpu}</Link></nav>
      <ManagedGpuCatalog />
    </main>
  </div>;
}
