"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Locale } from "@/lib/i18n";
import { KaiCloudBrand } from "./kai-cloud-brand";
import { useLocale } from "./locale-provider";
import styles from "./account-console-shell.module.css";

type ConsoleMode = "buyer" | "supplier";

type SessionSnapshot = {
  authenticated: boolean;
  account?: { displayName?: string; primaryEmail?: string | null } | null;
  organization?: { id?: string; name?: string } | null;
};

type ConsoleCapabilitySnapshot = {
  supplier?: { available?: boolean; approved?: boolean };
};

type AccountNavigationKey = "accountOverview" | "computeRequests" | "cardHours" | "resourceCompare" | "gpuMarket" | "supplyOverview" | "submitListing" | "listingApplications" | "managedDevices" | "listingManagement" | "ordersAndInstances" | "earningsAndSettlement";
type AccountConsoleCopy = {
  navigation: Record<AccountNavigationKey, string>;
  readingOrganization: string; noOrganization: string; checkingAccount: string; signedOut: string;
  buyerConsole: string; supplierConsole: string; accountNavigation: string; currentOrganization: string; currentAccount: string;
  workView: string; switchToSupplier: string; applyAsSupplier: string; manageSupply: string; submitForReview: string;
  returnToBuyer: string; viewPurchases: string; setupMode: string; setupDescription: string; more: string;
  navigationLabel: string; mobileNavigationLabel: string;
};

