"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { HOSTING_V2_AGENT_STALE_SECONDS } from "@/lib/hosting-v2";
import { createIdempotencyKey, marketplaceErrorMessage, marketplaceGet, marketplacePost } from "@/lib/client/marketplace-client";
import type { SupplierHostingDashboard, SupplierHostingOffer, SupplierHostingPolicy } from "@/lib/hosting-v2-client";
import { formatCardHours, formatHostingTime } from "@/lib/hosting-v2-client";
import styles from "./supply-console.module.css";

function localDateTime(date: Date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function decimalMicros(value: string) {
  const match = /^(\d{1,9})(?:\.(\d{1,6}))?$/u.exec(value.trim());
  if (!match) return null;
  const micros = Number(match[1]) * 1_000_000 + Number((match[2] ?? "").padEnd(6, "0"));
  return Number.isSafeInteger(micros) && micros > 0 ? micros : null;
}

const FEE_TIER_LABELS: Record<string, string> = {
  STARTER: "起步档",
  GROWTH: "成长档",
  SCALE: "规模档",
  VOLUME: "大客户档",
  STRATEGIC: "战略档",
};

function formatBasisPoints(value: number | null) {
  if (value === null || !Number.isInteger(value) || value < 0) return "未配置";
  return `${Math.floor(value / 100)}.${String(value % 100).padStart(2, "0")}%`;
}

function eligibleHostingDevice(device: SupplierHostingDashboard["devices"][number], now: number) {
  return device.status === "VERIFIED"
    && device.verificationStatus === "PASSED"
    && Boolean(device.verifiedUntil && Date.parse(device.verifiedUntil) > now)
    && Boolean(device.lastSeenAt && Date.parse(device.lastSeenAt) >= now - HOSTING_V2_AGENT_STALE_SECONDS * 1_000);
}

export function SupplyOfferCreate() {
  const router = useRouter();
  const [dashboard, setDashboard] = useState<SupplierHostingDashboard | null>(null);
  const [policy, setPolicy] = useState<SupplierHostingPolicy | null>(null);
  const [deviceId, setDeviceId] = useState("");
  const [title, setTitle] = useState("");
  const [region, setRegion] = useState("");
  const [rate, setRate] = useState("3.6");
  const [minimumMinutes, setMinimumMinutes] = useState("3");
  const [maximumMinutes, setMaximumMinutes] = useState("60");
  const [availableFrom, setAvailableFrom] = useState("");
  const [availableUntil, setAvailableUntil] = useState("");
  const [approvedImage, setApprovedImage] = useState("");
  const [eligibilityNow, setEligibilityNow] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = useRef<{ payload: string; key: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      marketplaceGet<{ dashboard: SupplierHostingDashboard }>("/api/v2/supply/dashboard"),
      marketplaceGet<{ policy: SupplierHostingPolicy }>("/api/v2/supply/policy"),
    ]).then(([dashboardResult, policyResult]) => {
      if (cancelled) return;
      const loadedAt = Date.now();
      // Allow an operator to publish immediately while covering sub-minute
      // client/server clock skew. The server still validates the full window.
      const start = new Date(Date.now() - 60_000);
      setAvailableFrom((current) => current || localDateTime(start));
      setAvailableUntil((current) => current || localDateTime(new Date(start.getTime() + 24 * 60 * 60_000)));
      setDashboard(dashboardResult.dashboard);
      setPolicy(policyResult.policy);
      const eligible = dashboardResult.dashboard.devices.find((device) => eligibleHostingDevice(device, loadedAt));
      setEligibilityNow(loadedAt);
      if (eligible) { setDeviceId(eligible.id); setTitle(`${eligible.inventory.gpuModel === "RTX_4090" ? "RTX 4090" : "H100 80GB"} 单卡独享`); }
      setApprovedImage(policyResult.policy.approvedImages[0] ?? "");
    }).catch((cause) => { if (!cancelled) setError(marketplaceErrorMessage(cause, "挂牌策略或设备状态暂时无法读取。")); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const interval = window.setInterval(() => setEligibilityNow(Date.now()), 30_000);
    return () => window.clearInterval(interval);
  }, []);

  const eligibleDevices = (dashboard?.devices ?? []).filter((device) => eligibleHostingDevice(device, eligibilityNow));
  const selectedDevice = eligibleDevices.find((device) => device.id === deviceId) ?? null;
  const rateMicros = decimalMicros(rate);
  const minMinutes = Number(minimumMinutes);
  const maxMinutes = Number(maximumMinutes);
  const formReady = Boolean(
    dashboard?.readiness.supplierApproved
    && selectedDevice
    && policy
    && approvedImage
    && rateMicros
    && title.trim().length >= 3
    && region.trim().length >= 2
    && Number.isSafeInteger(minMinutes) && minMinutes >= 3
    && Number.isSafeInteger(maxMinutes) && maxMinutes >= minMinutes
    && new Date(availableUntil).getTime() > new Date(availableFrom).getTime(),
  );

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!formReady || !selectedDevice || rateMicros === null) return;
    const payload = {
      deviceId: selectedDevice.id,
      title: title.trim(),
      region: region.trim(),
      cardHourMicrosPerGpuHour: rateMicros,
      minRentalSeconds: minMinutes * 60,
      maxRentalSeconds: maxMinutes * 60,
      availableFrom: new Date(availableFrom).toISOString(),
      availableUntil: new Date(availableUntil).toISOString(),
      approvedImage,
    };
    const serialized = JSON.stringify(payload);
    if (!request.current || request.current.payload !== serialized) request.current = { payload: serialized, key: createIdempotencyKey("supply-offer") };
    setBusy(true); setError(null);
    try {
      await marketplacePost<SupplierHostingOffer>("/api/v2/supply/offers", payload, request.current.key, 20_000);
      request.current = null;
      router.push("/supply/listings");
    } catch (cause) {
      setError(marketplaceErrorMessage(cause, "挂牌草稿没有创建，请核对验真和费率状态。"));
    } finally { setBusy(false); }
  }

  return (
    <>
      <div className={styles.pageHeading}>
        <div><h1>创建 GPU 挂牌</h1><p>网页只提交报价选择；GPU 型号、供应主体、协议版本和费率版本由服务端确定。</p></div>
        <Link className={styles.secondaryAction} href="/supply/listings">返回挂牌管理</Link>
      </div>
      {error ? <div className={`${styles.message} ${styles.messageError}`} role="alert">{error}</div> : null}
      {!dashboard && !error ? <div className={styles.loading} role="status">正在读取验真设备和平台交付策略…</div> : null}

      {dashboard ? <div className={styles.formLayout}>
        <form className={styles.formPanel} onSubmit={submit}>
          <div className={styles.fieldGrid}>
            <label className={`${styles.field} ${styles.fieldFull}`}><span>验真设备</span><select onChange={(event) => setDeviceId(event.target.value)} required value={deviceId}><option value="">选择在线且验真有效的设备</option>{eligibleDevices.map((device) => <option key={device.id} value={device.id}>{device.displayName} · {device.inventory.gpuModel}</option>)}</select><small>设备规格来自签名清单，浏览器不能更改 GPU 型号。</small></label>
            <label className={styles.field}><span>挂牌标题</span><input maxLength={120} minLength={3} onChange={(event) => setTitle(event.target.value)} required value={title} /></label>
            <label className={styles.field}><span>资源区域</span><input maxLength={80} minLength={2} onChange={(event) => setRegion(event.target.value)} placeholder="中国·北京" required value={region} /></label>
            <label className={styles.field}><span>KAI 标准卡时 / GPU 小时</span><input inputMode="decimal" onChange={(event) => setRate(event.target.value)} pattern="\d{1,9}(\.\d{1,6})?" required value={rate} /><small>最多 6 位小数；人民币只按 1 卡时 = ¥1.002 显示参考。</small></label>
            <label className={styles.field}><span>最低租用分钟</span><input min={3} onChange={(event) => setMinimumMinutes(event.target.value)} step={1} type="number" value={minimumMinutes} /></label>
            <label className={styles.field}><span>最长租用分钟</span><input max={44640} min={3} onChange={(event) => setMaximumMinutes(event.target.value)} step={1} type="number" value={maximumMinutes} /></label>
            <label className={styles.field}><span>可用开始</span><input onChange={(event) => setAvailableFrom(event.target.value)} type="datetime-local" value={availableFrom} /><small>默认立即生效，并预留 1 分钟处理客户端与服务端时钟偏差。</small></label>
            <label className={styles.field}><span>可用结束</span><input onChange={(event) => setAvailableUntil(event.target.value)} type="datetime-local" value={availableUntil} /></label>
            <label className={`${styles.field} ${styles.fieldFull}`}><span>平台批准的交付镜像</span><select onChange={(event) => setApprovedImage(event.target.value)} required value={approvedImage}>{policy?.approvedImages.map((image) => <option key={image} value={image}>{image}</option>)}</select><small>仅允许不可变 sha256 镜像；不能填写自定义镜像或 latest 标签。</small></label>
          </div>
          {policy ? <div className={styles.feeStrip} aria-label="当前供应服务费档位">
            <strong>本月服务费 {formatBasisPoints(policy.feePreview.platformFeeBps)} · {policy.feePreview.tierCode ? (FEE_TIER_LABELS[policy.feePreview.tierCode] ?? policy.feePreview.tierCode) : "尚未生效"}</strong>
            <span>上月合格成交 {formatCardHours(policy.feePreview.qualifyingVolumeMicros)} KAI</span>
            <small>{policy.feePreview.period.key} 的已结算、未退款毛额决定本月档位，下次于 {formatHostingTime(policy.feePreview.nextRecalculationAt)} 重算。推荐佣金包含在本笔服务费内，不会再次向供应方或买家加收。</small>
          </div> : null}
          <div className={styles.agreement}><input checked readOnly type="checkbox" /><span>本次挂牌使用服务端协议 <strong>{policy?.termsVersion ?? "未就绪"}</strong>。发布前仍会再次检查供应资格、Agent 心跳、验真有效期和平台费率。</span></div>
          <div className={styles.formActions}><button className={styles.saveButton} disabled={!formReady || busy} type="submit">{busy ? "正在创建草稿…" : "创建挂牌草稿"}</button></div>
        </form>
        <aside className={styles.sidePanel}>
          <section><h2>成交快照</h2><p>买家预留时冻结设备规格、卡时价格、镜像、可用窗口、供应协议和平台费率版本。</p></section>
          <section><h3>发布前置条件</h3><ul><li>供应主体已审核</li><li>Agent 在线且验真有效</li><li>有效平台费率存在</li><li>不可变镜像在批准清单中</li></ul></section>
          <section><h3>当前设备</h3><p>{selectedDevice ? `${selectedDevice.inventory.gpuModel} · ${selectedDevice.inventory.gpuMemoryMiB} MiB · Agent ${selectedDevice.agentVersion}` : "没有可挂牌的验真设备"}</p></section>
        </aside>
      </div> : null}
    </>
  );
}
