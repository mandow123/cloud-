"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { adminGetSession, adminLogout } from "@/components/admin-api-client";
import { useLocale } from "@/components/locale-provider";
import { adminNavigation } from "@/lib/admin-view-models";
import type { Locale } from "@/lib/i18n";

type AdminHref = (typeof adminNavigation)[number]["items"][number]["href"];
type AdminGroupLabel = (typeof adminNavigation)[number]["label"];
type AdminShellCopy = { backend: string; returnWebsite: string; mainNavigation: string; permissionNotice: string; operationsConsole: string; localWarning: string; myTasks: string; criticalExceptions: string; checkingSession: string; serverAuthorization: string; loggingOut: string; logout: string; login: string };

const adminShellCopy = {
  "zh-CN": { backend: "管理后台", returnWebsite: "返回网站", mainNavigation: "管理员主导航", permissionNotice: "权限由服务端逐请求校验。", operationsConsole: "KAI Cloud 运营控制台", localWarning: "LOCAL · 非生产数据", myTasks: "我的待办", criticalExceptions: "严重异常", checkingSession: "正在校验会话", serverAuthorization: "服务端鉴权", loggingOut: "退出中…", logout: "退出", login: "登录" },
  "zh-TW": { backend: "管理後台", returnWebsite: "返回網站", mainNavigation: "管理員主導覽", permissionNotice: "權限由服務端逐次請求驗證。", operationsConsole: "KAI Cloud 營運控制台", localWarning: "LOCAL · 非生產資料", myTasks: "我的待辦", criticalExceptions: "嚴重異常", checkingSession: "正在驗證工作階段", serverAuthorization: "服務端驗證", loggingOut: "登出中…", logout: "登出", login: "登入" },
  en: { backend: "Admin console", returnWebsite: "Return to website", mainNavigation: "Administrator navigation", permissionNotice: "Permissions are verified by the server on every request.", operationsConsole: "KAI Cloud operations console", localWarning: "LOCAL · Non-production data", myTasks: "My tasks", criticalExceptions: "Critical exceptions", checkingSession: "Checking session", serverAuthorization: "Server authorization", loggingOut: "Signing out…", logout: "Sign out", login: "Sign in" },
  ja: { backend: "管理コンソール", returnWebsite: "サイトに戻る", mainNavigation: "管理者ナビゲーション", permissionNotice: "権限はリクエストごとにサーバーで検証されます。", operationsConsole: "KAI Cloud 運用コンソール", localWarning: "LOCAL · 非本番データ", myTasks: "自分のタスク", criticalExceptions: "重大な異常", checkingSession: "セッションを確認中", serverAuthorization: "サーバー認証", loggingOut: "ログアウト中…", logout: "ログアウト", login: "ログイン" },
  ko: { backend: "관리 콘솔", returnWebsite: "웹사이트로 돌아가기", mainNavigation: "관리자 탐색", permissionNotice: "권한은 요청마다 서버에서 확인됩니다.", operationsConsole: "KAI Cloud 운영 콘솔", localWarning: "LOCAL · 비프로덕션 데이터", myTasks: "내 할 일", criticalExceptions: "심각한 예외", checkingSession: "세션 확인 중", serverAuthorization: "서버 인증", loggingOut: "로그아웃 중…", logout: "로그아웃", login: "로그인" },
  fr: { backend: "Console d’administration", returnWebsite: "Retour au site", mainNavigation: "Navigation administrateur", permissionNotice: "Les autorisations sont vérifiées par le serveur à chaque requête.", operationsConsole: "Console d’exploitation KAI Cloud", localWarning: "LOCAL · Données hors production", myTasks: "Mes tâches", criticalExceptions: "Anomalies critiques", checkingSession: "Vérification de la session", serverAuthorization: "Autorisation serveur", loggingOut: "Déconnexion…", logout: "Se déconnecter", login: "Se connecter" },
  th: { backend: "คอนโซลผู้ดูแล", returnWebsite: "กลับไปเว็บไซต์", mainNavigation: "การนำทางผู้ดูแล", permissionNotice: "เซิร์ฟเวอร์ตรวจสอบสิทธิ์ทุกคำขอ", operationsConsole: "คอนโซลปฏิบัติการ KAI Cloud", localWarning: "LOCAL · ข้อมูลที่ไม่ใช่การผลิต", myTasks: "งานของฉัน", criticalExceptions: "ข้อผิดพลาดร้ายแรง", checkingSession: "กำลังตรวจสอบเซสชัน", serverAuthorization: "การอนุญาตฝั่งเซิร์ฟเวอร์", loggingOut: "กำลังออกจากระบบ…", logout: "ออกจากระบบ", login: "เข้าสู่ระบบ" },
  vi: { backend: "Bảng quản trị", returnWebsite: "Quay lại trang web", mainNavigation: "Điều hướng quản trị", permissionNotice: "Máy chủ kiểm tra quyền cho từng yêu cầu.", operationsConsole: "Bảng vận hành KAI Cloud", localWarning: "LOCAL · Dữ liệu phi sản xuất", myTasks: "Việc của tôi", criticalExceptions: "Bất thường nghiêm trọng", checkingSession: "Đang kiểm tra phiên", serverAuthorization: "Xác thực máy chủ", loggingOut: "Đang đăng xuất…", logout: "Đăng xuất", login: "Đăng nhập" },
  id: { backend: "Konsol admin", returnWebsite: "Kembali ke situs", mainNavigation: "Navigasi administrator", permissionNotice: "Izin diverifikasi server pada setiap permintaan.", operationsConsole: "Konsol operasi KAI Cloud", localWarning: "LOCAL · Data nonproduksi", myTasks: "Tugas saya", criticalExceptions: "Pengecualian kritis", checkingSession: "Memeriksa sesi", serverAuthorization: "Otorisasi server", loggingOut: "Keluar…", logout: "Keluar", login: "Masuk" },
  ms: { backend: "Konsol pentadbir", returnWebsite: "Kembali ke laman web", mainNavigation: "Navigasi pentadbir", permissionNotice: "Kebenaran disahkan oleh pelayan pada setiap permintaan.", operationsConsole: "Konsol operasi KAI Cloud", localWarning: "LOCAL · Data bukan pengeluaran", myTasks: "Tugasan saya", criticalExceptions: "Pengecualian kritikal", checkingSession: "Menyemak sesi", serverAuthorization: "Kebenaran pelayan", loggingOut: "Log keluar…", logout: "Log keluar", login: "Log masuk" },
} satisfies Record<Locale, AdminShellCopy>;