const accountConsoleCopy = {
  "zh-CN": { navigation: { accountOverview: "账户总览", computeRequests: "算力申请", cardHours: "卡时账户", resourceCompare: "资源对比", gpuMarket: "GPU 市场", supplyOverview: "供应概览", submitListing: "提交上架", listingApplications: "上架申请", managedDevices: "托管设备", listingManagement: "挂牌管理", ordersAndInstances: "订单与实例", earningsAndSettlement: "收益与结算" }, readingOrganization: "正在读取当前组织", noOrganization: "尚未绑定交易主体", checkingAccount: "正在核对账户", signedOut: "未登录", buyerConsole: "采购账户", supplierConsole: "供应工作台", accountNavigation: "账户导航", currentOrganization: "当前组织", currentAccount: "当前账户", workView: "工作视图", switchToSupplier: "切换到供应视图", applyAsSupplier: "申请成为供应商", manageSupply: "管理当前组织的供应资源", submitForReview: "提交后由平台人工审核", returnToBuyer: "返回采购账户", viewPurchases: "查看当前组织的购买数据", setupMode: "预上线配置模式", setupDescription: "可提交供应申请并查看人工审核进度；Agent、挂牌、公开成交、卡时扣减与收益结算仍保持关闭。", more: "更多", navigationLabel: "导航", mobileNavigationLabel: "移动导航" },
  "zh-TW": { navigation: { accountOverview: "帳戶總覽", computeRequests: "算力申請", cardHours: "卡時帳戶", resourceCompare: "資源比較", gpuMarket: "GPU 市場", supplyOverview: "供應總覽", submitListing: "提交上架", listingApplications: "上架申請", managedDevices: "託管裝置", listingManagement: "掛牌管理", ordersAndInstances: "訂單與執行個體", earningsAndSettlement: "收益與結算" }, readingOrganization: "正在讀取目前組織", noOrganization: "尚未綁定交易主體", checkingAccount: "正在核對帳戶", signedOut: "未登入", buyerConsole: "採購帳戶", supplierConsole: "供應工作台", accountNavigation: "帳戶導覽", currentOrganization: "目前組織", currentAccount: "目前帳戶", workView: "工作檢視", switchToSupplier: "切換到供應檢視", applyAsSupplier: "申請成為供應商", manageSupply: "管理目前組織的供應資源", submitForReview: "提交後由平台人工審核", returnToBuyer: "返回採購帳戶", viewPurchases: "查看目前組織的購買資料", setupMode: "上線前設定模式", setupDescription: "可提交供應申請並查看人工審核進度；Agent、掛牌、公開成交、卡時扣減與收益結算仍保持關閉。", more: "更多", navigationLabel: "導覽", mobileNavigationLabel: "行動導覽" },
  en: { navigation: { accountOverview: "Account overview", computeRequests: "Compute requests", cardHours: "Card-hour account", resourceCompare: "Compare resources", gpuMarket: "GPU market", supplyOverview: "Supply overview", submitListing: "Submit listing", listingApplications: "Listing applications", managedDevices: "Hosted devices", listingManagement: "Listings", ordersAndInstances: "Orders & instances", earningsAndSettlement: "Earnings & settlement" }, readingOrganization: "Loading organization", noOrganization: "No trading organization linked", checkingAccount: "Checking account", signedOut: "Signed out", buyerConsole: "Buyer account", supplierConsole: "Supplier workspace", accountNavigation: "Account navigation", currentOrganization: "Current organization", currentAccount: "Current account", workView: "Workspace view", switchToSupplier: "Switch to supplier view", applyAsSupplier: "Apply to become a supplier", manageSupply: "Manage this organization's supply", submitForReview: "Submissions are reviewed manually", returnToBuyer: "Return to buyer account", viewPurchases: "View this organization's purchases", setupMode: "Pre-launch configuration mode", setupDescription: "You can submit supply applications and review manual approval progress. Agent, listings, public transactions, card-hour deductions, earnings and settlement remain disabled.", more: "More", navigationLabel: "navigation", mobileNavigationLabel: "mobile navigation" },
  ja: { navigation: { accountOverview: "アカウント概要", computeRequests: "コンピュート申請", cardHours: "カード時間口座", resourceCompare: "リソース比較", gpuMarket: "GPU 市場", supplyOverview: "供給概要", submitListing: "掲載申請", listingApplications: "掲載申請一覧", managedDevices: "ホスト端末", listingManagement: "掲載管理", ordersAndInstances: "注文とインスタンス", earningsAndSettlement: "収益と精算" }, readingOrganization: "組織を読み込み中", noOrganization: "取引組織が未登録です", checkingAccount: "アカウントを確認中", signedOut: "未ログイン", buyerConsole: "購入アカウント", supplierConsole: "サプライヤーワークスペース", accountNavigation: "アカウントナビゲーション", currentOrganization: "現在の組織", currentAccount: "現在のアカウント", workView: "作業ビュー", switchToSupplier: "供給ビューへ切替", applyAsSupplier: "サプライヤーに申請", manageSupply: "現在の組織の供給を管理", submitForReview: "送信後にプラットフォームが手動審査", returnToBuyer: "購入アカウントに戻る", viewPurchases: "現在の組織の購入データを表示", setupMode: "リリース前設定モード", setupDescription: "供給申請と手動審査状況を確認できます。Agent、掲載、公開取引、カード時間控除、収益と精算は無効です。", more: "その他", navigationLabel: "ナビゲーション", mobileNavigationLabel: "モバイルナビゲーション" },
  ko: { navigation: { accountOverview: "계정 개요", computeRequests: "컴퓨팅 신청", cardHours: "카드시간 계정", resourceCompare: "리소스 비교", gpuMarket: "GPU 시장", supplyOverview: "공급 개요", submitListing: "등록 제출", listingApplications: "등록 신청", managedDevices: "호스팅 장치", listingManagement: "등록 관리", ordersAndInstances: "주문 및 인스턴스", earningsAndSettlement: "수익 및 정산" }, readingOrganization: "현재 조직 불러오는 중", noOrganization: "거래 조직이 연결되지 않음", checkingAccount: "계정 확인 중", signedOut: "로그아웃됨", buyerConsole: "구매자 계정", supplierConsole: "공급자 작업공간", accountNavigation: "계정 탐색", currentOrganization: "현재 조직", currentAccount: "현재 계정", workView: "작업 보기", switchToSupplier: "공급 보기로 전환", applyAsSupplier: "공급자 신청", manageSupply: "현재 조직의 공급 리소스 관리", submitForReview: "제출 후 플랫폼 수동 심사", returnToBuyer: "구매자 계정으로 돌아가기", viewPurchases: "현재 조직의 구매 데이터 보기", setupMode: "출시 전 설정 모드", setupDescription: "공급 신청과 수동 심사 진행 상황을 볼 수 있습니다. Agent, 등록, 공개 거래, 카드시간 차감, 수익 및 정산은 비활성화 상태입니다.", more: "더보기", navigationLabel: "탐색", mobileNavigationLabel: "모바일 탐색" },
  fr: { navigation: { accountOverview: "Vue du compte", computeRequests: "Demandes de calcul", cardHours: "Compte d'heures-carte", resourceCompare: "Comparer les ressources", gpuMarket: "Marché GPU", supplyOverview: "Vue de l'offre", submitListing: "Soumettre une offre", listingApplications: "Demandes de publication", managedDevices: "Appareils hébergés", listingManagement: "Gestion des offres", ordersAndInstances: "Commandes et instances", earningsAndSettlement: "Revenus et règlement" }, readingOrganization: "Chargement de l'organisation", noOrganization: "Aucune entité de transaction liée", checkingAccount: "Vérification du compte", signedOut: "Déconnecté", buyerConsole: "Compte acheteur", supplierConsole: "Espace fournisseur", accountNavigation: "Navigation du compte", currentOrganization: "Organisation actuelle", currentAccount: "Compte actuel", workView: "Vue de travail", switchToSupplier: "Passer à la vue fournisseur", applyAsSupplier: "Devenir fournisseur", manageSupply: "Gérer l'offre de cette organisation", submitForReview: "Examen manuel après soumission", returnToBuyer: "Retour au compte acheteur", viewPurchases: "Voir les achats de cette organisation", setupMode: "Mode de configuration avant lancement", setupDescription: "Vous pouvez soumettre une offre et suivre l'examen manuel. Agent, publications, transactions publiques, débits d'heures-carte, revenus et règlements restent désactivés.", more: "Plus", navigationLabel: "navigation", mobileNavigationLabel: "navigation mobile" },
  th: { navigation: { accountOverview: "ภาพรวมบัญชี", computeRequests: "คำขอประมวลผล", cardHours: "บัญชีชั่วโมงการ์ด", resourceCompare: "เปรียบเทียบทรัพยากร", gpuMarket: "ตลาด GPU", supplyOverview: "ภาพรวมอุปทาน", submitListing: "ส่งรายการ", listingApplications: "คำขอลงรายการ", managedDevices: "อุปกรณ์โฮสต์", listingManagement: "จัดการรายการ", ordersAndInstances: "คำสั่งซื้อและอินสแตนซ์", earningsAndSettlement: "รายได้และการชำระ" }, readingOrganization: "กำลังโหลดองค์กร", noOrganization: "ยังไม่ได้เชื่อมโยงองค์กรการค้า", checkingAccount: "กำลังตรวจสอบบัญชี", signedOut: "ออกจากระบบ", buyerConsole: "บัญชีผู้ซื้อ", supplierConsole: "พื้นที่ผู้ให้บริการ", accountNavigation: "การนำทางบัญชี", currentOrganization: "องค์กรปัจจุบัน", currentAccount: "บัญชีปัจจุบัน", workView: "มุมมองงาน", switchToSupplier: "สลับไปมุมมองผู้ให้บริการ", applyAsSupplier: "สมัครเป็นผู้ให้บริการ", manageSupply: "จัดการทรัพยากรขององค์กรนี้", submitForReview: "แพลตฟอร์มตรวจสอบด้วยตนเองหลังส่ง", returnToBuyer: "กลับไปบัญชีผู้ซื้อ", viewPurchases: "ดูข้อมูลการซื้อขององค์กรนี้", setupMode: "โหมดตั้งค่าก่อนเปิดตัว", setupDescription: "ส่งคำขออุปทานและดูสถานะตรวจสอบได้ ส่วน Agent รายการ ธุรกรรมสาธารณะ การหักชั่วโมงการ์ด รายได้และการชำระยังปิดอยู่", more: "เพิ่มเติม", navigationLabel: "การนำทาง", mobileNavigationLabel: "การนำทางมือถือ" },
  vi: { navigation: { accountOverview: "Tổng quan tài khoản", computeRequests: "Yêu cầu tính toán", cardHours: "Tài khoản giờ-thẻ", resourceCompare: "So sánh tài nguyên", gpuMarket: "Thị trường GPU", supplyOverview: "Tổng quan nguồn cung", submitListing: "Gửi đăng bán", listingApplications: "Yêu cầu đăng bán", managedDevices: "Thiết bị lưu trữ", listingManagement: "Quản lý đăng bán", ordersAndInstances: "Đơn hàng và phiên", earningsAndSettlement: "Doanh thu và quyết toán" }, readingOrganization: "Đang tải tổ chức", noOrganization: "Chưa liên kết tổ chức giao dịch", checkingAccount: "Đang kiểm tra tài khoản", signedOut: "Đã đăng xuất", buyerConsole: "Tài khoản mua", supplierConsole: "Không gian nhà cung cấp", accountNavigation: "Điều hướng tài khoản", currentOrganization: "Tổ chức hiện tại", currentAccount: "Tài khoản hiện tại", workView: "Chế độ làm việc", switchToSupplier: "Chuyển sang chế độ cung cấp", applyAsSupplier: "Đăng ký làm nhà cung cấp", manageSupply: "Quản lý nguồn cung của tổ chức", submitForReview: "Nền tảng xét duyệt thủ công sau khi gửi", returnToBuyer: "Quay lại tài khoản mua", viewPurchases: "Xem dữ liệu mua của tổ chức", setupMode: "Chế độ cấu hình trước khi mở", setupDescription: "Có thể gửi nguồn cung và xem tiến độ xét duyệt. Agent, đăng bán, giao dịch công khai, trừ giờ-thẻ, doanh thu và quyết toán vẫn bị tắt.", more: "Thêm", navigationLabel: "điều hướng", mobileNavigationLabel: "điều hướng di động" },
  id: { navigation: { accountOverview: "Ringkasan akun", computeRequests: "Permintaan komputasi", cardHours: "Akun jam-kartu", resourceCompare: "Bandingkan sumber daya", gpuMarket: "Pasar GPU", supplyOverview: "Ringkasan pasokan", submitListing: "Kirim listing", listingApplications: "Permohonan listing", managedDevices: "Perangkat hosting", listingManagement: "Kelola listing", ordersAndInstances: "Pesanan & instans", earningsAndSettlement: "Pendapatan & penyelesaian" }, readingOrganization: "Memuat organisasi", noOrganization: "Belum ada organisasi transaksi", checkingAccount: "Memeriksa akun", signedOut: "Keluar", buyerConsole: "Akun pembeli", supplierConsole: "Ruang pemasok", accountNavigation: "Navigasi akun", currentOrganization: "Organisasi saat ini", currentAccount: "Akun saat ini", workView: "Tampilan kerja", switchToSupplier: "Beralih ke tampilan pemasok", applyAsSupplier: "Daftar sebagai pemasok", manageSupply: "Kelola pasokan organisasi ini", submitForReview: "Platform meninjau secara manual setelah dikirim", returnToBuyer: "Kembali ke akun pembeli", viewPurchases: "Lihat pembelian organisasi ini", setupMode: "Mode konfigurasi prapeluncuran", setupDescription: "Anda dapat mengirim pasokan dan melihat tinjauan manual. Agent, listing, transaksi publik, debit jam-kartu, pendapatan, dan penyelesaian tetap dinonaktifkan.", more: "Lainnya", navigationLabel: "navigasi", mobileNavigationLabel: "navigasi seluler" },
  ms: { navigation: { accountOverview: "Ringkasan akaun", computeRequests: "Permintaan pengkomputeran", cardHours: "Akaun jam-kad", resourceCompare: "Bandingkan sumber", gpuMarket: "Pasaran GPU", supplyOverview: "Ringkasan bekalan", submitListing: "Hantar senarai", listingApplications: "Permohonan senarai", managedDevices: "Peranti pengehosan", listingManagement: "Urus senarai", ordersAndInstances: "Pesanan & tika", earningsAndSettlement: "Pendapatan & penyelesaian" }, readingOrganization: "Memuatkan organisasi", noOrganization: "Belum dipautkan kepada organisasi transaksi", checkingAccount: "Menyemak akaun", signedOut: "Log keluar", buyerConsole: "Akaun pembeli", supplierConsole: "Ruang pembekal", accountNavigation: "Navigasi akaun", currentOrganization: "Organisasi semasa", currentAccount: "Akaun semasa", workView: "Paparan kerja", switchToSupplier: "Tukar ke paparan pembekal", applyAsSupplier: "Mohon menjadi pembekal", manageSupply: "Urus bekalan organisasi ini", submitForReview: "Platform menyemak secara manual selepas dihantar", returnToBuyer: "Kembali ke akaun pembeli", viewPurchases: "Lihat pembelian organisasi ini", setupMode: "Mod konfigurasi prapelancaran", setupDescription: "Anda boleh menghantar bekalan dan melihat kemajuan semakan. Agent, senarai, transaksi awam, debit jam-kad, pendapatan dan penyelesaian kekal dilumpuhkan.", more: "Lagi", navigationLabel: "navigasi", mobileNavigationLabel: "navigasi mudah alih" },
} satisfies Record<Locale, AccountConsoleCopy>;

