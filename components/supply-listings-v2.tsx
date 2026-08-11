"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createIdempotencyKey, marketplaceErrorMessage, marketplaceGet, marketplacePost } from "@/lib/client/marketplace-client";
import type { SupplierHostingDashboard, SupplierHostingOffer } from "@/lib/hosting-v2-client";
import { formatCardHours, formatHostingTime } from "@/lib/hosting-v2-client";
import styles from "./supply-console.module.css";

const STATUS_LABELS: Record<SupplierHostingOffer["status"], string> = {
  DRAFT: "草稿",
  PUBLISHED: "公开可租",
  RESERVED: "已被预留",
  PAUSED: "已暂停",
  UNLISTED: "已下架",
  SUSPENDED: "风控暂停",
};

export function SupplyListingsV2() {
  const [offers, setOffers] = useState<SupplierHostingOffer[] | null>(null);
  const [dashboard, setDashboard] = useState<SupplierHostingDashboard | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requestKeys = useRef<Record<string, string>>({});

  const load = useCallback(async () => {
    setError(null);
    try {
      const [offerResult, dashboardResult] = await Promise.all([
        marketplaceGet<{ records: SupplierHostingOffer[] }>("/api/v2/supply/offers"),
        marketplaceGet<{ dashboard: SupplierHostingDashboard }>("/api/v2/supply/dashboard"),
      ]);
      setOffers(offerResult.records);
      setDashboard(dashboardResult.dashboard);
    } catch (cause) {
      setError(marketplaceErrorMessage(cause, "挂牌列表暂时无法读取。"));
    }
  }, []);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => { void load(); });
    return () => window.cancelAnimationFrame(frame);
  }, [load]);

  const devices = useMemo(() => new Map((dashboard?.devices ?? []).map((device) => [device.id, device])), [dashboard]);

  async function changeStatus(offer: SupplierHostingOffer, status: "PUBLISHED" | "PAUSED" | "UNLISTED") {
    const actionId = `${offer.id}:${status}:${offer.version}`;
    if (busyId) return;
    setBusyId(actionId); setError(null);
    try {
      requestKeys.current[actionId] ??= createIdempotencyKey("supply-offer-status");
      const result = await marketplacePost<SupplierHostingOffer>(`/api/v2/supply/offers/${encodeURIComponent(offer.id)}/status`, { status, expectedVersion: offer.version }, requestKeys.current[actionId]);
      delete requestKeys.current[actionId];
      setOffers((current) => current?.map((item) => item.id === offer.id ? result.record : item) ?? null);
    } catch (cause) {
      setError(marketplaceErrorMessage(cause, "挂牌状态没有更新，请刷新后重试。"));
    } finally { setBusyId(null); }
  }

  return (
    <>
      <div className={styles.pageHeading}>
        <div><h1>挂牌管理</h1><p>价格、设备、镜像、可用窗口和费率版本在成交时冻结；已成交合同不受后续挂牌操作影响。</p></div>
        <Link className={styles.primaryAction} href="/supply/listings/new">创建 GPU 挂牌</Link>
      </div>

      {error ? <div className={`${styles.message} ${styles.messageError}`} role="alert">{error}</div> : null}
      {!offers || !dashboard ? <div className={styles.loading} role="status">正在读取挂牌、设备和公开状态…</div> : (
        <section className={styles.dataSection} aria-labelledby="listings-title">
          <header className={styles.panelHeader}><h2 id="listings-title">GPU 报价</h2><span>{offers.length} 条</span></header>
          <div className={styles.tableWrap}>
            <table className={`${styles.table} ${styles.wideTable}`}>
              <thead><tr><th>报价</th><th>设备</th><th>卡时价格</th><th>租用范围</th><th>可用截止</th><th>状态</th><th>操作</th></tr></thead>
              <tbody>
                {offers.length ? offers.map((offer) => {
                  const device = devices.get(offer.deviceId);
                  const actionBusy = busyId?.startsWith(`${offer.id}:`) ?? false;
                  return (
                    <tr key={offer.id}>
                      <td><strong>{offer.title}</strong><br /><small>{offer.gpuModel} · {offer.region}<br />v{offer.version} · {offer.id}</small></td>
                      <td>{device?.displayName ?? offer.deviceId}<br /><small>{device ? `${device.status} / ${device.verificationStatus}` : "设备记录不可见"}</small></td>
                      <td><strong>{formatCardHours(offer.cardHourMicrosPerGpuHour)}</strong><br /><small>KAI / GPU 小时</small></td>
                      <td>{Math.ceil(offer.minRentalSeconds / 60)}–{Math.floor(offer.maxRentalSeconds / 60)} 分钟</td>
                      <td>{formatHostingTime(offer.availableUntil)}</td>
                      <td><span className={styles.statusBadge}>{STATUS_LABELS[offer.status]}</span></td>
                      <td>
                        <div className={styles.tableActions}>
                          {offer.status === "DRAFT" || offer.status === "PAUSED" ? <button disabled={actionBusy} onClick={() => void changeStatus(offer, "PUBLISHED")} type="button">发布</button> : null}
                          {offer.status === "PUBLISHED" ? <button disabled={actionBusy} onClick={() => void changeStatus(offer, "PAUSED")} type="button">暂停</button> : null}
                          {["DRAFT", "PUBLISHED", "PAUSED", "SUSPENDED"].includes(offer.status) ? <button className={styles.tableDanger} disabled={actionBusy} onClick={() => void changeStatus(offer, "UNLISTED")} type="button">下架</button> : null}
                          {offer.status === "RESERVED" ? <Link href="/supply/orders">查看订单</Link> : null}
                        </div>
                      </td>
                    </tr>
                  );
                }) : <tr><td className={styles.emptyRow} colSpan={7}>尚无 GPU 挂牌。先让设备在线并通过验真，再创建第一条真实报价。</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}
