"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useLocale } from "@/components/locale-provider";
import { formatCardHourDisplayMicros } from "@/lib/card-hours";
import { createIdempotencyKey, MarketplaceApiError, marketplacePost, safeMarketplaceErrorMessage } from "@/lib/client/marketplace-client";
import type { Locale } from "@/lib/i18n";
import type { ManualDeliveryStatus, MemberCatalogPurchaseIntent } from "@/lib/server/admin-store";
import styles from "@/components/member-purchase-intents.module.css";
import { MemberManualAppeals } from "@/components/member-manual-appeals";

type ListPayload = { records?: MemberCatalogPurchaseIntent[] };
type DetailPayload = { record?: MemberCatalogPurchaseIntent };

type PurchaseErrorCopy = { load: string; confirm: string; requestId: string; retry: (seconds: number) => string };
const PURCHASE_ERROR_COPY = {
  "zh-CN": { load: "算力申请暂时无法读取。", confirm: "确认交付失败，请刷新状态后重试。", requestId: "请求编号", retry: (seconds) => `可在 ${seconds} 秒后重试。` },
  "zh-TW": { load: "目前無法讀取算力申請。", confirm: "確認交付失敗，請重新整理狀態後再試。", requestId: "請求編號", retry: (seconds) => `可於 ${seconds} 秒後重試。` },
  en: { load: "Compute requests cannot be loaded right now.", confirm: "Delivery could not be confirmed. Refresh the status and try again.", requestId: "Request ID", retry: (seconds) => `Try again in ${seconds} seconds.` },
  ja: { load: "現在、コンピュート申請を読み込めません。", confirm: "納品を確認できませんでした。状態を更新して再試行してください。", requestId: "リクエスト ID", retry: (seconds) => `${seconds} 秒後に再試行できます。` },
  ko: { load: "현재 컴퓨팅 신청을 불러올 수 없습니다.", confirm: "제공을 확인하지 못했습니다. 상태를 새로고침한 후 다시 시도하세요.", requestId: "요청 ID", retry: (seconds) => `${seconds}초 후 다시 시도하세요.` },
  fr: { load: "Les demandes de calcul sont momentanément indisponibles.", confirm: "La livraison n’a pas pu être confirmée. Actualisez l’état et réessayez.", requestId: "ID de requête", retry: (seconds) => `Réessayez dans ${seconds} secondes.` },
  th: { load: "ยังไม่สามารถโหลดคำขอประมวลผลได้", confirm: "ยืนยันการส่งมอบไม่สำเร็จ โปรดรีเฟรชสถานะแล้วลองใหม่", requestId: "รหัสคำขอ", retry: (seconds) => `ลองอีกครั้งใน ${seconds} วินาที` },
  vi: { load: "Hiện không thể tải yêu cầu điện toán.", confirm: "Không thể xác nhận bàn giao. Hãy làm mới trạng thái và thử lại.", requestId: "ID yêu cầu", retry: (seconds) => `Thử lại sau ${seconds} giây.` },
  id: { load: "Permintaan komputasi belum dapat dimuat.", confirm: "Penyerahan gagal dikonfirmasi. Muat ulang status dan coba lagi.", requestId: "ID permintaan", retry: (seconds) => `Coba lagi dalam ${seconds} detik.` },
  ms: { load: "Permintaan pengkomputeran belum dapat dimuatkan.", confirm: "Penyerahan gagal disahkan. Muat semula status dan cuba lagi.", requestId: "ID permintaan", retry: (seconds) => `Cuba lagi dalam ${seconds} saat.` },
} satisfies Record<Locale, PurchaseErrorCopy>;

function dateTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

const STATUS_LABELS: Record<ManualDeliveryStatus, string> = {
  PENDING_MANUAL_DELIVERY: "等待平台人工确认与交付", SUPPLIER_ASSIGNED: "平台已分配供应商", DELIVERY_IN_PROGRESS: "供应商配置中",
  AWAITING_BUYER_ACCEPTANCE: "连接信息已交付，待确认", COMPLETED: "交付已确认", CANCELLED: "申请已取消", ACCESS_REVOKED: "访问已撤销",
};
function statusLabel(status: ManualDeliveryStatus) { return STATUS_LABELS[status]; }
function nextStep(status: ManualDeliveryStatus) {
  if (status === "PENDING_MANUAL_DELIVERY") return "平台确认正式卡时报价并分配供应商";
  if (status === "SUPPLIER_ASSIGNED") return "等待供应商核对库存并开始配置";
  if (status === "DELIVERY_IN_PROGRESS") return "供应商完成 SSH 配置并由平台交付连接入口";
  if (status === "AWAITING_BUYER_ACCEPTANCE") return "请核对连接入口；连接可用后确认交付";
  if (status === "COMPLETED") return "交付已完成；请按约定使用资源";
  if (status === "ACCESS_REVOKED") return "连接入口已撤销，如有疑问请联系平台";
  return "此申请已终止，不会继续交付";
}