const buyerNavigation = [
  { href: "/member", labelKey: "accountOverview", exact: true },
  { href: "/member/purchases", labelKey: "computeRequests" },
  { href: "/member/card-hours", labelKey: "cardHours" },
  { href: "/member#compare", labelKey: "resourceCompare", anchor: "compare" },
  { href: "/gpu", labelKey: "gpuMarket", external: true },
] as const;

const supplierNavigation = [
  { href: "/supply", labelKey: "supplyOverview", exact: true },
  { href: "/supply/apply", labelKey: "submitListing" },
  { href: "/supply/applications", labelKey: "listingApplications" },
  { href: "/supply/devices", labelKey: "managedDevices", requiresApproval: true, requiresHosting: true },
  { href: "/supply/listings", labelKey: "listingManagement", requiresApproval: true, requiresHosting: true },
  { href: "/supply/orders", labelKey: "ordersAndInstances", requiresApproval: true, requiresHosting: true },
  { href: "/supply/earnings", labelKey: "earningsAndSettlement", requiresApproval: true, requiresHosting: true },
] as const;

function currentRoute(pathname: string, href: string, exact = false) {
  const routePath = href.split("#")[0];
  return exact ? pathname === routePath : pathname === routePath || pathname.startsWith(`${routePath}/`);
}

