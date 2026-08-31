"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { useLocale } from "@/components/locale-provider";
import type { Locale } from "@/lib/i18n";
import styles from "./personal-menu.module.css";

const PERSONAL_SUMMARY_URL = "/api/v1/member/personal-summary";
const COMPARE_STORAGE_KEY = "kai-cloud-compare-v1";
const COMPARE_EVENT = "kai-compare-changed";
const MOBILE_QUERY = "(max-width: 720px)";

type PersonalProfile = {
  displayName?: string | null;
  maskedEmail?: string | null;
  organizationName?: string | null;
  subjectStatus?: "PENDING" | "ACTIVE" | "SUSPENDED" | null;
  verificationStatus?: string | null;
};

type PersonalCounts = {
  purchaseRequests?: number | null;
  pendingPayment?: number | null;
  orders?: number | null;
  pendingAcceptance?: number | null;
};

type PersonalSummary = {
  authenticated: boolean;
  profile?: PersonalProfile | null;
  counts?: PersonalCounts | null;
  payment?: {
    ready?: boolean;
    reason?: string | null;
  } | null;
};

type LoadState = "loading" | "ready" | "error";

type PersonalMenuCopy = {
  personal: string;
  personalWithPending: (count: string) => string;
  closeMenu: string;
  shortcuts: string;
  loadingTitle: string;
  loadingCopy: string;
  errorTitle: string;
  errorCopy: string;
  reload: string;
  signedOutTitle: string;
  signedOutCopy: string;
  login: string;
  defaultUser: string;
  cardHourAccount: string;
  purchases: string;
  comparisons: string;
  buybacks: string;
  income: string;
  referrals: string;
  businessShortcuts: string;
  paymentUnavailable: string;
  paymentFallback: string;
  memberCenter: string;
  loggingOut: string;
  logout: string;
  subjectActive: string;
  subjectPending: string;
  subjectSuspended: string;
};

