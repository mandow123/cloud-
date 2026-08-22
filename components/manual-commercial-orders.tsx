"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { adminGetRows } from "@/components/admin-api-client";
import { formatCardHourDisplayMicros } from "@/lib/card-hours";
import { createIdempotencyKey, MarketplaceApiError, marketplaceErrorMessage, marketplaceGet, marketplacePost } from "@/lib/client/marketplace-client";
import type { ManualCommercialOrderStatus, ManualCommercialOrderView, SupplierManualDeliveryTask } from "@/lib/server/admin-store";

type OrderPayload = Readonly<{ records?: ManualCommercialOrderView[] }>;
type DeliveryPayload = Readonly<{ records?: SupplierManualDeliveryTask[] }>;

const statusLabels: Record<ManualCommercialOrderStatus, string> = {
  OFFERED: "供应商已报价",
  CARD_HOURS_HELD: "卡时已锁定，等待准备",
  PREPARING: "供应商准备中",
  READY: "连接入口待确认",
  CONNECTION_CONFIRMED: "连接已确认，服务中",
  AWAITING_ACCEPTANCE: "服务结束，待最终验收",
  COMPLETED: "已验收，结算资格已生成",
  CANCELLED: "已取消",
};

function dateTime(value: string | null) {
  if (!value) return "待确认";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "待确认" : new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function money(cents: number | null) {
  return cents === null ? "—" : `¥${(cents / 100).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function parseCardHours(value: string) {
  const match = /^(\d{1,9})(?:\.(\d{1,2}))?$/u.exec(value.trim());
  if (!match) return null;
  const micros = Number(match[1]) * 1_000_000 + Number((match[2] ?? "").padEnd(2, "0")) * 10_000;
  return Number.isSafeInteger(micros) && micros > 0 ? micros : null;
}

function holdLabel(record: ManualCommercialOrderView) {
  if (record.hold.status === "NOT_HELD") return "尚未锁定卡时";
  if (record.hold.status === "HELD") return `已锁定 ${formatCardHourDisplayMicros(record.hold.heldMicros)} 卡时（HELD，暂未扣减）`;
  if (record.hold.status === "CAPTURED") return `实际扣减 ${formatCardHourDisplayMicros(record.hold.capturedMicros ?? 0)} 卡时；释放 ${formatCardHourDisplayMicros(record.hold.releasedMicros ?? 0)} 卡时`;
  return `已释放 ${formatCardHourDisplayMicros(record.hold.releasedMicros ?? record.hold.heldMicros)} 卡时`;
}

const sectionClass = "mt-8 border-t-4 border-[var(--accent)] bg-[var(--surface)] p-5 ring-1 ring-[var(--border)] sm:p-7";
const orderClass = "grid gap-4 border border-[var(--border)] bg-[var(--surface)] p-5 lg:grid-cols-[minmax(0,1fr)_minmax(16rem,.7fr)]";

export function MemberManualCommercialOrders({ demandId }: { demandId?: string }) {
  const [records, setRecords] = useState<ManualCommercialOrderView[] | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const load = useCallback(async () => {
    const payload = await marketplaceGet<OrderPayload>("/api/v1/member/manual-orders");
    const next = Array.isArray(payload.records) ? payload.records : [];
    setRecords(demandId ? next.filter((record) => record.demandId === demandId) : next);
  }, [demandId]);
  useEffect(() => { const frame = window.requestAnimationFrame(() => { void load().catch((reason: unknown) => setError(marketplaceErrorMessage(reason, "人工算力订单暂时无法读取。"))); }); return () => window.cancelAnimationFrame(frame); }, [load]);

  async function mutate(record: ManualCommercialOrderView, action: "accept-offer" | "confirm-connection" | "accept-completion") {
    setBusyId(record.id); setError(""); setNotice("");
    try {
      const result = await marketplacePost<ManualCommercialOrderView>(`/api/v1/member/manual-orders/${encodeURIComponent(record.id)}/${action}`, { expectedVersion: record.version }, createIdempotencyKey(`manual-order-${action}`));
      setRecords((current) => current?.map((item) => item.id === result.record.id ? result.record : item) ?? [result.record]);
      setConfirmingId(null);
      setNotice(action === "accept-offer" ? "卡时已由服务端锁定为 HELD；锁定不等于扣减。" : action === "confirm-connection" ? "连接可用确认已记录。" : "最终验收已记录；实际卡时已扣减，未使用部分已释放。 ");
    } catch (reason) {
      if (reason instanceof MarketplaceApiError && reason.status === 409) {
        await load().catch(() => undefined); setError("订单状态已经变化，已刷新最新版本，请重新确认。");
      } else setError(marketplaceErrorMessage(reason, action === "accept-offer" ? "卡时锁定失败。余额不足时请先充值卡时。" : "订单操作失败，请稍后重试。"));
    } finally { setBusyId(null); }
  }

  return <section className={sectionClass} aria-labelledby={demandId ? "member-manual-order-detail-title" : "member-manual-orders-title"}>
    <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="kicker">MANUAL COMPUTE ORDERS</p><h2 className="m-0 text-2xl" id={demandId ? "member-manual-order-detail-title" : "member-manual-orders-title"}>人工算力订单</h2><p className="mb-0 mt-2 text-sm text-[var(--muted)]">报价、卡时锁定、人工交付和最终验收均以服务端记录为准。</p></div><button className="button button-secondary" onClick={() => void load()} type="button">刷新订单</button></div>
    {error ? <p className="mt-5 border-l-4 border-[var(--error)] bg-[var(--error-bg)] p-4 text-[var(--error)]" role="alert">{error}</p> : null}
    {notice ? <p className="mt-5 border-l-4 border-[var(--success)] bg-[var(--success-bg)] p-4" role="status">{notice}</p> : null}
    {records === null ? <p className="mt-5 text-sm text-[var(--muted)]" role="status">正在读取人工订单…</p> : null}
    {records?.length === 0 ? <p className="mt-5 border border-[var(--border)] p-4 text-sm text-[var(--muted)]">当前申请尚未收到供应商正式报价。</p> : null}
    <div className="mt-5 grid gap-4">{records?.map((record) => <article className={orderClass} key={record.id}>
      <div><span className="font-mono text-xs text-[var(--muted)]">{record.id} · 报价版本 {record.quote.offerVersion}</span><h3 className="mb-0 mt-2 text-xl">{record.resource.title}</h3><p className="mb-0 mt-1 text-sm text-[var(--text)]">{record.resource.supplierName} · {record.resource.gpuDescription}</p><p className="mb-0 mt-3 text-sm">{record.quote.serviceSummary}</p><dl className="mt-4 grid gap-px bg-[var(--border)] sm:grid-cols-2"><div className="bg-[var(--info-bg)] p-3"><dt className="text-xs text-[var(--muted)]">正式报价</dt><dd className="m-0 mt-1 font-mono text-lg">{formatCardHourDisplayMicros(record.quote.quotedCardHourMicros)} 卡时</dd></div><div className="bg-[var(--info-bg)] p-3"><dt className="text-xs text-[var(--muted)]">卡时状态</dt><dd className="m-0 mt-1 text-sm font-semibold">{holdLabel(record)}</dd></div><div className="bg-[var(--info-bg)] p-3"><dt className="text-xs text-[var(--muted)]">预计交付</dt><dd className="m-0 mt-1 text-sm">{dateTime(record.quote.expectedDeliveryAt)}</dd></div><div className="bg-[var(--info-bg)] p-3"><dt className="text-xs text-[var(--muted)]">订单状态</dt><dd className="m-0 mt-1 text-sm font-semibold">{statusLabels[record.status]}</dd></div></dl></div>
      <div className="border-l-2 border-[var(--accent)] bg-[var(--info-bg)] p-4">
        {record.status === "OFFERED" ? <>{confirmingId !== record.id ? <button className="button button-primary w-full" onClick={() => setConfirmingId(record.id)} type="button">查看并确认锁定</button> : <div><strong>再次确认锁定卡时</strong><p className="text-sm">将锁定 {formatCardHourDisplayMicros(record.quote.quotedCardHourMicros)} 卡时。HELD 只是冻结额度，尚未扣减；最终验收后才按实际用量扣减。</p><button className="button button-primary w-full" disabled={busyId === record.id} onClick={() => void mutate(record, "accept-offer")} type="button">{busyId === record.id ? "锁定中…" : "确认报价并锁定卡时"}</button><button className="button button-secondary mt-2 w-full" onClick={() => setConfirmingId(null)} type="button">暂不锁定</button></div>}<Link className="mt-3 block text-center text-sm font-semibold text-[var(--accent)]" href="/member/card-hours">余额不足？前往我的资产充值卡时</Link></> : null}
        {record.status === "CARD_HOURS_HELD" ? <p className="m-0 text-sm"><strong>额度已锁定，尚未扣减。</strong><br />供应商现在可以开始准备资源。</p> : null}
        {record.status === "PREPARING" ? <p className="m-0 text-sm">供应商正在准备人工交付，请等待连接入口。</p> : null}
        {record.status === "READY" && record.delivery.connection ? <div><strong>核对连接入口</strong><dl className="mt-3 grid gap-2 text-sm"><div><dt>主机</dt><dd className="m-0 font-mono">{record.delivery.connection.host}</dd></div><div><dt>端口 / 用户</dt><dd className="m-0 font-mono">{record.delivery.connection.port} / {record.delivery.connection.username}</dd></div><div><dt>Host Key 指纹</dt><dd className="m-0 break-all font-mono">{record.delivery.connection.hostKeyFingerprint}</dd></div></dl><button className="button button-primary mt-4 w-full" disabled={busyId === record.id} onClick={() => void mutate(record, "confirm-connection")} type="button">{busyId === record.id ? "确认中…" : "连接可用，确认开始服务"}</button></div> : null}
        {record.status === "CONNECTION_CONFIRMED" ? <p className="m-0 text-sm">连接已确认，当前处于服务中。卡时仍是 HELD，尚未扣减。</p> : null}
        {record.status === "AWAITING_ACCEPTANCE" ? <div><strong>供应商已标记服务结束</strong><p className="text-sm">实际用量 {formatCardHourDisplayMicros(record.quote.actualCardHourMicros ?? 0)} 卡时。最终验收后扣减实际用量并释放剩余额度。</p><button className="button button-primary w-full" disabled={busyId === record.id} onClick={() => void mutate(record, "accept-completion")} type="button">{busyId === record.id ? "验收中…" : "最终验收并确认扣减"}</button><Link className="mt-3 block text-center text-sm font-semibold text-[var(--error)]" href={`/member/purchases/${encodeURIComponent(record.demandId)}#member-appeal-title`}>交付有问题？发起申诉</Link></div> : null}
        {record.status === "COMPLETED" ? <p className="m-0 text-sm"><strong>订单已完成。</strong><br />{holdLabel(record)}</p> : null}
        {record.status === "CANCELLED" ? <p className="m-0 text-sm">订单已取消，不会继续交付或扣减卡时。</p> : null}
      </div>
    </article>)}</div>
  </section>;
}

