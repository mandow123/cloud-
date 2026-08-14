"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { isHostingSupplierProfileReady, type HostingSupplierProfile } from "@/lib/hosting-v2";
import type { SupplierHostingDashboard } from "@/lib/hosting-v2-client";
import { marketplaceErrorMessage, marketplaceGet } from "@/lib/client/marketplace-client";
import styles from "./supply-console.module.css";

const profileLabels: Record<HostingSupplierProfile["status"], string> = {
  DRAFT: "资料草稿",
  SUBMITTED: "等待审核",
  APPROVED: "已通过审核",
  REJECTED: "需要修改",
  SUSPENDED: "已暂停",
};

const profileBadgeClass: Partial<Record<HostingSupplierProfile["status"], string>> = {
  DRAFT: styles.statusWarning,
  SUBMITTED: styles.statusWarning,
  REJECTED: styles.statusError,
  SUSPENDED: styles.statusError,
};

function cardHours(micros: number) {
  if (!Number.isSafeInteger(micros) || micros < 0) return "—";
  const whole = Math.floor(micros / 1_000_000);
  const fraction = String(micros % 1_000_000).padStart(6, "0").replace(/0+$/u, "");
  return fraction ? `${whole}.${fraction}` : String(whole);
}

function dateTime(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : new Intl.DateTimeFormat("zh-CN", { dateStyle: "short", timeStyle: "short" }).format(date);
}

function shortId(value: string) {
  return value.length > 18 ? `${value.slice(0, 9)}…${value.slice(-6)}` : value;
}