const PERSONAL_MENU_COPY: Record<Locale, PersonalMenuCopy> = {
  "zh-CN": {
    personal: "个人", personalWithPending: (count) => `个人，有 ${count} 项待支付`, closeMenu: "关闭个人菜单", shortcuts: "个人快捷入口",
    loadingTitle: "正在读取个人信息", loadingCopy: "订单与交易状态正在同步。", errorTitle: "暂时无法读取个人信息", errorCopy: "没有使用本地数据冒充订单状态。", reload: "重新加载",
    signedOutTitle: "登录后查看个人业务", signedOutCopy: "集中查看卡时、购买记录、回购、收益与邀请奖励。", login: "登录", defaultUser: "KAI Cloud 用户",
    cardHourAccount: "卡时账户", purchases: "购买记录", comparisons: "我的对比", buybacks: "我的回购", income: "租金与佣金", referrals: "邀请奖励", businessShortcuts: "个人业务快捷入口",
    paymentUnavailable: "支付服务尚未就绪", paymentFallback: "待支付订单暂不能在线支付，请等待平台通知。", memberCenter: "进入个人中心", loggingOut: "正在退出…", logout: "退出登录",
    subjectActive: "主体已启用", subjectPending: "主体待完善", subjectSuspended: "主体已停用",
  },
  "zh-TW": {
    personal: "個人", personalWithPending: (count) => `個人，有 ${count} 筆待支付`, closeMenu: "關閉個人選單", shortcuts: "個人快捷入口",
    loadingTitle: "正在讀取個人資訊", loadingCopy: "訂單與交易狀態正在同步。", errorTitle: "暫時無法讀取個人資訊", errorCopy: "未使用本機資料冒充訂單狀態。", reload: "重新載入",
    signedOutTitle: "登入後查看個人業務", signedOutCopy: "集中查看卡時、購買記錄、回購、收益與邀請獎勵。", login: "登入", defaultUser: "KAI Cloud 使用者",
    cardHourAccount: "卡時帳戶", purchases: "購買記錄", comparisons: "我的比較", buybacks: "我的回購", income: "租金與佣金", referrals: "邀請獎勵", businessShortcuts: "個人業務快捷入口",
    paymentUnavailable: "支付服務尚未就緒", paymentFallback: "待支付訂單暫時無法線上支付，請等待平台通知。", memberCenter: "進入個人中心", loggingOut: "正在登出…", logout: "登出",
    subjectActive: "主體已啟用", subjectPending: "主體待完善", subjectSuspended: "主體已停用",
  },
  en: {
    personal: "Account", personalWithPending: (count) => `Account, ${count} payments pending`, closeMenu: "Close account menu", shortcuts: "Account shortcuts",
    loadingTitle: "Loading account information", loadingCopy: "Order and transaction status is syncing.", errorTitle: "Account information is temporarily unavailable", errorCopy: "Local data is not being presented as live order status.", reload: "Reload",
    signedOutTitle: "Sign in to view your activity", signedOutCopy: "View card-hours, purchases, buybacks, income, and referral rewards in one place.", login: "Sign in", defaultUser: "KAI Cloud user",
    cardHourAccount: "Card-hour account", purchases: "Purchases", comparisons: "My comparisons", buybacks: "My buybacks", income: "Rental and commission income", referrals: "Referral rewards", businessShortcuts: "Account activity shortcuts",
    paymentUnavailable: "Payment service is not ready", paymentFallback: "Pending orders cannot be paid online yet. Please wait for a platform update.", memberCenter: "Open member center", loggingOut: "Signing out…", logout: "Sign out",
    subjectActive: "Account entity active", subjectPending: "Account entity incomplete", subjectSuspended: "Account entity suspended",
  },
  ja: {
    personal: "アカウント", personalWithPending: (count) => `アカウント、未払い ${count} 件`, closeMenu: "アカウントメニューを閉じる", shortcuts: "アカウントのショートカット",
    loadingTitle: "アカウント情報を読み込み中", loadingCopy: "注文と取引の状態を同期しています。", errorTitle: "アカウント情報を一時的に取得できません", errorCopy: "ローカルデータを注文状態として表示していません。", reload: "再読み込み",
    signedOutTitle: "ログインして個人取引を確認", signedOutCopy: "カード時、購入履歴、買い戻し、収益、紹介特典をまとめて確認できます。", login: "ログイン", defaultUser: "KAI Cloud ユーザー",
    cardHourAccount: "カード時口座", purchases: "購入履歴", comparisons: "比較リスト", buybacks: "買い戻し", income: "賃料と手数料収益", referrals: "紹介特典", businessShortcuts: "個人取引のショートカット",
    paymentUnavailable: "決済サービスは準備中です", paymentFallback: "未払い注文は現在オンライン決済できません。プラットフォームからの案内をお待ちください。", memberCenter: "会員センターを開く", loggingOut: "ログアウト中…", logout: "ログアウト",
    subjectActive: "主体は有効です", subjectPending: "主体情報が未完了です", subjectSuspended: "主体は停止中です",
  },
  ko: {
    personal: "계정", personalWithPending: (count) => `계정, 결제 대기 ${count}건`, closeMenu: "계정 메뉴 닫기", shortcuts: "계정 바로가기",
    loadingTitle: "계정 정보 불러오는 중", loadingCopy: "주문 및 거래 상태를 동기화하고 있습니다.", errorTitle: "계정 정보를 일시적으로 불러올 수 없습니다", errorCopy: "로컬 데이터를 실제 주문 상태로 표시하지 않습니다.", reload: "다시 불러오기",
    signedOutTitle: "로그인하여 개인 업무 확인", signedOutCopy: "카드시간, 구매, 바이백, 수익 및 초대 보상을 한곳에서 확인하세요.", login: "로그인", defaultUser: "KAI Cloud 사용자",
    cardHourAccount: "카드시간 계정", purchases: "구매 기록", comparisons: "내 비교", buybacks: "내 바이백", income: "임대료 및 수수료", referrals: "초대 보상", businessShortcuts: "개인 업무 바로가기",
    paymentUnavailable: "결제 서비스가 아직 준비되지 않았습니다", paymentFallback: "결제 대기 주문은 아직 온라인으로 결제할 수 없습니다. 플랫폼 안내를 기다려 주세요.", memberCenter: "회원 센터 열기", loggingOut: "로그아웃 중…", logout: "로그아웃",
    subjectActive: "주체 활성화 완료", subjectPending: "주체 정보 보완 필요", subjectSuspended: "주체 사용 중지",
  },
  fr: {
    personal: "Compte", personalWithPending: (count) => `Compte, ${count} paiements en attente`, closeMenu: "Fermer le menu du compte", shortcuts: "Raccourcis du compte",
    loadingTitle: "Chargement du compte", loadingCopy: "Synchronisation des commandes et transactions.", errorTitle: "Informations du compte temporairement indisponibles", errorCopy: "Aucune donnée locale n’est présentée comme état réel d’une commande.", reload: "Recharger",
    signedOutTitle: "Connectez-vous pour voir votre activité", signedOutCopy: "Consultez heures-carte, achats, rachats, revenus et récompenses de parrainage au même endroit.", login: "Se connecter", defaultUser: "Utilisateur KAI Cloud",
    cardHourAccount: "Compte d’heures-carte", purchases: "Achats", comparisons: "Mes comparaisons", buybacks: "Mes rachats", income: "Loyers et commissions", referrals: "Récompenses de parrainage", businessShortcuts: "Raccourcis de l’activité du compte",
    paymentUnavailable: "Le service de paiement n’est pas prêt", paymentFallback: "Les commandes en attente ne peuvent pas encore être payées en ligne. Attendez la notification de la plateforme.", memberCenter: "Ouvrir l’espace membre", loggingOut: "Déconnexion…", logout: "Se déconnecter",
    subjectActive: "Entité du compte active", subjectPending: "Entité du compte à compléter", subjectSuspended: "Entité du compte suspendue",
  },
  th: {
    personal: "บัญชี", personalWithPending: (count) => `บัญชี มี ${count} รายการรอชำระ`, closeMenu: "ปิดเมนูบัญชี", shortcuts: "ทางลัดบัญชี",
    loadingTitle: "กำลังโหลดข้อมูลบัญชี", loadingCopy: "กำลังซิงก์สถานะคำสั่งซื้อและธุรกรรม", errorTitle: "ไม่สามารถอ่านข้อมูลบัญชีได้ชั่วคราว", errorCopy: "ระบบไม่ได้ใช้ข้อมูลในเครื่องแทนสถานะคำสั่งซื้อจริง", reload: "โหลดใหม่",
    signedOutTitle: "เข้าสู่ระบบเพื่อดูกิจกรรมของคุณ", signedOutCopy: "ดูชั่วโมงการ์ด การซื้อ การรับซื้อคืน รายได้ และรางวัลแนะนำได้ในที่เดียว", login: "เข้าสู่ระบบ", defaultUser: "ผู้ใช้ KAI Cloud",
    cardHourAccount: "บัญชีชั่วโมงการ์ด", purchases: "ประวัติการซื้อ", comparisons: "รายการเปรียบเทียบ", buybacks: "การรับซื้อคืน", income: "ค่าเช่าและค่าคอมมิชชัน", referrals: "รางวัลแนะนำ", businessShortcuts: "ทางลัดกิจกรรมบัญชี",
    paymentUnavailable: "บริการชำระเงินยังไม่พร้อม", paymentFallback: "คำสั่งซื้อที่รอชำระยังไม่สามารถชำระออนไลน์ได้ โปรดรอประกาศจากแพลตฟอร์ม", memberCenter: "เปิดศูนย์สมาชิก", loggingOut: "กำลังออกจากระบบ…", logout: "ออกจากระบบ",
    subjectActive: "เปิดใช้งานนิติบุคคลแล้ว", subjectPending: "ข้อมูลนิติบุคคลยังไม่สมบูรณ์", subjectSuspended: "ระงับนิติบุคคลแล้ว",
  },
  vi: {
    personal: "Tài khoản", personalWithPending: (count) => `Tài khoản, ${count} khoản chờ thanh toán`, closeMenu: "Đóng menu tài khoản", shortcuts: "Lối tắt tài khoản",
    loadingTitle: "Đang tải thông tin tài khoản", loadingCopy: "Đang đồng bộ trạng thái đơn hàng và giao dịch.", errorTitle: "Tạm thời không thể đọc thông tin tài khoản", errorCopy: "Dữ liệu cục bộ không được dùng để giả làm trạng thái đơn hàng thực.", reload: "Tải lại",
    signedOutTitle: "Đăng nhập để xem hoạt động cá nhân", signedOutCopy: "Xem giờ-thẻ, giao dịch mua, mua lại, thu nhập và thưởng giới thiệu tại một nơi.", login: "Đăng nhập", defaultUser: "Người dùng KAI Cloud",
    cardHourAccount: "Tài khoản giờ-thẻ", purchases: "Lịch sử mua", comparisons: "So sánh của tôi", buybacks: "Mua lại của tôi", income: "Tiền thuê và hoa hồng", referrals: "Thưởng giới thiệu", businessShortcuts: "Lối tắt hoạt động cá nhân",
    paymentUnavailable: "Dịch vụ thanh toán chưa sẵn sàng", paymentFallback: "Đơn hàng chờ thanh toán chưa thể thanh toán trực tuyến. Vui lòng chờ thông báo từ nền tảng.", memberCenter: "Mở trung tâm thành viên", loggingOut: "Đang đăng xuất…", logout: "Đăng xuất",
    subjectActive: "Chủ thể đã kích hoạt", subjectPending: "Chủ thể cần hoàn thiện", subjectSuspended: "Chủ thể đã tạm dừng",
  },
  id: {
    personal: "Akun", personalWithPending: (count) => `Akun, ${count} pembayaran tertunda`, closeMenu: "Tutup menu akun", shortcuts: "Pintasan akun",
    loadingTitle: "Memuat informasi akun", loadingCopy: "Status pesanan dan transaksi sedang disinkronkan.", errorTitle: "Informasi akun sementara tidak tersedia", errorCopy: "Data lokal tidak ditampilkan sebagai status pesanan langsung.", reload: "Muat ulang",
    signedOutTitle: "Masuk untuk melihat aktivitas Anda", signedOutCopy: "Lihat jam-kartu, pembelian, pembelian kembali, pendapatan, dan hadiah referal di satu tempat.", login: "Masuk", defaultUser: "Pengguna KAI Cloud",
    cardHourAccount: "Akun jam-kartu", purchases: "Riwayat pembelian", comparisons: "Perbandingan saya", buybacks: "Pembelian kembali", income: "Sewa dan komisi", referrals: "Hadiah referal", businessShortcuts: "Pintasan aktivitas akun",
    paymentUnavailable: "Layanan pembayaran belum siap", paymentFallback: "Pesanan tertunda belum dapat dibayar secara online. Tunggu pemberitahuan platform.", memberCenter: "Buka pusat anggota", loggingOut: "Keluar…", logout: "Keluar",
    subjectActive: "Entitas akun aktif", subjectPending: "Entitas akun belum lengkap", subjectSuspended: "Entitas akun ditangguhkan",
  },
  ms: {
    personal: "Akaun", personalWithPending: (count) => `Akaun, ${count} bayaran belum selesai`, closeMenu: "Tutup menu akaun", shortcuts: "Pintasan akaun",
    loadingTitle: "Memuatkan maklumat akaun", loadingCopy: "Status pesanan dan transaksi sedang disegerakkan.", errorTitle: "Maklumat akaun tidak tersedia buat sementara", errorCopy: "Data setempat tidak dipaparkan sebagai status pesanan langsung.", reload: "Muat semula",
    signedOutTitle: "Log masuk untuk melihat aktiviti anda", signedOutCopy: "Lihat jam-kad, pembelian, belian balik, pendapatan dan ganjaran rujukan di satu tempat.", login: "Log masuk", defaultUser: "Pengguna KAI Cloud",
    cardHourAccount: "Akaun jam-kad", purchases: "Rekod pembelian", comparisons: "Perbandingan saya", buybacks: "Belian balik saya", income: "Sewa dan komisen", referrals: "Ganjaran rujukan", businessShortcuts: "Pintasan aktiviti akaun",
    paymentUnavailable: "Perkhidmatan pembayaran belum tersedia", paymentFallback: "Pesanan belum dibayar tidak boleh dibayar dalam talian lagi. Tunggu pemberitahuan platform.", memberCenter: "Buka pusat ahli", loggingOut: "Sedang log keluar…", logout: "Log keluar",
    subjectActive: "Entiti akaun aktif", subjectPending: "Entiti akaun belum lengkap", subjectSuspended: "Entiti akaun digantung",
  },
};