const adminGroupLabels = {
  "zh-CN": { "运营总览": "运营总览", "供给运营": "供给运营", "需求运营": "需求运营", "容量市场": "容量市场", "交易履约": "交易履约", "财务运营": "财务运营", "风险异常": "风险异常", "管理": "管理" },
  "zh-TW": { "运营总览": "營運總覽", "供给运营": "供給營運", "需求运营": "需求營運", "容量市场": "容量市場", "交易履约": "交易履約", "财务运营": "財務營運", "风险异常": "風險異常", "管理": "管理" },
  en: { "运营总览": "Operations overview", "供给运营": "Supply operations", "需求运营": "Demand operations", "容量市场": "Capacity market", "交易履约": "Transaction fulfillment", "财务运营": "Financial operations", "风险异常": "Risk & exceptions", "管理": "Administration" },
  ja: { "运营总览": "運用概要", "供给运营": "供給運用", "需求运营": "需要運用", "容量市场": "容量市場", "交易履约": "取引履行", "财务运营": "財務運用", "风险异常": "リスクと異常", "管理": "管理" },
  ko: { "运营总览": "운영 개요", "供给运营": "공급 운영", "需求运营": "수요 운영", "容量市场": "용량 시장", "交易履约": "거래 이행", "财务运营": "재무 운영", "风险异常": "위험 및 예외", "管理": "관리" },
  fr: { "运营总览": "Vue d’exploitation", "供给运营": "Opérations d’offre", "需求运营": "Opérations de demande", "容量市场": "Marché de capacité", "交易履约": "Exécution des transactions", "财务运营": "Opérations financières", "风险异常": "Risques et anomalies", "管理": "Administration" },
  th: { "运营总览": "ภาพรวมการดำเนินงาน", "供给运营": "การดำเนินงานอุปทาน", "需求运营": "การดำเนินงานอุปสงค์", "容量市场": "ตลาดความจุ", "交易履约": "การส่งมอบธุรกรรม", "财务运营": "การดำเนินงานการเงิน", "风险异常": "ความเสี่ยงและข้อผิดพลาด", "管理": "การจัดการ" },
  vi: { "运营总览": "Tổng quan vận hành", "供给运营": "Vận hành nguồn cung", "需求运营": "Vận hành nhu cầu", "容量市场": "Thị trường dung lượng", "交易履约": "Thực hiện giao dịch", "财务运营": "Vận hành tài chính", "风险异常": "Rủi ro và bất thường", "管理": "Quản trị" },
  id: { "运营总览": "Ringkasan operasi", "供给运营": "Operasi pasokan", "需求运营": "Operasi permintaan", "容量市场": "Pasar kapasitas", "交易履约": "Pemenuhan transaksi", "财务运营": "Operasi keuangan", "风险异常": "Risiko & pengecualian", "管理": "Administrasi" },
  ms: { "运营总览": "Ringkasan operasi", "供给运营": "Operasi bekalan", "需求运营": "Operasi permintaan", "容量市场": "Pasaran kapasiti", "交易履约": "Pemenuhan transaksi", "财务运营": "Operasi kewangan", "风险异常": "Risiko & pengecualian", "管理": "Pentadbiran" },
} satisfies Record<Locale, Record<AdminGroupLabel, string>>;