export function SupplyDashboard() {
  const [dashboard, setDashboard] = useState<SupplierHostingDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const result = await marketplaceGet<{ dashboard: SupplierHostingDashboard }>("/api/v2/supply/dashboard");
      setDashboard(result.dashboard);
    } catch (cause) {
      setError(marketplaceErrorMessage(cause, "供应商控制台暂时无法读取。"));
    }
  }, []);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => { void load(); });
    return () => window.cancelAnimationFrame(frame);
  }, [load]);

  if (error) {
    return (
      <section className={styles.error} role="alert">
        <h2>控制台读取失败</h2>
        <p>{error}</p>
        <button className={`${styles.secondaryAction} mt-4`} onClick={() => void load()} type="button">重新读取</button>
      </section>
    );
  }

  if (!dashboard) return <div className={styles.loading} role="status">正在读取供应主体、设备和订单状态…</div>;

  const profile = dashboard.profile;
  const supplierApproved = dashboard.readiness.supplierApproved && isHostingSupplierProfileReady(profile);
  const supplierContracts = dashboard.contracts;
  const nextStep = !profile
    ? { title: "先建立供应主体", description: "填写最少必要资料并保存草稿，确认后再提交人工审核。", href: "/supply/onboarding", label: "开始供应商审核" }
    : profile.status === "DRAFT" || profile.status === "REJECTED"
      ? { title: "完成并提交审核资料", description: profile.status === "REJECTED" ? profile.reviewNote ?? "审核人员要求修改资料。" : "资料仍是草稿，尚未进入人工审核。", href: "/supply/onboarding", label: "继续填写资料" }
      : profile.status === "SUBMITTED"
        ? { title: "资料正在审核", description: "审核期间不能修改资料。状态变化会直接显示在本控制台。", href: "/supply/onboarding", label: "查看审核状态" }
        : profile.status === "APPROVED" && !supplierApproved
          ? { title: "补全供应商审核证据", description: "当前记录标记为通过，但缺少有效协议版本或审核证据摘要，后端已保持关闭。请由管理员补录审核证据。", href: "/supply/onboarding", label: "查看审核记录" }
        : supplierApproved && dashboard.devices.length === 0
          ? { title: "可以登记第一台设备", description: "资源登记页会生成 5 分钟有效、受限的一次性 Agent 配对凭证。", href: "/supply/resources/new", label: "登记第一台设备" }
          : supplierApproved && dashboard.readiness.onlineVerifiedDevices === 0
            ? { title: "让设备在线并完成验真", description: "Host Agent 心跳和硬件验真都有效后，设备才具备挂牌资格。", href: "/supply/resources", label: "查看设备状态" }
            : supplierApproved && dashboard.offers.length === 0
              ? { title: "创建第一条真实报价", description: "选择已验真的设备、可用窗口和 KAI 标准卡时价格。", href: "/supply/listings/new", label: "创建挂牌" }
              : supplierApproved
                ? { title: "管理挂牌与订单", description: "查看公开状态、资源预留和 Host Agent 履约进度。", href: "/supply/listings", label: "进入挂牌管理" }
          : { title: "供应资格已暂停", description: profile.reviewNote ?? "请联系平台运营确认恢复条件。", href: "/supply/onboarding", label: "查看审核说明" };

  const readiness = [
    ["供应主体已审核", dashboard.readiness.supplierApproved],
    ["在线且验真有效的设备", dashboard.readiness.onlineVerifiedDevices > 0],
    ["有效费率版本", dashboard.readiness.activeFeeSchedule],
    ["卡时结算账本", dashboard.readiness.cardHourSettlement],
    ["公开支付宝充值", dashboard.readiness.alipayPublicTopup],
    ["自动回购 / 变现", dashboard.readiness.buyback],
  ] as const;

  return (
    <>
      <div className={styles.pageHeading}>
        <div>
          <h1>供应概览</h1>
          <p>这里只显示当前登录账户与当前组织的数据。资源发布、履约和财务权限均由服务端分别判定。</p>
        </div>
        <span className={`${styles.statusBadge} ${profile ? profileBadgeClass[profile.status] ?? "" : styles.statusWarning}`}>
          {profile?.status === "APPROVED" && !supplierApproved ? "审核记录不完整" : profile ? profileLabels[profile.status] : "尚未建立供应主体"}
        </span>
      </div>

      <div className={styles.metrics}>
        {[
          ["设备", String(dashboard.devices.length), `${dashboard.readiness.onlineVerifiedDevices} 台在线且验真有效`],
          ["挂牌", String(dashboard.offers.length), `${dashboard.offers.filter((item) => item.status === "PUBLISHED").length} 条正在发布`],
          ["供应订单", String(supplierContracts.length), `${supplierContracts.filter((item) => ["READY", "IN_SERVICE", "AWAITING_ACCEPTANCE"].includes(item.status)).length} 笔服务中`],
          ["已归属租金", cardHours(dashboard.earnings.vestedMicros), `${cardHours(dashboard.earnings.pendingMicros)} KAI 待结算`],
        ].map(([label, value, note]) => (
          <div className={styles.metric} key={label}><span>{label}</span><strong>{value}</strong><small>{note}</small></div>
        ))}
      </div>

      <div className={styles.dashboardGrid}>
        <section className={styles.panel} aria-labelledby="readiness-title">
          <header className={styles.panelHeader}><h2 id="readiness-title">成交就绪状态</h2><span>关键项未就绪时保持关闭</span></header>
          <ul className={styles.readinessList}>
            {readiness.map(([label, ready]) => <li key={label}><span>{label}</span><strong className={ready ? styles.ready : styles.blocked}>{ready ? "READY" : "CLOSED"}</strong></li>)}
          </ul>
        </section>
        <section className={styles.panel} aria-labelledby="next-step-title">
          <header className={styles.panelHeader}><h2 id="next-step-title">下一步</h2><span>按状态推进</span></header>
          <div className={styles.nextStep}>
            <h3>{nextStep.title}</h3><p>{nextStep.description}</p>
            {nextStep.href
              ? <Link className={styles.primaryAction} href={nextStep.href}>{nextStep.label}</Link>
              : <span className={styles.statusBadge}>{nextStep.label}</span>}
          </div>
        </section>
      </div>

      <section className={styles.dataSection} aria-labelledby="devices-title">
        <header className={styles.panelHeader}><h2 id="devices-title">最近设备</h2><span>{dashboard.devices.length} 台</span></header>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead><tr><th>设备</th><th>GPU</th><th>Agent</th><th>验真</th><th>最后心跳</th></tr></thead>
            <tbody>
              {dashboard.devices.length ? dashboard.devices.slice(0, 5).map((device) => (
                <tr key={device.id}><td>{device.displayName}<br /><small>{shortId(device.id)}</small></td><td>{device.inventory.gpuModel}</td><td>{device.status}</td><td>{device.verificationStatus}</td><td>{dateTime(device.lastSeenAt)}</td></tr>
              )) : <tr><td className={styles.emptyRow} colSpan={5}>还没有登记设备。供应主体审核通过后才能生成 Agent 安装凭证。</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <section className={styles.dataSection} aria-labelledby="orders-title">
        <header className={styles.panelHeader}><h2 id="orders-title">最近供应订单</h2><span>{supplierContracts.length} 笔</span></header>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead><tr><th>合同</th><th>资源快照</th><th>预留时长</th><th>卡时锁定</th><th>状态</th></tr></thead>
            <tbody>
              {supplierContracts.length ? supplierContracts.slice(0, 5).map((contract) => (
                <tr key={contract.id}><td><Link href={`/supply/orders/${encodeURIComponent(contract.id)}`}>{shortId(contract.id)}</Link></td><td>{contract.snapshot.title}</td><td>{contract.reservedSeconds} 秒</td><td>{cardHours(contract.heldMicros)}</td><td>{contract.status}</td></tr>
              )) : <tr><td className={styles.emptyRow} colSpan={5}>还没有相关订单。发布通过验真的报价后，订单会在这里按状态推进。</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