export function SupplierManualCommercialOrders() {
  const [records, setRecords] = useState<ManualCommercialOrderView[] | null>(null);
  const [deliveries, setDeliveries] = useState<SupplierManualDeliveryTask[]>([]);
  const [demandId, setDemandId] = useState(""); const [quote, setQuote] = useState(""); const [summary, setSummary] = useState(""); const [expectedAt, setExpectedAt] = useState("");
  const [actualByOrder, setActualByOrder] = useState<Record<string, string>>({}); const [busy, setBusy] = useState<string | null>(null); const [error, setError] = useState(""); const [notice, setNotice] = useState("");
  const load = useCallback(async () => {
    const [ordersPayload, deliveriesPayload] = await Promise.all([marketplaceGet<OrderPayload>("/api/v1/supply/manual-orders"), marketplaceGet<DeliveryPayload>("/api/v1/supply/manual-deliveries")]);
    setRecords(Array.isArray(ordersPayload.records) ? ordersPayload.records : []); setDeliveries(Array.isArray(deliveriesPayload.records) ? deliveriesPayload.records : []);
  }, []);
  useEffect(() => { const frame = window.requestAnimationFrame(() => { void load().catch((reason: unknown) => setError(marketplaceErrorMessage(reason, "人工订单暂时无法读取。"))); }); return () => window.cancelAnimationFrame(frame); }, [load]);
  const candidates = useMemo(() => deliveries.filter((item) => ["SUPPLIER_ASSIGNED", "DELIVERY_IN_PROGRESS"].includes(item.status) && !records?.some((order) => order.demandId === item.demandId)), [deliveries, records]);
  const selectedDelivery = candidates.find((item) => item.demandId === demandId);

  async function createOffer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const quotedCardHourMicros = parseCardHours(quote); if (!selectedDelivery || !quotedCardHourMicros) return;
    setBusy("create"); setError(""); setNotice("");
    try {
      const result = await marketplacePost<ManualCommercialOrderView>("/api/v1/supply/manual-orders", { demandId, quotedCardHourMicros, serviceSummary: summary.trim(), expectedDeliveryAt: expectedAt ? new Date(expectedAt).toISOString() : undefined, expectedDeliveryStatusVersion: selectedDelivery.statusVersion }, createIdempotencyKey("manual-order-offer"));
      setRecords((current) => [result.record, ...(current ?? [])]); setDemandId(""); setQuote(""); setSummary(""); setExpectedAt(""); setNotice("正式报价版本已保存，等待买家确认并锁定卡时。");
    } catch (reason) { if (reason instanceof MarketplaceApiError && reason.status === 409) { await load().catch(() => undefined); setError("交付任务已经变化，已刷新最新版本，请重新报价。"); } else setError(marketplaceErrorMessage(reason, "报价提交失败。")); } finally { setBusy(null); }
  }

  async function mutate(record: ManualCommercialOrderView, action: "prepare" | "ready" | "service-complete") {
    const actualCardHourMicros = action === "service-complete" ? parseCardHours(actualByOrder[record.id] ?? "") : null;
    if (action === "service-complete" && (!actualCardHourMicros || actualCardHourMicros > record.hold.heldMicros)) { setError("实际卡时必须为两位以内小数，且不能超过已锁定卡时。"); return; }
    setBusy(record.id); setError(""); setNotice("");
    try {
      const result = await marketplacePost<ManualCommercialOrderView>(`/api/v1/supply/manual-orders/${encodeURIComponent(record.id)}/${action}`, { expectedVersion: record.version, ...(actualCardHourMicros ? { actualCardHourMicros } : {}) }, createIdempotencyKey(`manual-order-${action}`));
      setRecords((current) => current?.map((item) => item.id === result.record.id ? result.record : item) ?? [result.record]); setNotice("订单履约状态已更新。");
    } catch (reason) { if (reason instanceof MarketplaceApiError && reason.status === 409) { await load().catch(() => undefined); setError("订单状态已经变化，已刷新最新版本，请重新确认。"); } else setError(marketplaceErrorMessage(reason, "履约状态更新失败。")); } finally { setBusy(null); }
  }

  return <section className={sectionClass} aria-labelledby="supplier-manual-orders-title"><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="kicker">MANUAL ORDER FULFILLMENT</p><h2 className="m-0 text-2xl" id="supplier-manual-orders-title">人工算力订单</h2><p className="mb-0 mt-2 text-sm text-[var(--muted)]">先报价，买家锁定卡时后再准备交付。HELD 不等于已扣减。</p></div><button className="button button-secondary" onClick={() => void load()} type="button">刷新订单</button></div>
    {candidates.length ? <form className="mt-5 grid gap-4 border border-[var(--border)] bg-[var(--info-bg)] p-4 md:grid-cols-2" onSubmit={createOffer}><label className="grid gap-2 text-sm font-semibold">待报价需求<select className="min-h-11 border border-[var(--border-strong)] bg-[var(--surface)] p-2" required value={demandId} onChange={(event) => setDemandId(event.target.value)}><option value="">请选择</option>{candidates.map((item) => <option key={item.demandId} value={item.demandId}>{item.demandId} · {item.resource.title}</option>)}</select></label><label className="grid gap-2 text-sm font-semibold">正式报价（卡时）<input className="min-h-11 border border-[var(--border-strong)] bg-[var(--surface)] p-2" inputMode="decimal" placeholder="例如 4896.00" required value={quote} onChange={(event) => setQuote(event.target.value)} /></label><label className="grid gap-2 text-sm font-semibold md:col-span-2">服务与交付说明<textarea className="min-h-24 border border-[var(--border-strong)] bg-[var(--surface)] p-2" maxLength={2000} minLength={10} required value={summary} onChange={(event) => setSummary(event.target.value)} /></label><label className="grid gap-2 text-sm font-semibold">预计交付时间（可选）<input className="min-h-11 border border-[var(--border-strong)] bg-[var(--surface)] p-2" type="datetime-local" value={expectedAt} onChange={(event) => setExpectedAt(event.target.value)} /></label><button className="button button-primary self-end" disabled={busy === "create" || !selectedDelivery || !parseCardHours(quote) || summary.trim().length < 10} type="submit">{busy === "create" ? "提交中…" : "提交正式卡时报价"}</button></form> : null}
    {error ? <p className="mt-5 border-l-4 border-[var(--error)] bg-[var(--error-bg)] p-4 text-[var(--error)]" role="alert">{error}</p> : null}{notice ? <p className="mt-5 border-l-4 border-[var(--success)] bg-[var(--success-bg)] p-4" role="status">{notice}</p> : null}
    <div className="mt-5 grid gap-4">{records?.map((record) => <article className={orderClass} key={record.id}><div><span className="font-mono text-xs text-[var(--muted)]">{record.id} · {record.demandId} · 报价版本 {record.quote.offerVersion}</span><h3 className="mb-0 mt-2 text-xl">{record.resource.title}</h3><p className="mb-0 mt-1 text-sm">{statusLabels[record.status]}</p><dl className="mt-4 grid gap-2 text-sm"><div><dt>报价</dt><dd className="m-0 font-mono">{formatCardHourDisplayMicros(record.quote.quotedCardHourMicros)} 卡时</dd></div><div><dt>资金状态</dt><dd className="m-0 font-semibold">{holdLabel(record)}</dd></div><div><dt>交付说明</dt><dd className="m-0">{record.quote.serviceSummary}</dd></div></dl>{record.settlement.status === "ELIGIBLE" ? <div className="mt-4 border-l-4 border-[var(--success)] bg-[var(--success-bg)] p-4"><strong>供应商人民币结算应收：{money(record.settlement.supplierReceivableCnyCents)}</strong><p className="mb-0 mt-1 text-sm">平台费 {record.settlement.platformFeeBps === null ? "—" : `${(record.settlement.platformFeeBps / 100).toFixed(2)}%`} · 真实出款 CLOSED，当前不可发起提现或打款。</p></div> : null}</div><div className="border-l-2 border-[var(--accent)] bg-[var(--info-bg)] p-4">{record.status === "OFFERED" ? <p className="m-0 text-sm">等待买家确认报价并锁定卡时；此时不得开始交付。</p> : null}{record.status === "CARD_HOURS_HELD" ? <button className="button button-primary w-full" disabled={busy === record.id} onClick={() => void mutate(record, "prepare")} type="button">开始准备资源</button> : null}{record.status === "PREPARING" ? <div><p className="text-sm">先由现有人工交付流程保存授权连接入口，再标记可连接。</p><button className="button button-primary w-full" disabled={busy === record.id} onClick={() => void mutate(record, "ready")} type="button">连接入口已就绪</button></div> : null}{record.status === "READY" ? <p className="m-0 text-sm">等待买家确认连接可用。</p> : null}{record.status === "CONNECTION_CONFIRMED" ? <div><label className="grid gap-2 text-sm font-semibold">实际服务卡时<input className="min-h-11 border border-[var(--border-strong)] bg-[var(--surface)] p-2" inputMode="decimal" placeholder={formatCardHourDisplayMicros(record.hold.heldMicros)} value={actualByOrder[record.id] ?? ""} onChange={(event) => setActualByOrder((current) => ({ ...current, [record.id]: event.target.value }))} /></label><button className="button button-primary mt-3 w-full" disabled={busy === record.id || !parseCardHours(actualByOrder[record.id] ?? "")} onClick={() => void mutate(record, "service-complete")} type="button">标记服务结束</button></div> : null}{record.status === "AWAITING_ACCEPTANCE" ? <p className="m-0 text-sm">等待买家最终验收。验收前卡时仍未扣减，供应商尚无结算资格。</p> : null}{record.status === "COMPLETED" ? <p className="m-0 text-sm">买家已验收，实际卡时已扣减并生成结算资格；真实出款仍关闭。</p> : null}</div></article>)}</div>
  </section>;
}