type SummaryEntry = {
  href: string;
  label: string;
  showCount?: boolean;
  value?: number | null;
};

function nonNegativeInteger(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

function readCompareCount() {
  try {
    const stored = JSON.parse(window.localStorage.getItem(COMPARE_STORAGE_KEY) ?? "null") as unknown;
    if (!Array.isArray(stored)) return 0;
    return Math.min(
      3,
      new Set(stored.filter((item): item is string => typeof item === "string" && item.length > 0)).size,
    );
  } catch {
    return 0;
  }
}

function normalizeSummary(value: unknown): PersonalSummary | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.authenticated !== "boolean") return null;

  const profileSource = candidate.profile && typeof candidate.profile === "object"
    ? candidate.profile as Record<string, unknown>
    : null;
  const countsSource = candidate.counts && typeof candidate.counts === "object"
    ? candidate.counts as Record<string, unknown>
    : null;
  const paymentSource = candidate.payment && typeof candidate.payment === "object"
    ? candidate.payment as Record<string, unknown>
    : null;

  return {
    authenticated: candidate.authenticated,
    profile: profileSource ? {
      displayName: typeof profileSource.displayName === "string" ? profileSource.displayName : null,
      maskedEmail: typeof profileSource.maskedEmail === "string"
        ? profileSource.maskedEmail
        : typeof profileSource.email === "string" ? profileSource.email : null,
      organizationName: typeof profileSource.organizationName === "string" ? profileSource.organizationName : null,
      subjectStatus: profileSource.subjectStatus === "PENDING"
        || profileSource.subjectStatus === "ACTIVE"
        || profileSource.subjectStatus === "SUSPENDED"
        ? profileSource.subjectStatus
        : null,
      verificationStatus: typeof profileSource.verificationStatus === "string"
        ? profileSource.verificationStatus
        : null,
    } : null,
    counts: countsSource ? {
      purchaseRequests: nonNegativeInteger(countsSource.purchaseRequests ?? countsSource.purchaseIntents),
      pendingPayment: nonNegativeInteger(countsSource.pendingPayment),
      orders: nonNegativeInteger(countsSource.orders),
      pendingAcceptance: nonNegativeInteger(countsSource.pendingAcceptance),
    } : null,
    payment: paymentSource ? {
      ready: paymentSource.ready === true,
      reason: typeof paymentSource.reason === "string" ? paymentSource.reason : null,
    } : null,
  };
}

