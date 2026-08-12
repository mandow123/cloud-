"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { PublicHostingOffer } from "@/lib/hosting-v2-client";
import { formatCardHours } from "@/lib/hosting-v2-client";
import styles from "./hosting-public.module.css";

type ReadinessCheck = Readonly<{ ready: boolean; reason?: string }>;

type HostingReadiness = Readonly<{
  enabled: boolean;
  configurationEnabled: boolean;
  ready: boolean;
  rolloutMode: "DISABLED" | "SETUP" | "INTERNAL_AGENT_TRIAL";
  checks: Readonly<{
    supplierIdentity: ReadinessCheck;
    agentDelivery: ReadinessCheck;
    feeSchedule: ReadinessCheck;
    cardHourLedger: ReadinessCheck;
    approvedImages: ReadinessCheck & Readonly<{ count: number }>;
    metering: ReadinessCheck;
    cleanup: ReadinessCheck;
    alipayClosed: ReadinessCheck;
  }>;
  operations: Readonly<{
    approvedSupplierCount: number;
    activeAgentCount: number;
    drainingDeviceCount: number;
    failedCleanupCount: number;
  }> | null;
}>;

type ReadinessEnvelope = Readonly<{
  release?: string;
  environment?: Readonly<{ localAcceptance?: boolean }>;
  hostingV2?: HostingReadiness;
}>;

type AccountEnvelope = Readonly<{
  authenticated?: boolean;
  account?: Readonly<{ displayName?: string }> | null;
  organization?: Readonly<{ name?: string }> | null;
}>;

type LaunchpadState = Readonly<{
  readiness: HostingReadiness;
  release: string;
  offers: readonly PublicHostingOffer[];
  account: AccountEnvelope;
  localAcceptance: boolean;
}>;

const MODE_LABELS: Record<HostingReadiness["rolloutMode"], string> = {
  DISABLED: "尚未开放",
  SETUP: "预上线配置",
  INTERNAL_AGENT_TRIAL: "邀请制试运营",
};

const CHECK_LABELS = {
  supplierIdentity: "统一身份与供应主体",
  agentDelivery: "真实 Host Agent",
  feeSchedule: "有效费率版本",
  cardHourLedger: "卡时锁定与结算账本",
  approvedImages: "审核交付镜像",
  metering: "真实计量",
  cleanup: "撤权与清理",
  alipayClosed: "公开充值保持关闭",
} as const;

async function responseJson<T>(response: Response): Promise<T | null> {
  try {
    return await response.json() as T;
  } catch {
    return null;
  }
}

function shortRelease(value: string) {
  return /^[a-f0-9]{12,64}$/u.test(value) ? value.slice(0, 12) : value;
}

function modelLabel(model: PublicHostingOffer["gpuModel"]) {
  return model === "RTX_4090" ? "RTX 4090" : "H100 80GB";
}