async function loadJson<T>(path: string): Promise<T> {
  const response = await fetch(path, { credentials: "same-origin", cache: "no-store" });
  const payload = await response.json().catch(() => null) as { error?: { code?: string; requestId?: string } } | null;
  if (!response.ok) throw new MarketplaceApiError({ code: payload?.error?.code ?? `HTTP_${response.status}`, message: "REQUEST_FAILED", requestId: payload?.error?.requestId, status: response.status });
  if (!payload) throw new MarketplaceApiError({ code: "INVALID_RESPONSE", message: "INVALID_RESPONSE", status: response.status });
  return payload as T;
}

export function MemberPurchaseIntentList({ compact = false }: { compact?: boolean }) {
  const { locale } = useLocale();
  const errorCopy = PURCHASE_ERROR_COPY[locale];
  const [records, setRecords] = useState<MemberCatalogPurchaseIntent[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    loadJson<ListPayload>("/api/v1/member/purchase-intents")
      .then((payload) => { if (!cancelled) setRecords(Array.isArray(payload.records) ? payload.records : []); })
      .catch((reason: unknown) => { if (!cancelled) setError(safeMarketplaceErrorMessage(reason, errorCopy.load, { requestIdLabel: errorCopy.requestId, retryAfter: errorCopy.retry })); });
    return () => { cancelled = true; };
  }, [errorCopy]);
  const visible = compact ? records?.slice(0, 3) : records;
  return <section className={styles.section} aria-labelledby={compact ? "member-compute-title" : "member-purchases-title"}>
    <div className={styles.head}>
      <div><p className={styles.eyebrow}>My compute requests</p><h2 id={compact ? "member-compute-title" : "member-purchases-title"}>{compact ? "我的算力申请" : "算力申请记录"}</h2><p className={styles.meta}>只显示当前交易主体提交的资源快照和人工交付进度。</p></div>
      {compact ? <Link className="button button-secondary" href="/member/purchases">查看全部</Link> : <Link className="button button-primary" href="/buy">继续选择算力</Link>}
    </div>
    {error ? <p className={styles.error} role="alert">{error}</p> : null}
    {!error && records === null ? <p className={styles.empty} role="status">正在读取算力申请…</p> : null}
    {!error && records?.length === 0 ? <div className={styles.empty}><strong>还没有算力申请</strong><p>从 GPU 套餐中选择资源并提交询价后，完整快照会保存在这里。</p><Link href="/buy">查看 GPU 套餐 →</Link></div> : null}
    {visible?.length ? <div className={styles.grid}>{visible.map((record) => <article className={styles.card} key={record.demandId}>
      <div><div className={styles.identity}>{record.resource.supplierLogoUrl ? <Image className={styles.logo} alt={record.resource.supplierName} height={40} src={record.resource.supplierLogoUrl} width={40} /> : null}<div><span className={styles.eyebrow}>{record.demandId}</span><h3 className={styles.title}>{record.resource.title}</h3><p className={styles.meta}>{record.resource.supplierName}</p></div></div></div>
      <div><span className={styles.status}>{statusLabel(record.status)}</span><p className={styles.meta}>{record.request.quantity} 套 · 共 {record.request.totalGpuCount} 张 GPU</p></div>
      <div className={styles.amount}>{formatCardHourDisplayMicros(record.pricing.estimatedCardHourMicros)} 卡时<small>询价参考 · 尚未扣卡时</small></div>
      <Link className="button button-primary" href={`/member/purchases/${encodeURIComponent(record.demandId)}`}>查看详情</Link>
    </article>)}</div> : null}
  </section>;
}

