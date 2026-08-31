import type { Metadata } from "next";
import { AccountRequired } from "@/components/account-required";
import { BuyerOrderList } from "@/components/buyer-order-list";
import { HostingContractList } from "@/components/hosting-contract-list";
import { MemberWorkspace } from "@/components/member-workspace";
import { PersonalCenterOverview } from "@/components/personal-center-overview";
import { CardHourAccountPanel } from "@/components/card-hour-account-panel";
import { MemberPurchaseIntentList } from "@/components/member-purchase-intents";
import { AccountConsoleOverview } from "@/components/account-console-overview";
import type { Locale } from "@/lib/i18n";
import { isAccountConsoleV2Enabled } from "@/lib/server/account-console-feature";
import { isHostingV2Enabled } from "@/lib/server/hosting-v2-feature";
import { getRequestLocale } from "@/lib/server/request-locale";

const copy = {
  "zh-CN": { title: "个人中心", description: "查看当前组织的 KAI 标准卡时、算力申请与人工交付进度。", purpose: "进入采购账户", heading: "个人中心与交易工作台", lead: "查看卡时余额、购买记录、资源对比、回购、租金收益和邀请佣金，并继续管理需求与供应流程。", boundary: "账户与交易主体严格分离", boundaryCopy: "正式交易只读取当前登录账户和当前主体的数据；资源对比暂时保存在本机，不代表下单、锁库存或付款。", requestPurpose: "查看算力申请", orderPurpose: "查看个人订单" },
  "zh-TW": { title: "個人中心", description: "查看目前組織的 KAI 標準卡時、算力申請與人工交付進度。", purpose: "進入採購帳戶", heading: "個人中心與交易工作台", lead: "查看卡時餘額、購買記錄、資源比較、回購、租金收益和邀請佣金，並繼續管理需求與供應流程。", boundary: "帳戶與交易主體嚴格分離", boundaryCopy: "正式交易只讀取目前登入帳戶和目前主體的資料；資源比較暫存在本機，不代表下單、鎖定庫存或付款。", requestPurpose: "查看算力申請", orderPurpose: "查看個人訂單" },
  en: { title: "Member center", description: "View your organization’s KAI standard card-hours, compute requests, and manual delivery progress.", purpose: "Open buyer account", heading: "Member and transaction workspace", lead: "Review card-hour balances, purchases, comparisons, buybacks, rental income and referral commission, then continue demand and supply workflows.", boundary: "Accounts and trading entities stay separate", boundaryCopy: "Transactions only use data for the signed-in account and active entity. Comparisons are stored locally and do not place orders, reserve stock, or make payments.", requestPurpose: "View compute requests", orderPurpose: "View personal orders" },
  ja: { title: "会員センター", description: "現在の組織の KAI 標準カード時、算力申請、手動納品状況を確認します。", purpose: "購入アカウントを開く", heading: "会員・取引ワークスペース", lead: "カード時残高、購入履歴、比較、買い戻し、賃料収益、紹介手数料を確認し、需要・供給フローを管理します。", boundary: "アカウントと取引主体を厳格に分離", boundaryCopy: "正式取引はログイン中のアカウントと現在の主体のデータのみを使用します。比較は端末内保存で、注文、在庫確保、支払いではありません。", requestPurpose: "算力申請を表示", orderPurpose: "個人注文を表示" },
  ko: { title: "회원 센터", description: "현재 조직의 KAI 표준 카드시간, 컴퓨팅 요청 및 수동 인도 진행 상황을 확인합니다.", purpose: "구매 계정 열기", heading: "회원 및 거래 작업공간", lead: "카드시간 잔액, 구매, 비교, 바이백, 임대 수익과 추천 수수료를 확인하고 수요·공급 절차를 관리합니다.", boundary: "계정과 거래 주체를 엄격히 분리", boundaryCopy: "정식 거래는 로그인 계정과 현재 주체의 데이터만 사용합니다. 비교는 브라우저에 저장되며 주문, 재고 확보 또는 결제가 아닙니다.", requestPurpose: "컴퓨팅 요청 보기", orderPurpose: "개인 주문 보기" },
  fr: { title: "Espace membre", description: "Consultez les heures-carte KAI, demandes de calcul et livraisons manuelles de votre organisation.", purpose: "Ouvrir le compte acheteur", heading: "Espace membre et transactions", lead: "Consultez soldes, achats, comparaisons, rachats, revenus locatifs et commissions, puis gérez les flux de demande et d’offre.", boundary: "Comptes et entités de transaction séparés", boundaryCopy: "Les transactions utilisent uniquement le compte connecté et l’entité active. Les comparaisons restent locales et ne constituent ni commande, ni réservation, ni paiement.", requestPurpose: "Voir les demandes de calcul", orderPurpose: "Voir les commandes personnelles" },
  th: { title: "ศูนย์สมาชิก", description: "ดูชั่วโมงการ์ด KAI คำขอพลังประมวลผล และความคืบหน้าการส่งมอบขององค์กรปัจจุบัน", purpose: "เปิดบัญชีผู้ซื้อ", heading: "พื้นที่สมาชิกและธุรกรรม", lead: "ดูยอดชั่วโมงการ์ด การซื้อ การเปรียบเทียบ การซื้อคืน รายได้ค่าเช่าและค่าตอบแทนแนะนำ พร้อมจัดการขั้นตอนความต้องการและการจัดหา", boundary: "แยกบัญชีและนิติบุคคลการซื้อขายอย่างเคร่งครัด", boundaryCopy: "ธุรกรรมใช้เฉพาะข้อมูลของบัญชีที่เข้าสู่ระบบและนิติบุคคลปัจจุบัน การเปรียบเทียบเก็บไว้ในเครื่องและไม่ใช่คำสั่งซื้อ การล็อกสต็อก หรือการชำระเงิน", requestPurpose: "ดูคำขอพลังประมวลผล", orderPurpose: "ดูคำสั่งซื้อส่วนบุคคล" },
  vi: { title: "Trung tâm thành viên", description: "Xem giờ-thẻ KAI, yêu cầu năng lực tính toán và tiến độ bàn giao của tổ chức hiện tại.", purpose: "Mở tài khoản mua", heading: "Không gian thành viên và giao dịch", lead: "Xem số dư giờ-thẻ, giao dịch mua, so sánh, mua lại, thu nhập cho thuê và hoa hồng giới thiệu; tiếp tục quản lý quy trình cung cầu.", boundary: "Tách biệt nghiêm ngặt tài khoản và chủ thể giao dịch", boundaryCopy: "Giao dịch chỉ dùng dữ liệu của tài khoản đang đăng nhập và chủ thể hiện tại. So sánh được lưu cục bộ, không phải đặt hàng, giữ tồn kho hay thanh toán.", requestPurpose: "Xem yêu cầu năng lực", orderPurpose: "Xem đơn hàng cá nhân" },
  id: { title: "Pusat anggota", description: "Lihat jam-kartu KAI, permintaan komputasi, dan kemajuan pengiriman organisasi saat ini.", purpose: "Buka akun pembeli", heading: "Ruang anggota dan transaksi", lead: "Lihat saldo jam-kartu, pembelian, perbandingan, pembelian kembali, pendapatan sewa, dan komisi referal, lalu kelola alur permintaan dan penawaran.", boundary: "Akun dan entitas perdagangan dipisahkan", boundaryCopy: "Transaksi hanya memakai data akun yang masuk dan entitas aktif. Perbandingan disimpan lokal dan bukan pesanan, reservasi stok, atau pembayaran.", requestPurpose: "Lihat permintaan komputasi", orderPurpose: "Lihat pesanan pribadi" },
  ms: { title: "Pusat ahli", description: "Lihat jam-kad KAI, permintaan pengkomputeran dan kemajuan penghantaran organisasi semasa.", purpose: "Buka akaun pembeli", heading: "Ruang ahli dan transaksi", lead: "Lihat baki jam-kad, pembelian, perbandingan, pembelian balik, pendapatan sewaan dan komisen rujukan, kemudian urus aliran permintaan dan bekalan.", boundary: "Akaun dan entiti dagangan diasingkan", boundaryCopy: "Transaksi hanya menggunakan data akaun yang log masuk dan entiti aktif. Perbandingan disimpan setempat dan bukan pesanan, tempahan stok atau pembayaran.", requestPurpose: "Lihat permintaan pengkomputeran", orderPurpose: "Lihat pesanan peribadi" },
} as const satisfies Record<Locale, Record<string, string>>;

