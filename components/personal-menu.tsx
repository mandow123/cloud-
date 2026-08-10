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
        : subjectStatusLabel(profileSource.subjectStatus),
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

function countLabel(value: number | null | undefined) {
  return value == null ? "—" : new Intl.NumberFormat("zh-CN").format(value);
}

function subjectStatusLabel(value: unknown) {
  if (value === "ACTIVE") return "主体已启用";
  if (value === "PENDING") return "主体待完善";
  if (value === "SUSPENDED") return "主体已停用";
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
      if (!response.ok || !payload) throw new Error("个人摘要返回了无法识别的内容");
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
        aria-label={pendingPayment && pendingPayment > 0 ? `个人，有 ${pendingPayment} 项待支付` : "个人"}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={onTriggerKeyDown}
      >
        <span className={styles.avatarWrap}>
          <AvatarIcon />
          {pendingPayment && pendingPayment > 0 ? <span className={styles.noticeDot} aria-hidden="true" /> : null}
        </span>
        <span className={styles.triggerLabel}>个人</span>
        <ChevronIcon />
      </button>

      {open ? (
        <>
          <button className={styles.backdrop} aria-label="关闭个人菜单" onClick={() => closeMenu(true)} type="button" />
          <section
            className={styles.panel}
            id={panelId}
            ref={panelRef}
            role="dialog"
            tabIndex={-1}
            aria-label="个人快捷入口"
            aria-modal={mobile || undefined}
          >
            <div className={styles.mobileHandle} aria-hidden="true" />
            <div className={styles.panelTopline}>
              <strong>个人</strong>
              <button className={styles.closeButton} aria-label="关闭个人菜单" onClick={() => closeMenu(true)} type="button">
                <span aria-hidden="true">×</span>
              </button>
            </div>
            <PersonalMenuContent
              compareCount={compareCount}
              loadState={loadState}
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
  loadState,
  logoutBusy,
  onNavigate,
  onLogout,
  onRetry,
  summary,
}: {
  compareCount: number;
  loadState: LoadState;
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
          <strong>正在读取个人信息</strong>
          <p>订单与交易状态正在同步。</p>
        </div>
      </div>
    );
  }

  if (loadState === "error") {
    return (
      <div className={styles.statusState} role="alert">
        <span className={styles.statusSymbol} aria-hidden="true">!</span>
        <div>
          <strong>暂时无法读取个人信息</strong>
          <p>没有使用本地数据冒充订单状态。</p>
          <button
            className={styles.textButton}
            data-personal-menu-initial-focus
            onClick={() => void onRetry()}
            type="button"
          >
            重新加载
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
            <strong>登录后查看个人业务</strong>
            <p>集中查看购买申请、订单、待验收和对比。</p>
          </div>
        </div>
        <Link
          className={styles.primaryLink}
          data-personal-menu-initial-focus
          href="/login?returnTo=%2Fmember"
          onClick={onNavigate}
        >
          <span>登录</span><span aria-hidden="true">→</span>
        </Link>
      </div>
    );
  }

  const profile = summary.profile;
  const entries: SummaryEntry[] = [
    { href: "/member#purchase-requests", label: "购买申请", showCount: true, value: summary.counts?.purchaseRequests },
    { href: "/member#pending-payment", label: "待支付", showCount: true, value: summary.counts?.pendingPayment },
    { href: "/member#orders", label: "我的订单", showCount: true, value: summary.counts?.orders },
    { href: "/member#pending-acceptance", label: "待验收", showCount: true, value: summary.counts?.pendingAcceptance },
    { href: "/member#compare", label: "我的对比", showCount: true, value: compareCount },
    { href: "/member#profile", label: "基础信息" },
  ];

  return (
    <div>
      <div className={styles.identityRow}>
        <AvatarIcon />
        <div className={styles.identityCopy}>
          <strong>{profile?.displayName?.trim() || "KAI Cloud 用户"}</strong>
          {profile?.maskedEmail ? <span>{profile.maskedEmail}</span> : null}
          {profile?.organizationName ? <span>{profile.organizationName}</span> : null}
          {profile?.verificationStatus ? <small>{profile.verificationStatus}</small> : null}
        </div>
      </div>

      <nav className={styles.entryGrid} aria-label="个人业务快捷入口">
        {entries.map((entry, index) => (
          <Link
            className={styles.entry}
            data-personal-menu-initial-focus={index === 0 ? "true" : undefined}
            href={entry.href}
            key={entry.href}
            onClick={onNavigate}
          >
            <span>{entry.label}</span>
            {entry.showCount ? <strong>{countLabel(entry.value)}</strong> : <span className={styles.entryArrow} aria-hidden="true">→</span>}
          </Link>
        ))}
      </nav>

      {summary.payment?.ready === false ? (
        <p className={styles.paymentNotice} role="status">
          <strong>支付服务尚未就绪</strong>
          <span>{summary.payment.reason?.trim() || "待支付订单暂不能在线支付，请等待平台通知。"}</span>
        </p>
      ) : null}

      <div className={styles.accountActions}>
        <Link className={styles.accountLink} href="/member" onClick={onNavigate}>
          <span>进入个人中心</span><span aria-hidden="true">→</span>
        </Link>
        <button className={styles.logoutButton} disabled={logoutBusy} onClick={() => void onLogout()} type="button">
          {logoutBusy ? "正在退出…" : "退出登录"}
        </button>
      </div>
    </div>
  );
}