function countLabel(value: number | null | undefined, locale: Locale) {
  return value == null ? "—" : new Intl.NumberFormat(locale).format(value);
}

function subjectStatusLabel(value: unknown, copy: PersonalMenuCopy) {
  if (value === "ACTIVE") return copy.subjectActive;
  if (value === "PENDING") return copy.subjectPending;
  if (value === "SUSPENDED") return copy.subjectSuspended;
  return null;
}

function AvatarIcon() {
  return (
    <span className={styles.avatar} aria-hidden="true">
      <svg viewBox="0 0 24 24" focusable="false">
        <circle cx="12" cy="8.25" r="4.1" />
        <path d="M4.8 20c.55-4.05 3.1-6.15 7.2-6.15s6.65 2.1 7.2 6.15" />
      </svg>
    </span>
  );
}

function ChevronIcon() {
  return (
    <svg className={styles.chevron} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="m4 6 4 4 4-4" />
    </svg>
  );
}

export function PersonalMenu() {
  const { locale } = useLocale();
  const copy = PERSONAL_MENU_COPY[locale];
  const [open, setOpen] = useState(false);
  const [mobile, setMobile] = useState(false);
  const [summary, setSummary] = useState<PersonalSummary | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [compareCount, setCompareCount] = useState(0);
  const [logoutBusy, setLogoutBusy] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const requestControllerRef = useRef<AbortController | null>(null);
  const panelId = useId();

  const loadSummary = useCallback(async () => {
    requestControllerRef.current?.abort();
    const controller = new AbortController();
    requestControllerRef.current = controller;
    setLoadState("loading");
    try {
      const response = await fetch(PERSONAL_SUMMARY_URL, {
        credentials: "same-origin",
        cache: "no-store",
        signal: controller.signal,
      });
      const payload = normalizeSummary(await response.json());
      if (!response.ok || !payload) throw new Error("INVALID_PERSONAL_SUMMARY");
      setSummary(payload);
      setLoadState("ready");
    } catch {
      if (controller.signal.aborted) return;
      setSummary(null);
      setLoadState("error");
    }
  }, []);

  const closeMenu = useCallback((restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) window.requestAnimationFrame(() => triggerRef.current?.focus());
  }, []);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => void loadSummary());
    return () => {
      window.cancelAnimationFrame(frame);
      requestControllerRef.current?.abort();
    };
  }, [loadSummary]);

  useEffect(() => {
    const media = window.matchMedia(MOBILE_QUERY);
    const update = () => setMobile(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    const updateCompareCount = () => setCompareCount(readCompareCount());
    updateCompareCount();
    window.addEventListener("storage", updateCompareCount);
    window.addEventListener(COMPARE_EVENT, updateCompareCount);
    return () => {
      window.removeEventListener("storage", updateCompareCount);
      window.removeEventListener(COMPARE_EVENT, updateCompareCount);
    };
  }, []);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) closeMenu(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeMenu(true);
        return;
      }
      if (event.key !== "Tab" || !mobile || !panelRef.current) return;
      const focusable = Array.from(panelRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    if (mobile) document.body.style.overflow = "hidden";
    window.requestAnimationFrame(() => {
      const panel = panelRef.current;
      const initialTarget = panel?.querySelector<HTMLElement>("[data-personal-menu-initial-focus]");
      (initialTarget ?? panel)?.focus();
    });

    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      if (mobile) document.body.style.overflow = previousOverflow;
    };
  }, [closeMenu, mobile, open]);

  function onTriggerKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (event.key !== "ArrowDown") return;
    event.preventDefault();
    setOpen(true);
  }

  async function logout() {
    if (logoutBusy) return;
    setLogoutBusy(true);
    try {
      const response = await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
      });
      if (!response.ok) throw new Error("LOGOUT_FAILED");
      window.location.reload();
    } catch {
      setLoadState("error");
      setLogoutBusy(false);
    }
  }

  const pendingPayment = summary?.authenticated
    ? nonNegativeInteger(summary.counts?.pendingPayment)
    : null;

  return (
    <div className={styles.root} ref={rootRef}>
      <button
        ref={triggerRef}
        className={styles.trigger}
        type="button"
        aria-controls={panelId}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={pendingPayment && pendingPayment > 0 ? copy.personalWithPending(countLabel(pendingPayment, locale)) : copy.personal}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={onTriggerKeyDown}
      >
        <span className={styles.avatarWrap}>
          <AvatarIcon />
          {pendingPayment && pendingPayment > 0 ? <span className={styles.noticeDot} aria-hidden="true" /> : null}
        </span>
        <span className={styles.triggerLabel}>{copy.personal}</span>
        <ChevronIcon />
      </button>

      {open ? (
        <>
          <button className={styles.backdrop} aria-label={copy.closeMenu} onClick={() => closeMenu(true)} type="button" />
          <section
            className={styles.panel}
            id={panelId}
            ref={panelRef}
            role="dialog"
            tabIndex={-1}
            aria-label={copy.shortcuts}
            aria-modal={mobile || undefined}
          >
            <div className={styles.mobileHandle} aria-hidden="true" />
            <div className={styles.panelTopline}>
              <strong>{copy.personal}</strong>
              <button className={styles.closeButton} aria-label={copy.closeMenu} onClick={() => closeMenu(true)} type="button">
                <span aria-hidden="true">×</span>
              </button>
            </div>
            <PersonalMenuContent
              compareCount={compareCount}
              copy={copy}
              loadState={loadState}
              locale={locale}
              logoutBusy={logoutBusy}
              onNavigate={() => closeMenu(false)}
              onLogout={logout}
              onRetry={loadSummary}
              summary={summary}
            />
          </section>
        </>
      ) : null}
    </div>
  );
}