export function AdminManualCommercialOrders() {
  const [records, setRecords] = useState<ManualCommercialOrderView[] | null>(null); const [error, setError] = useState<unknown>(null);
  const load = useCallback(async () => { setError(null); try { setRecords(await adminGetRows({ path: "/api/v1/admin/manual-orders" }) as unknown as ManualCommercialOrderView[]); } catch (reason) { setError(reason); } }, []);
  useEffect(() => { const frame = window.requestAnimationFrame(() => { void load(); }); return () => window.cancelAnimationFrame(frame); }, [load]);
  const visible = records?.filter((record) => record.status === "CANCELLED" || record.settlement.status === "ELIGIBLE") ?? [];
  return <section className="admin-manual-delivery" aria-labelledby="admin-manual-orders-title"><div className="admin-manual-delivery-head"><div><p className="admin-kicker">Manual order oversight</p><h2 id="admin-manual-orders-title">人工订单异常与结算资格</h2><span>只读视图；管理员不能在这里伪造 HELD、扣减、结算或真实出款状态。</span></div><button className="admin-button secondary" onClick={() => void load()} type="button">刷新状态</button></div>{error ? <p className="admin-inline-warning" role="alert">人工订单监督数据暂时无法读取。</p> : null}{records === null ? <p role="status">正在读取订单监督数据…</p> : null}{records !== null && visible.length === 0 ? <p className="admin-inline-warning">当前没有取消异常或已生成的供应商结算资格。</p> : null}{visible.length ? <div className="admin-table-wrap"><table className="admin-table"><caption>人工订单异常和结算资格</caption><thead><tr><th>订单</th><th>需求</th><th>状态</th><th>卡时事实</th><th>结算资格</th><th>真实出款</th></tr></thead><tbody>{visible.map((record) => <tr key={record.id}><td className="admin-mono">{record.id}</td><td className="admin-mono">{record.demandId}</td><td>{statusLabels[record.status]}</td><td>{holdLabel(record)}</td><td>{record.settlement.status === "ELIGIBLE" ? "已生成" : "未生成"}</td><td><span className="admin-status danger">CLOSED</span></td></tr>)}</tbody></table></div> : null}</section>;
}