export function MemberPurchaseIntentDetail({ demandId, appealsEnabled = false, orderFlowEnabled = false }: { demandId: string; appealsEnabled?: boolean; orderFlowEnabled?: boolean }) {
  const { locale } = useLocale();
  const errorCopy = PURCHASE_ERROR_COPY[locale];
  const [record, setRecord] = useState<MemberCatalogPurchaseIntent | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [acceptanceNote, setAcceptanceNote] = useState("");
  const [confirming, setConfirming] = useState(false);
  useEffect(() => {
    let cancelled = false;
    loadJson<DetailPayload>(`/api/v1/member/purchase-intents/${encodeURIComponent(demandId)}`)
      .then((payload) => { if (!cancelled && payload.record) setRecord(payload.record); })
      .catch((reason: unknown) => { if (!cancelled) setError(safeMarketplaceErrorMessage(reason, errorCopy.load, { requestIdLabel: errorCopy.requestId, retryAfter: errorCopy.retry })); });
    return () => { cancelled = true; };
  }, [demandId, errorCopy]);
  async function confirmDelivery() {
    if (!record || record.status !== "AWAITING_BUYER_ACCEPTANCE") return;
    setConfirming(true); setError(""); setNotice("");
    try {
      const result = await marketplacePost<MemberCatalogPurchaseIntent>(`/api/v1/member/purchase-intents/${encodeURIComponent(record.demandId)}/confirm-delivery`, { expectedVersion: record.statusVersion, note: acceptanceNote.trim() || undefined }, createIdempotencyKey("confirm-manual-delivery"));
      setRecord(result.record); setNotice("交付已确认。平台已记录你的确认时间和当前状态版本。 ");
    } catch (reason) { setError(safeMarketplaceErrorMessage(reason, errorCopy.confirm, { requestIdLabel: errorCopy.requestId, retryAfter: errorCopy.retry })); }
    finally { setConfirming(false); }
  }
  async function copyConnection() {
    if (!record?.connection) return;
    await navigator.clipboard.writeText(`ssh -p ${record.connection.port} ${record.connection.username}@${record.connection.host}`);
    setNotice("SSH 连接命令已复制。请使用你提交公钥时对应的私钥连接。 ");
  }
  if (error) return <div className={`shell ${styles.detail}`}><Link className={styles.back} href="/member/purchases">← 返回算力申请</Link><p className={styles.error} role="alert">{error}</p></div>;
  if (!record) return <div className={`shell ${styles.detail}`}><p className={styles.empty} role="status">正在读取算力详情…</p></div>;
  return <div className={`shell ${styles.detail}`}>
    <Link className={styles.back} href="/member/purchases">← 返回算力申请</Link>
    <header className={styles.hero}>
      <div><p className={styles.eyebrow}>Compute request detail · {record.demandId}</p><h1>{record.resource.title}</h1><div className={styles.identity}>{record.resource.supplierLogoUrl ? <Image className={styles.logo} alt={record.resource.supplierName} height={40} src={record.resource.supplierLogoUrl} width={40} /> : null}<strong>{record.resource.supplierName}</strong></div></div>
      <span className={styles.status}>{statusLabel(record.status)}</span>
    </header>
    <p className={styles.warning}>{orderFlowEnabled ? "这是提交时冻结的询价快照。正式报价、卡时锁定、服务验收和实际扣减以页面下方的人工算力订单为准；平台不会自动操作供应商机器。" : "这是提交时冻结的询价快照：尚未锁定库存、尚未付款、尚未扣卡时，也不会自动操作供应商机器。人工交付后由你核对连接入口并确认；本页不代表已付款或已成交。"}</p>
    <div className={styles.detailGrid}>
      <section className={styles.panel}><h2>申请范围</h2><dl className={styles.facts}>
        <div><dt>套餐数量</dt><dd>{record.request.quantity} 套</dd></div><div><dt>GPU 总数</dt><dd>{record.request.totalGpuCount} 张</dd></div><div><dt>GPU 规格</dt><dd>{record.resource.gpuDescription}</dd></div><div><dt>租用时长</dt><dd>{record.request.durationHours ? `${record.request.durationHours} 小时` : "按正式方案确认"}</dd></div><div><dt>期望交付日</dt><dd>{record.request.deliveryDate ?? "待确认"}</dd></div><div><dt>提交时间</dt><dd>{dateTime(record.createdAt)}</dd></div>
      </dl></section>
      <section className={styles.panel}><h2>卡时参考</h2><dl className={styles.facts}>
        <div><dt>参考单价</dt><dd>{formatCardHourDisplayMicros(record.pricing.unitCardHourMicros)} KAI 标准卡时 / 套·小时</dd></div><div><dt>预计总计</dt><dd>{formatCardHourDisplayMicros(record.pricing.estimatedCardHourMicros)} KAI 标准卡时</dd></div><div><dt>资金状态</dt><dd>尚未扣卡时</dd></div><div><dt>价格口径</dt><dd>以人工确认后的正式报价为准</dd></div>
      </dl></section>
      <section className={styles.panel}><h2>资源与交付</h2><dl className={styles.facts}>
        <div><dt>服务范围</dt><dd>{record.resource.region}</dd></div><div><dt>交付形态</dt><dd>{record.resource.deliveryForm}</dd></div><div><dt>交付时效</dt><dd>{record.resource.deliveryLeadTime}</dd></div><div><dt>容量状态</dt><dd>{record.resource.capacity}</dd></div><div><dt>服务说明</dt><dd>{record.resource.sla}</dd></div><div><dt>SSH 公钥指纹</dt><dd className={styles.fingerprint}>{record.sshPublicKeyFingerprint ?? "此申请未收集 SSH 公钥"}</dd></div>
      </dl></section>
      <section className={styles.panel}><h2>人工交付进度</h2><dl className={styles.facts}>
        <div><dt>当前状态</dt><dd>{statusLabel(record.status)}</dd></div><div><dt>下一步</dt><dd>{nextStep(record.status)}</dd></div><div><dt>平台完成分配</dt><dd>{record.deliveryTimeline.assignedAt ? dateTime(record.deliveryTimeline.assignedAt) : "待分配"}</dd></div><div><dt>开始配置</dt><dd>{record.deliveryTimeline.startedAt ? dateTime(record.deliveryTimeline.startedAt) : "尚未开始"}</dd></div><div><dt>连接入口交付</dt><dd>{record.deliveryTimeline.deliveredAt ? dateTime(record.deliveryTimeline.deliveredAt) : "尚未交付"}</dd></div><div><dt>买家确认</dt><dd>{record.deliveryTimeline.completedAt ? dateTime(record.deliveryTimeline.completedAt) : "尚未确认"}</dd></div>
      </dl>{record.buyerVisibleNote ? <p className={styles.deliveryNote}><strong>平台交付说明</strong>{record.buyerVisibleNote}</p> : null}</section>
      {record.connection && ["AWAITING_BUYER_ACCEPTANCE", "COMPLETED"].includes(record.status) ? <section className={`${styles.panel} ${styles.connectionPanel}`}><h2>SSH 连接入口</h2><p className={styles.meta}>平台仅展示结构化主机入口，不保存或展示你的私钥。请使用提交公钥时对应的本地私钥。</p><dl className={styles.facts}><div><dt>主机</dt><dd className={styles.fingerprint}>{record.connection.host}</dd></div><div><dt>端口</dt><dd>{record.connection.port}</dd></div><div><dt>用户名</dt><dd>{record.connection.username}</dd></div><div><dt>Host Key 指纹</dt><dd className={styles.fingerprint}>{record.connection.hostKeyFingerprint}</dd></div></dl><code className={styles.command}>ssh -p {record.connection.port} {record.connection.username}@{record.connection.host}</code><button className="button button-secondary" onClick={() => void copyConnection()} type="button">复制 SSH 命令</button>{record.status === "AWAITING_BUYER_ACCEPTANCE" && !orderFlowEnabled ? <div className={styles.acceptance}><label htmlFor="delivery-acceptance-note">确认备注（可选）</label><textarea id="delivery-acceptance-note" maxLength={1000} value={acceptanceNote} onChange={(event) => setAcceptanceNote(event.target.value)} placeholder="例如：已成功连接并核对 GPU 规格" /><button className="button button-primary" disabled={confirming} onClick={() => void confirmDelivery()} type="button">{confirming ? "确认中…" : "连接可用，确认交付"}</button></div> : record.status === "COMPLETED" ? <p className={styles.success} role="status">你已完成最终验收。</p> : <p className={styles.meta}>请在下方人工算力订单中确认连接可用；卡时在最终验收前保持锁定。</p>}</section> : null}
      {record.status === "ACCESS_REVOKED" ? <section className={`${styles.panel} ${styles.revoked}`}><h2>访问已撤销</h2><p>原连接入口不再可用，页面不会继续展示 SSH 主机信息。</p></section> : null}
      <section className={`${styles.panel} ${styles.wide}`}><h2>提交时资源规格</h2><dl className={styles.specs}>{Object.entries(record.resource.specs).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>{record.resource.sourceNotice ? <p className={styles.meta}>{record.resource.sourceNotice}</p> : null}</section>
      {appealsEnabled ? <MemberManualAppeals demandId={record.demandId} /> : null}
    </div>
    {notice ? <p className={styles.success} role="status">{notice}</p> : null}
  </div>;
}