const kicker: Record<Locale, string> = {
  "zh-CN": "个人与交易工作台", "zh-TW": "個人與交易工作台", en: "Personal & transaction workspace",
  ja: "個人・取引ワークスペース", ko: "개인 및 거래 작업공간", fr: "Espace personnel et transactions",
  th: "พื้นที่ส่วนตัวและธุรกรรม", vi: "Không gian cá nhân và giao dịch", id: "Ruang pribadi dan transaksi", ms: "Ruang peribadi dan transaksi",
};

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getRequestLocale();
  return { title: copy[locale].title, description: copy[locale].description };
};

export default async function MemberPage() {
  const locale = await getRequestLocale();
  const text = copy[locale];
  if (isAccountConsoleV2Enabled()) {
    return <AccountRequired purpose={text.purpose} redirectOnSignedOut><AccountConsoleOverview mode="buyer" /></AccountRequired>;
  }
  const hostingV2Enabled = isHostingV2Enabled();
  return (
    <>
      <header className="border-b border-[var(--border)] bg-[var(--info-bg)]">
        <div className="shell py-12 sm:py-16">
          <p className="kicker">{kicker[locale]}</p>
          <div className="grid items-end gap-8 lg:grid-cols-[minmax(0,1fr)_360px]">
            <div>
              <h1 className="m-0 max-w-4xl text-4xl leading-tight sm:text-5xl">{text.heading}</h1>
              <p className="section-lead">{text.lead}</p>
            </div>
            <div className="border-l-2 border-[var(--accent)] pl-5 text-sm text-[var(--text)]">
              <strong className="block text-[var(--ink)]">{text.boundary}</strong>
              {text.boundaryCopy}
            </div>
          </div>
        </div>
      </header>
      <div className="shell py-12 sm:py-16">
        <PersonalCenterOverview />
        <AccountRequired purpose={text.requestPurpose}>
          <MemberPurchaseIntentList compact />
        </AccountRequired>
        <CardHourAccountPanel />
        <MemberWorkspace />
        <section className="mt-16 scroll-mt-28" id="orders">
          <AccountRequired purpose={text.orderPurpose}>
            <div className="grid gap-16">
              {hostingV2Enabled ? <HostingContractList embedded /> : null}
              <BuyerOrderList />
            </div>
          </AccountRequired>
        </section>
      </div>
    </>
  );
}