const adminItemLabels = {
  "/admin": { "zh-CN": "总览", "zh-TW": "總覽", en: "Overview", ja: "概要", ko: "개요", fr: "Vue générale", th: "ภาพรวม", vi: "Tổng quan", id: "Ringkasan", ms: "Ringkasan" },
  "/admin/hosting": { "zh-CN": "Hosting 试运营", "zh-TW": "Hosting 試營運", en: "Hosting pilot", ja: "Hosting 試験運用", ko: "Hosting 시범 운영", fr: "Pilote Hosting", th: "ทดลอง Hosting", vi: "Thử nghiệm Hosting", id: "Uji coba Hosting", ms: "Percubaan Hosting" },
  "/admin/supply-offers": { "zh-CN": "上架资源", "zh-TW": "上架資源", en: "Listed resources", ja: "掲載リソース", ko: "등록 리소스", fr: "Ressources publiées", th: "ทรัพยากรที่ลงรายการ", vi: "Tài nguyên đăng bán", id: "Sumber daya terdaftar", ms: "Sumber disenaraikan" },
  "/admin/pools": { "zh-CN": "算力池", "zh-TW": "算力池", en: "Compute pools", ja: "コンピュートプール", ko: "컴퓨팅 풀", fr: "Pools de calcul", th: "พูลประมวลผล", vi: "Nhóm tính toán", id: "Pool komputasi", ms: "Kolam pengkomputeran" },
  "/admin/verifications": { "zh-CN": "验真任务", "zh-TW": "驗真任務", en: "Verification tasks", ja: "検証タスク", ko: "검증 작업", fr: "Tâches de vérification", th: "งานตรวจสอบ", vi: "Nhiệm vụ xác minh", id: "Tugas verifikasi", ms: "Tugasan pengesahan" },
  "/admin/demands": { "zh-CN": "买方需求", "zh-TW": "買方需求", en: "Buyer demand", ja: "購入者需要", ko: "구매자 수요", fr: "Demandes acheteurs", th: "ความต้องการผู้ซื้อ", vi: "Nhu cầu người mua", id: "Permintaan pembeli", ms: "Permintaan pembeli" },
  "/admin/matches": { "zh-CN": "供需匹配", "zh-TW": "供需配對", en: "Supply-demand matches", ja: "需給マッチング", ko: "공급·수요 매칭", fr: "Correspondances offre-demande", th: "จับคู่อุปสงค์และอุปทาน", vi: "Ghép cung cầu", id: "Pencocokan pasokan-permintaan", ms: "Padanan bekalan-permintaan" },
  "/admin/capacity-lots": { "zh-CN": "容量批次", "zh-TW": "容量批次", en: "Capacity lots", ja: "容量ロット", ko: "용량 배치", fr: "Lots de capacité", th: "ชุดความจุ", vi: "Lô dung lượng", id: "Batch kapasitas", ms: "Kelompok kapasiti" },
  "/admin/listings": { "zh-CN": "挂牌版本", "zh-TW": "掛牌版本", en: "Listing versions", ja: "掲載バージョン", ko: "등록 버전", fr: "Versions d’offres", th: "รุ่นรายการ", vi: "Phiên bản đăng bán", id: "Versi listing", ms: "Versi senarai" },
  "/admin/withdrawals": { "zh-CN": "容量取回", "zh-TW": "容量取回", en: "Capacity withdrawal", ja: "容量引出し", ko: "용량 회수", fr: "Retrait de capacité", th: "ถอนความจุ", vi: "Thu hồi dung lượng", id: "Penarikan kapasitas", ms: "Pengambilan kapasiti" },
  "/admin/swaps": { "zh-CN": "容量置换", "zh-TW": "容量置換", en: "Capacity swaps", ja: "容量交換", ko: "용량 교환", fr: "Échanges de capacité", th: "แลกเปลี่ยนความจุ", vi: "Hoán đổi dung lượng", id: "Pertukaran kapasitas", ms: "Pertukaran kapasiti" },
  "/admin/standardization": { "zh-CN": "KAI 标准卡时", "zh-TW": "KAI 標準卡時", en: "KAI standard card-hours", ja: "KAI 標準カード時間", ko: "KAI 표준 카드시간", fr: "Heures-carte standard KAI", th: "ชั่วโมงการ์ดมาตรฐาน KAI", vi: "Giờ-thẻ chuẩn KAI", id: "Jam-kartu standar KAI", ms: "Jam-kad standard KAI" },
  "/admin/orders": { "zh-CN": "订单", "zh-TW": "訂單", en: "Orders", ja: "注文", ko: "주문", fr: "Commandes", th: "คำสั่งซื้อ", vi: "Đơn hàng", id: "Pesanan", ms: "Pesanan" },
  "/admin/delivery": { "zh-CN": "交付与服务", "zh-TW": "交付與服務", en: "Delivery & service", ja: "納品とサービス", ko: "납품 및 서비스", fr: "Livraison et service", th: "การส่งมอบและบริการ", vi: "Bàn giao và dịch vụ", id: "Pengiriman & layanan", ms: "Penyerahan & perkhidmatan" },
  "/admin/appeals": { "zh-CN": "人工申诉", "zh-TW": "人工申訴", en: "Manual appeals", ja: "手動異議申立て", ko: "수동 이의제기", fr: "Recours manuels", th: "อุทธรณ์ด้วยตนเอง", vi: "Khiếu nại thủ công", id: "Banding manual", ms: "Rayuan manual" },
  "/admin/metering": { "zh-CN": "计量与验收", "zh-TW": "計量與驗收", en: "Metering & acceptance", ja: "計測と検収", ko: "계량 및 검수", fr: "Mesure et réception", th: "การวัดและการยอมรับ", vi: "Đo lường và nghiệm thu", id: "Pengukuran & penerimaan", ms: "Pemeteran & penerimaan" },
  "/admin/payments/refunds": { "zh-CN": "支付与退款", "zh-TW": "支付與退款", en: "Payments & refunds", ja: "支払いと返金", ko: "결제 및 환불", fr: "Paiements et remboursements", th: "การชำระและคืนเงิน", vi: "Thanh toán và hoàn tiền", id: "Pembayaran & pengembalian", ms: "Pembayaran & bayaran balik" },
  "/admin/card-hour-topup-appeals": { "zh-CN": "充值异常申诉", "zh-TW": "充值異常申訴", en: "Top-up issue appeals", ja: "チャージ異常申立て", ko: "충전 오류 이의제기", fr: "Recours de recharge", th: "อุทธรณ์ปัญหาเติมเงิน", vi: "Khiếu nại nạp tiền", id: "Banding masalah isi ulang", ms: "Rayuan isu tambah nilai" },
  "/admin/settlements": { "zh-CN": "结算与账本", "zh-TW": "結算與帳本", en: "Settlement & ledger", ja: "精算と台帳", ko: "정산 및 원장", fr: "Règlement et registre", th: "การชำระและบัญชีแยกประเภท", vi: "Quyết toán và sổ cái", id: "Penyelesaian & buku besar", ms: "Penyelesaian & lejar" },
  "/admin/commissions": { "zh-CN": "代理归因与佣金", "zh-TW": "代理歸因與佣金", en: "Attribution & commission", ja: "帰属と手数料", ko: "귀속 및 수수료", fr: "Attribution et commission", th: "การระบุที่มาและค่าคอมมิชชัน", vi: "Phân bổ và hoa hồng", id: "Atribusi & komisi", ms: "Atribusi & komisen" },
  "/admin/work-items": { "zh-CN": "运营待办", "zh-TW": "營運待辦", en: "Operations tasks", ja: "運用タスク", ko: "운영 할 일", fr: "Tâches d’exploitation", th: "งานปฏิบัติการ", vi: "Việc vận hành", id: "Tugas operasi", ms: "Tugasan operasi" },
  "/admin/exceptions": { "zh-CN": "异常中心", "zh-TW": "異常中心", en: "Exception center", ja: "異常センター", ko: "예외 센터", fr: "Centre d’anomalies", th: "ศูนย์ข้อผิดพลาด", vi: "Trung tâm bất thường", id: "Pusat pengecualian", ms: "Pusat pengecualian" },
  "/admin/accounts": { "zh-CN": "账户", "zh-TW": "帳戶", en: "Accounts", ja: "アカウント", ko: "계정", fr: "Comptes", th: "บัญชี", vi: "Tài khoản", id: "Akun", ms: "Akaun" },
  "/admin/admins": { "zh-CN": "管理员", "zh-TW": "管理員", en: "Administrators", ja: "管理者", ko: "관리자", fr: "Administrateurs", th: "ผู้ดูแล", vi: "Quản trị viên", id: "Administrator", ms: "Pentadbir" },
  "/admin/audit": { "zh-CN": "操作审计", "zh-TW": "操作稽核", en: "Operations audit", ja: "操作監査", ko: "작업 감사", fr: "Audit des opérations", th: "ตรวจสอบการดำเนินงาน", vi: "Kiểm toán thao tác", id: "Audit operasi", ms: "Audit operasi" },
} satisfies Record<AdminHref, Record<Locale, string>>;

