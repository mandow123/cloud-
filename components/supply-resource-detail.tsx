"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { HostingAgentCommand, HostingDevice } from "@/lib/hosting-v2";
import type { SupplierHostingDashboard } from "@/lib/hosting-v2-client";
import { createIdempotencyKey, marketplaceErrorMessage, marketplaceGet, marketplacePost } from "@/lib/client/marketplace-client";
import styles from "./supply-console.module.css";

function dateTime(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "medium" }).format(date);
}

function digest(value: string) {
  return value.length > 28 ? `${value.slice(0, 14)}…${value.slice(-10)}` : value;
}

export function SupplyResourceDetail({ deviceId }: { deviceId: string }) {
  const [device, setDevice] = useState<HostingDevice | null>(null);
  const [found, setFound] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const verifyKey = useRef<string | null>(null);

  const load = useCallback(async () => {
    try {
      const result = await marketplaceGet<{ dashboard: SupplierHostingDashboard }>("/api/v2/supply/dashboard");
      const current = result.dashboard.devices.find((item) => item.id === deviceId) ?? null;
      setDevice(current); setFound(Boolean(current));
    } catch (cause) {
      setMessage({ kind: "error", text: marketplaceErrorMessage(cause, "设备详情暂时无法读取。") });
      setFound(false);
    }
  }, [deviceId]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => { void load(); });
    return () => window.cancelAnimationFrame(frame);
  }, [load]);

  async function queueVerification() {
    if (!device) return;
    setBusy(true); setMessage(null);
    try {
      verifyKey.current ??= createIdempotencyKey("device-verify");
      const result = await marketplacePost<HostingAgentCommand>(`/api/v2/supply/devices/${encodeURIComponent(device.id)}/verify`, {}, verifyKey.current);
      verifyKey.current = null;
      setMessage({ kind: "success", text: `验真任务 ${result.record.id} 已进入队列。Agent 领取后会运行受控测试。` });
      await load();
    } catch (cause) {
      setMessage({ kind: "error", text: marketplaceErrorMessage(cause, "验真任务创建失败。") });
    } finally {
      setBusy(false);
    }
  }

  if (found === null) return <div className={styles.loading} role="status">正在读取设备、硬件证据和验真状态…</div>;
  if (!device) return <section className={styles.error} role="alert"><h2>没有找到这台设备</h2><p>设备不存在，或它不属于当前登录组织。</p><Link className={`${styles.secondaryAction} mt-4`} href="/supply/resources">返回资源列表</Link></section>;

  const inventory = device.inventory;
  const canVerify = ["ONLINE", "VERIFIED"].includes(device.status) && !busy;

  return (
    <>
      <div className={styles.pageHeading}>
        <div><h1>{device.displayName}</h1><p>{device.id} · 所有硬件字段来自设备签名清单，不接受网页手工改写。</p></div>
        <div className={styles.actionRow}><Link className={styles.secondaryAction} href="/supply/resources">返回资源列表</Link><button className={styles.actionButton} disabled={!canVerify} onClick={() => void queueVerification()} type="button">{busy ? "正在创建…" : "重新验真"}</button></div>
      </div>

      {message ? <div className={`${styles.message} ${message.kind === "error" ? styles.messageError : ""}`} role={message.kind === "error" ? "alert" : "status"}>{message.text}</div> : null}

      <div className={styles.detailGrid}>
        <div className={styles.detailStack}>
          <section className={styles.panel} aria-labelledby="inventory-title">
            <header className={styles.panelHeader}><h2 id="inventory-title">签名硬件清单</h2><span>{digest(device.inventoryDigest)}</span></header>
            <dl className={styles.inventoryGrid}>
              {[
                ["GPU 型号", inventory.gpuModel], ["GPU 显存", `${inventory.gpuMemoryMiB} MiB`], ["GPU UUID 摘要", digest(inventory.gpuUuidDigest)],
                ["驱动", inventory.driverVersion], ["CUDA", inventory.cudaVersion], ["CPU", inventory.cpuModel],
                ["内存", `${inventory.memoryMiB} MiB`], ["存储", `${inventory.storageGiB} GiB`], ["主机摘要", digest(inventory.hostnameDigest)],
                ["公网主机", inventory.publicHost], ["SSH 端口范围", `${inventory.sshPortStart}–${inventory.sshPortEnd}`], ["Agent 版本", device.agentVersion],
              ].map(([term, value]) => <div key={term}><dt>{term}</dt><dd>{value}</dd></div>)}
            </dl>
          </section>

          <section className={styles.panel} aria-labelledby="verification-title">
            <header className={styles.panelHeader}><h2 id="verification-title">验真与证据</h2><span>{device.verificationStatus}</span></header>
            <ul className={styles.timeline}>
              <li><span>设备状态</span><strong>{device.status}</strong></li>
              <li><span>验真状态</span><strong>{device.verificationStatus}</strong></li>
              <li><span>证据摘要</span><strong>{device.verificationEvidenceDigest ? digest(device.verificationEvidenceDigest) : "尚未生成"}</strong></li>
              <li><span>有效期</span><strong>{dateTime(device.verifiedUntil)}</strong></li>
              <li><span>最后心跳</span><strong>{dateTime(device.lastSeenAt)}</strong></li>
              <li><span>防重放序列</span><strong>{device.lastSequence}</strong></li>
            </ul>
          </section>
        </div>

        <aside className={styles.sidePanel}>
          <section><h2>验真测试</h2><ul><li>GPU 型号与 UUID</li><li>CUDA 受控冒烟测试</li><li>显存、内存与存储</li><li>批准镜像 RepoDigest</li><li>网络和公网端口可达性</li></ul></section>
          <section><h3>自动暂停条件</h3><ul><li>Agent 心跳超过阈值</li><li>硬件清单摘要变化</li><li>验真证据过期</li><li>清理失败进入 DRAINING</li></ul></section>
          <section><h3>当前限制</h3><p>首期仅支持单卡、非 MIG、单租户容器。设备通过验真并保持在线后，下一步才可创建报价。</p></section>
        </aside>
      </div>
    </>
  );
}