export function AccountConsoleShell({
  children,
  mode,
  configurationMode = false,
}: {
  children: ReactNode;
  mode: ConsoleMode;
  configurationMode?: boolean;
}) {
  const pathname = usePathname();
  const { locale } = useLocale();
  const copy = accountConsoleCopy[locale];
  const [navigationOpen, setNavigationOpen] = useState(false);
  const [session, setSession] = useState<SessionSnapshot | null>(null);
  const [capabilities, setCapabilities] = useState<ConsoleCapabilitySnapshot | null>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const navigation = mode === "buyer" ? buyerNavigation : supplierNavigation;
  const mobilePrimaryNavigation = mode === "buyer"
    ? [buyerNavigation[0], buyerNavigation[1], buyerNavigation[4]]
    : supplierNavigation.slice(0, 3);

  useEffect(() => {
    if (!navigationOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setNavigationOpen(false);
      menuButtonRef.current?.focus();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [navigationOpen]);

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      fetch("/api/auth/session", { credentials: "same-origin", cache: "no-store", signal: controller.signal }),
      fetch("/api/v1/member/account-console-summary", { credentials: "same-origin", cache: "no-store", signal: controller.signal }),
    ]).then(async ([sessionResponse, capabilityResponse]) => {
      setSession(sessionResponse.ok ? await sessionResponse.json() as SessionSnapshot : { authenticated: false });
      setCapabilities(capabilityResponse.ok ? await capabilityResponse.json() as ConsoleCapabilitySnapshot : {});
    }).catch(() => {
      setSession({ authenticated: false });
      setCapabilities({});
    });
    return () => controller.abort();
  }, []);

  const organizationName = session?.organization?.name?.trim() || (session === null ? copy.readingOrganization : copy.noOrganization);
  const accountName = session?.account?.displayName?.trim() || session?.account?.primaryEmail?.trim() || (session === null ? copy.checkingAccount : copy.signedOut);
  const consoleTitle = mode === "buyer" ? copy.buyerConsole : copy.supplierConsole;

  return (
    <div className={styles.console} data-console-mode={mode}>
      <header className={styles.topbar}>
        <div className={styles.topbarInner}>
          <button
            aria-controls="account-console-navigation"
            aria-expanded={navigationOpen}
            className={styles.menuButton}
            onClick={() => setNavigationOpen((current) => !current)}
            ref={menuButtonRef}
            type="button"
          >
            <span aria-hidden="true">{navigationOpen ? "×" : "☰"}</span>
            <span>{copy.accountNavigation}</span>
          </button>
          <div className={styles.organization}>
            <span>{copy.currentOrganization}</span>
            <strong>{organizationName}</strong>
          </div>
          <div className={styles.topbarMeta}>
            <span className={styles.modeBadge}>{consoleTitle}</span>
            <div className={styles.account}>
              <span>{copy.currentAccount}</span>
              <strong>{accountName}</strong>
            </div>
          </div>
        </div>
      </header>

      <div className={styles.workspace}>
        <aside className={`${styles.sidebar} ${navigationOpen ? styles.sidebarOpen : ""}`} id="account-console-navigation">
          <div className={styles.sidebarHeading}>
            <KaiCloudBrand size="console" />
            <strong>{consoleTitle}</strong>
          </div>
          <nav aria-label={`${consoleTitle} ${copy.navigationLabel}`} className={styles.navigation}>
            {navigation.map((item) => {
              if ("requiresApproval" in item && item.requiresApproval && !capabilities?.supplier?.approved) return null;
              if ("requiresHosting" in item && item.requiresHosting && configurationMode) return null;
              const active = !("external" in item && item.external) && !("anchor" in item && item.anchor) && currentRoute(pathname, item.href, "exact" in item && item.exact);
              return (
                <Link aria-current={active ? "page" : undefined} href={item.href} key={item.href} onClick={() => setNavigationOpen(false)}>
                  {copy.navigation[item.labelKey]}
                </Link>
              );
            })}
          </nav>
          <div className={styles.modeSwitch}>
            <span>{copy.workView}</span>
            {mode === "buyer" ? (
              <Link href={capabilities?.supplier?.available ? "/supply" : "/supply/apply"} onClick={() => setNavigationOpen(false)}>
                <strong>{capabilities?.supplier?.available ? copy.switchToSupplier : copy.applyAsSupplier}</strong>
                <small>{capabilities?.supplier?.approved ? copy.manageSupply : copy.submitForReview}</small>
              </Link>
            ) : (
              <Link href="/member" onClick={() => setNavigationOpen(false)}><strong>{copy.returnToBuyer}</strong><small>{copy.viewPurchases}</small></Link>
            )}
          </div>
        </aside>

        <div className={styles.contentColumn}>
          {configurationMode ? (
            <div className={styles.setupBanner} role="status">
              <strong>{copy.setupMode}</strong>
              <span>{copy.setupDescription}</span>
            </div>
          ) : null}
          <div className={styles.content}>{children}</div>
        </div>
      </div>
      <nav aria-label={`${consoleTitle} ${copy.mobileNavigationLabel}`} className={styles.mobileDock}>
        {mobilePrimaryNavigation.map((item) => (
          <Link aria-current={currentRoute(pathname, item.href, "exact" in item && item.exact) ? "page" : undefined} href={item.href} key={item.href}>{copy.navigation[item.labelKey]}</Link>
        ))}
        <button aria-expanded={navigationOpen} onClick={() => setNavigationOpen((current) => !current)} type="button">{copy.more}</button>
      </nav>
    </div>
  );
}