export function HostingLaunchpad() {
  const [state, setState] = useState<LaunchpadState | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [readinessResponse, offersResponse, accountResponse] = await Promise.all([
        fetch("/api/ready", { cache: "no-store", credentials: "same-origin" }),
        fetch("/api/v2/offers", { cache: "no-store", credentials: "same-origin" }),
        fetch("/api/auth/session", { cache: "no-store", credentials: "same-origin" }),
      ]);
      const [readinessBody, offersBody, accountBody] = await Promise.all([
        responseJson<ReadinessEnvelope>(readinessResponse),
        responseJson<{ records?: PublicHostingOffer[] }>(offersResponse),
        responseJson<AccountEnvelope>(accountResponse),
      ]);
      if (!readinessBody?.hostingV2 || !accountResponse.ok || !accountBody) throw new Error("HOSTING_STATUS_INVALID");
      setState({
        readiness: readinessBody.hostingV2,
        release: readinessBody.release ?? "unknown",
        offers: offersResponse.ok && Array.isArray(offersBody?.records) ? offersBody.records : [],
        account: accountBody,
        localAcceptance: readinessBody.environment?.localAcceptance === true,
      });
    } catch {
      setError("实时状态暂时无法读取。平台不会在状态未知时开放成交。");
    }
  }, []);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => { void load(); });
    return () => window.cancelAnimationFrame(frame);
  }, [load]);

  const models = useMemo(() => state
    ? [...new Set(state.offers.map((offer) => modelLabel(offer.gpuModel)))]
    : [], [state]);

  if (error) {
    return (
      <section className={styles.launchpadError} role="alert">
        <div><strong>Hosting 状态未知</strong><p>{error}</p></div>
        <button onClick={() => void load()} type="button">重新读取</button>
      </section>
    );
  }

  if (!state) return <div className={styles.launchpadLoading} role="status">正在同步报价、Agent 与结算状态…</div>;

  const { readiness, offers, account } = state;
  const operations = readiness.operations;
  const transactionOpen = readiness.enabled && readiness.ready;
  const supplierHref = account.authenticated ? "/supply" : "/login?returnTo=%2Fsupply";
  const supplierAction = account.authenticated ? "进入供应控制台" : "登录后开始上架";
  const checkRows = Object.entries(CHECK_LABELS) as Array<[keyof typeof CHECK_LABELS, string]>;

  return (
    <section className={styles.launchpad} aria-labelledby="hosting-launchpad-title">
      <header className={styles.launchpadHeader}>
        <div>
          <p className={styles.sectionIndex}>LIVE CONTROL PLANE</p>
          <h2 id="hosting-launchpad-title">现在要租用，还是提供算力？</h2>
          <p>两条路径共用同一份真实报价、设备证据、订单状态与卡时账本。</p>
        </div>
        <div className={transactionOpen && !state.localAcceptance ? styles.liveState : styles.closedState}>
          <span aria-hidden="true" />
          <div><small>当前运行阶段</small><strong>{state.localAcceptance ? "本地验收 · 非生产供给" : MODE_LABELS[readiness.rolloutMode]}</strong></div>
        </div>
      </header>

      <div className={styles.launchpadActions}>
        <article className={styles.launchpadAction}>
          <span className={styles.cardCode}>BUY · RENT</span>
          <h3>我需要 GPU 算力</h3>
          <p>比较经过验真的真实报价，锁定卡时后获得独立实例与临时 SSH 凭证。</p>
          <div className={styles.actionMeta}>
            <span><strong>{offers.length}</strong> 个可成交报价</span>
            <span>{models.length ? models.join(" · ") : "暂无真实机器在线"}</span>
          </div>
          <Link className={styles.actionPrimary} href="/gpu">进入 GPU 市场</Link>
        </article>

        <article className={styles.launchpadAction}>
          <span className={styles.cardCode}>HOST · EARN</span>
          <h3>我有 GPU 可以上架</h3>
          <p>完成主体审核、Agent 配对与硬件验真，再发布以 KAI 标准卡时计价的报价。</p>
          <div className={styles.actionMeta}>
            <span><strong>{operations?.activeAgentCount ?? 0}</strong> 台有效 Agent</span>
            <span>{account.authenticated ? account.organization?.name ?? "当前交易主体" : "尚未登录交易主体"}</span>
          </div>
          <Link className={styles.actionSecondary} href={supplierHref}>{supplierAction}</Link>
        </article>
      </div>

      <div className={styles.launchpadData}>
        <section className={styles.liveMetrics} aria-label="实时运营指标">
          {[
            ["公开报价", String(offers.length), "只统计当前可成交"],
            ["审核供应主体", String(operations?.approvedSupplierCount ?? 0), "服务端审核结果"],
            ["有效 Agent", String(operations?.activeAgentCount ?? 0), "在线且验真有效"],
            ["异常清理", String((operations?.drainingDeviceCount ?? 0) + (operations?.failedCleanupCount ?? 0)), "非零时禁止再售"],
          ].map(([label, value, note]) => (
            <div key={label}><span>{label}</span><strong>{value}</strong><small>{note}</small></div>
          ))}
        </section>

        <section className={styles.readinessPanel} aria-labelledby="readiness-panel-title">
          <header><h3 id="readiness-panel-title">成交就绪检查</h3><span>Release {shortRelease(state.release)}</span></header>
          <ul>
            {checkRows.map(([key, label]) => {
              const check = readiness.checks[key];
              return <li key={key}><span>{label}</span><strong className={check.ready ? styles.checkReady : styles.checkClosed}>{check.ready ? "READY" : "CLOSED"}</strong></li>;
            })}
          </ul>
          <p>{state.localAcceptance ? "本地验收允许跑通交互和状态机，但不计作真实 GPU 或生产成交。" : transactionOpen ? "所有关键项已经就绪，新订单可以进入真实交付。" : "任一关键项未就绪时，公开成交保持关闭；页面不会用模拟资源冒充真实供给。"}</p>
        </section>
      </div>

      {offers.length ? (
        <section className={styles.offerPreview} aria-labelledby="live-offers-title">
          <header><h3 id="live-offers-title">当前真实报价</h3><Link href="/gpu">查看全部</Link></header>
          {offers.slice(0, 3).map((offer) => (
            <article key={offer.id}>
              <div><strong>{offer.title}</strong><span>{modelLabel(offer.gpuModel)} · {offer.region}</span></div>
              <div><strong>{formatCardHours(offer.pricing.cardHourMicrosPerGpuHour)}</strong><span>KAI 标准卡时 / GPU 小时</span></div>
              <Link href={`/gpu/offers/${encodeURIComponent(offer.id)}`}>查看并租用</Link>
            </article>
          ))}
        </section>
      ) : null}
    </section>
  );
}