function PersonalMenuContent({
  compareCount,
  copy,
  loadState,
  locale,
  logoutBusy,
  onNavigate,
  onLogout,
  onRetry,
  summary,
}: {
  compareCount: number;
  copy: PersonalMenuCopy;
  loadState: LoadState;
  locale: Locale;
  logoutBusy: boolean;
  onNavigate: () => void;
  onLogout: () => void;
  onRetry: () => void;
  summary: PersonalSummary | null;
}) {
  if (loadState === "loading") {
    return (
      <div className={styles.statusState} role="status">
        <span className={styles.loadingMark} aria-hidden="true" />
        <div>
          <strong>{copy.loadingTitle}</strong>
          <p>{copy.loadingCopy}</p>
        </div>
      </div>
    );
  }

  if (loadState === "error") {
    return (
      <div className={styles.statusState} role="alert">
        <span className={styles.statusSymbol} aria-hidden="true">!</span>
        <div>
          <strong>{copy.errorTitle}</strong>
          <p>{copy.errorCopy}</p>
          <button
            className={styles.textButton}
            data-personal-menu-initial-focus
            onClick={() => void onRetry()}
            type="button"
          >
            {copy.reload}
          </button>
        </div>
      </div>
    );
  }

  if (!summary?.authenticated) {
    return (
      <div className={styles.signedOut}>
        <div className={styles.identityRow}>
          <AvatarIcon />
          <div>
            <strong>{copy.signedOutTitle}</strong>
            <p>{copy.signedOutCopy}</p>
          </div>
        </div>
        <Link
          className={styles.primaryLink}
          data-personal-menu-initial-focus
          href="/login?returnTo=%2Fmember"
          onClick={onNavigate}
        >
          <span>{copy.login}</span><span aria-hidden="true">→</span>
        </Link>
      </div>
    );
  }

  const profile = summary.profile;
  const entries: SummaryEntry[] = [
    { href: "/member#card-hours", label: copy.cardHourAccount },
    { href: "/member#purchases", label: copy.purchases, showCount: true, value: (summary.counts?.purchaseRequests ?? 0) + (summary.counts?.orders ?? 0) },
    { href: "/member#compare", label: copy.comparisons, showCount: true, value: compareCount },
    { href: "/member#buybacks", label: copy.buybacks },
    { href: "/member#income", label: copy.income },
    { href: "/member#referrals", label: copy.referrals },
  ];
  const subjectLabel = subjectStatusLabel(profile?.subjectStatus, copy);

  return (
    <div>
      <div className={styles.identityRow}>
        <AvatarIcon />
        <div className={styles.identityCopy}>
          <strong>{profile?.displayName?.trim() || copy.defaultUser}</strong>
          {profile?.maskedEmail ? <span>{profile.maskedEmail}</span> : null}
          {profile?.organizationName ? <span>{profile.organizationName}</span> : null}
          {profile?.verificationStatus ? <small>{profile.verificationStatus}</small> : subjectLabel ? <small>{subjectLabel}</small> : null}
        </div>
      </div>

      <nav className={styles.entryGrid} aria-label={copy.businessShortcuts}>
        {entries.map((entry, index) => (
          <Link
            className={styles.entry}
            data-personal-menu-initial-focus={index === 0 ? "true" : undefined}
            href={entry.href}
            key={entry.href}
            onClick={onNavigate}
          >
            <span>{entry.label}</span>
            {entry.showCount ? <strong>{countLabel(entry.value, locale)}</strong> : <span className={styles.entryArrow} aria-hidden="true">→</span>}
          </Link>
        ))}
      </nav>

      {summary.payment?.ready === false ? (
        <p className={styles.paymentNotice} role="status">
          <strong>{copy.paymentUnavailable}</strong>
          <span>{summary.payment.reason?.trim() || copy.paymentFallback}</span>
        </p>
      ) : null}

      <div className={styles.accountActions}>
        <Link className={styles.accountLink} href="/member" onClick={onNavigate}>
          <span>{copy.memberCenter}</span><span aria-hidden="true">→</span>
        </Link>
        <button className={styles.logoutButton} disabled={logoutBusy} onClick={() => void onLogout()} type="button">
          {logoutBusy ? copy.loggingOut : copy.logout}
        </button>
      </div>
    </div>
  );
}