function currentLabel(pathname: string, locale: Locale) {
  for (const group of adminNavigation) {
    for (const item of group.items) {
      if (("exact" in item && item.exact && pathname === item.href) || (!("exact" in item) && pathname.startsWith(item.href))) return adminItemLabels[item.href][locale];
    }
  }
  return adminShellCopy[locale].backend;
}

export function AdminShell({ children, environment, appealsEnabled = false }: { children: ReactNode; environment: string; appealsEnabled?: boolean }) {
  const pathname = usePathname();
  const { locale } = useLocale();
  const copy = adminShellCopy[locale];
  const isLogin = pathname === "/admin/login";
  const env = environment.toUpperCase();
  const [session, setSession] = useState<Record<string, unknown> | null>(null);
  const [sessionChecked, setSessionChecked] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void adminGetSession()
      .then((record) => { if (!cancelled) setSession(record); })
      .catch(() => undefined)
      .finally(() => { if (!cancelled) setSessionChecked(true); });
    return () => { cancelled = true; };
  }, []);

  async function logout() {
    setLoggingOut(true);
    try {
      await adminLogout();
      window.location.assign("/admin/login");
    } catch {
      setLoggingOut(false);
    }
  }

  const adminEnvelope = session?.admin && typeof session.admin === "object" && !Array.isArray(session.admin) ? session.admin as Record<string, unknown> : {};
  const identity = session && (session.user ?? session.actor ?? adminEnvelope.principal ?? session.account);
  const identityObject = identity && typeof identity === "object" && !Array.isArray(identity) ? identity as Record<string, unknown> : {};
  const name = String(identityObject.displayName ?? identityObject.name ?? session?.displayName ?? copy.checkingSession);
  const rolesValue = session?.roles ?? identityObject.roles ?? session?.role;
  const roleList = Array.isArray(rolesValue) ? rolesValue.filter((role): role is string => typeof role === "string") : typeof rolesValue === "string" ? [rolesValue] : [];
  const roles = roleList.length ? roleList.join(" / ") : copy.serverAuthorization;
  const financeApproverOnly = roleList.includes("FINANCE_APPROVER") && !roleList.includes("ROOT");
  const featureNavigation = adminNavigation.map((group) => ({ ...group, items: group.items.filter((item) => !("requiresManualAppeals" in item && item.requiresManualAppeals) || appealsEnabled) })).filter((group) => group.items.length);
  const visibleNavigation = financeApproverOnly
    ? featureNavigation.map((group) => ({ ...group, items: group.items.filter((item) => ["/admin/hosting", "/admin/audit"].includes(item.href)) })).filter((group) => group.items.length)
    : featureNavigation;
  const adminHome = financeApproverOnly ? "/admin/hosting" : "/admin";
  const authenticated = session?.authenticated === true;

  if (isLogin) {
    return (
      <div className="admin-app admin-login-app" data-environment={env}>
        <div className="admin-login-topbar">
          <Link className="admin-brand" href="/admin/login"><span>KAI</span> ADMIN</Link>
          <span className={`admin-env ${env === "LOCAL" ? "is-local" : ""}`}>{env}</span>
          <Link className="admin-text-link" href="/" target="_blank">{copy.returnWebsite} ↗</Link>
        </div>
        {children}
      </div>
    );
  }

  return (
    <div className="admin-app" data-environment={env}>
      <aside className="admin-sidebar">
        <div className="admin-sidebar-head">
          <Link className="admin-brand" href={adminHome}><span>KAI</span> ADMIN</Link>
          <span className={`admin-env ${env === "LOCAL" ? "is-local" : ""}`}>{env}</span>
        </div>
        <nav aria-label={copy.mainNavigation} className="admin-navigation">
          {visibleNavigation.map((group) => (
            <section className="admin-nav-group" key={group.label}>
              <h2>{adminGroupLabels[locale][group.label]}</h2>
              <div>
                {group.items.map((item) => {
                  const active = ("exact" in item && item.exact) ? pathname === item.href : pathname.startsWith(item.href);
                  return <Link aria-current={active ? "page" : undefined} href={item.href} key={item.href}>{adminItemLabels[item.href][locale]}</Link>;
                })}
              </div>
            </section>
          ))}
        </nav>
        <div className="admin-sidebar-foot">
          <p>{copy.permissionNotice}</p>
          <Link href="/" target="_blank">{copy.returnWebsite} ↗</Link>
        </div>
      </aside>

      <div className="admin-workspace">
        <header className="admin-topbar">
          <div>
            <span className="admin-topbar-eyebrow">{copy.operationsConsole}</span>
            <strong>{currentLabel(pathname, locale)}</strong>
          </div>
          <div className="admin-topbar-actions">
            {env === "LOCAL" ? <span className="admin-local-warning">{copy.localWarning}</span> : null}
            {!financeApproverOnly ? <><Link href="/admin/work-items">{copy.myTasks}</Link><Link href="/admin/exceptions">{copy.criticalExceptions}</Link></> : null}
            {!sessionChecked ? <span className="admin-session"><strong>{copy.checkingSession}</strong><small>{copy.serverAuthorization}</small></span> : authenticated ? <><span className="admin-session"><strong>{name}</strong><small>{roles}</small></span><button disabled={loggingOut} onClick={() => void logout()} type="button">{loggingOut ? copy.loggingOut : copy.logout}</button></> : <Link href="/admin/login">{copy.login}</Link>}
          </div>
        </header>
        <div className="admin-main" id="admin-main-content">{children}</div>
      </div>
    </div>
  );
}
