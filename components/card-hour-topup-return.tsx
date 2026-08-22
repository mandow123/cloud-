"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { formatCardHourDisplayMicros } from "@/lib/card-hours";
import { createIdempotencyKey, marketplaceErrorMessage, marketplacePost } from "@/lib/client/marketplace-client";
import styles from "./member-card-hour-assets.module.css";

type PaymentChannel = "ALIPAY" | "WXPAY";
type TopupStatus = "PROCESSING" | "PENDING" | "CAPTURED" | "CLOSED" | "RECONCILIATION_REQUIRED";
type TopupDetail = {
  id: string;
  channel: PaymentChannel;
  status: TopupStatus;
  credited: boolean;
  cardHourMicros: number;
  amountCents: number;
  currency: "CNY";
  expiresAt: string;
  appealEligibility: { canAppeal: boolean; retryAt: string | null };
};

const channelLabels: Record<PaymentChannel, string> = { ALIPAY: "支付宝", WXPAY: "微信支付" };

function money(cents: number) {
  return new Intl.NumberFormat("zh-CN", { style: "currency", currency: "CNY" }).format(cents / 100);
}
function dateTime(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(date); }

export function CardHourTopupReturn({ orderId }: { orderId: string }) {
  const [record, setRecord] = useState<TopupDetail | null>(null);
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(true);
  const pollCount = useRef(0);

  const check = useCallback(async (signal?: AbortSignal) => {
    setError("");
    const response = await fetch(`/api/v1/member/card-hours/topups/${encodeURIComponent(orderId)}`, { credentials: "same-origin", cache: "no-store", signal });
    const payload = await response.json().catch(() => null) as { record?: TopupDetail; error?: { message?: string } } | null;
    if (!response.ok || !payload?.record) throw new Error(payload?.error?.message ?? "付款单状态暂时无法读取。");
    setRecord(payload.record);
    return payload.record;
  }, [orderId]);

  const reconcile = useCallback(async () => {
    setError("");
    const payload = await marketplacePost<TopupDetail, { record: TopupDetail; reconciled: boolean; replayed: boolean }>(
      `/api/v1/member/card-hours/topups/${encodeURIComponent(orderId)}`,
      {},
      createIdempotencyKey(`card-hour-reconcile-${orderId}`),
      12_000,
    );
    setRecord(payload.record);
    return payload.record;
  }, [orderId]);

  useEffect(() => {
    const controller = new AbortController();
    let timer: number | undefined;
    let cancelled = false;
    const poll = async () => {
      try {
        let current: TopupDetail;
        if (pollCount.current % 10 === 0) {
          try { current = await reconcile(); }
          catch { current = await check(controller.signal); }
        } else current = await check(controller.signal);
        if (cancelled || (current.status === "CAPTURED" && current.credited) || current.status === "CLOSED") {
          setChecking(false);
          return;
        }
        pollCount.current += 1;
        if (pollCount.current >= 40) {
          setChecking(false);
          return;
        }
        timer = window.setTimeout(poll, 3_000);
      } catch (reason) {
        if (cancelled || (reason instanceof DOMException && reason.name === "AbortError")) return;
        setError(reason instanceof Error ? reason.message : "付款单状态暂时无法读取。");
        setChecking(false);
      }
    };
    void poll();
    return () => { cancelled = true; controller.abort(); if (timer) window.clearTimeout(timer); };
  }, [check, reconcile]);

  const credited = record?.status === "CAPTURED" && record.credited === true;
  const closed = record?.status === "CLOSED";
  const reconciliationRequired = record?.status === "RECONCILIATION_REQUIRED";
  const title = credited ? "卡时已到账" : closed ? "付款单已关闭" : reconciliationRequired ? "支付结果待人工核对" : record?.status === "PROCESSING" ? "付款单创建中" : "正在等待支付确认";
  const detail = credited
    ? "平台服务端已经确认支付结果并完成卡时入账。"
    : closed
      ? "该付款单未完成入账。如已扣款，请保留支付凭证并联系平台人工核对。"
      : reconciliationRequired
        ? "平台正在按限频规则主动核对支付结果。请勿重复付款，也不要重新发起充值；核对完成后会更新本页状态。"
      : "从支付页面返回不代表付款成功。平台正在等待可信支付通知，你可以留在本页等待自动更新。";

  return (
    <div className={styles.returnPage}>
      <section className={styles.returnPanel} aria-live="polite">
        <p className={styles.eyebrow}>PAYMENT STATUS</p><h1>{title}</h1><p>{detail}</p>
        {record ? <dl className={styles.returnFacts}><div><dt>付款单</dt><dd>{record.id}</dd></div><div><dt>支付方式</dt><dd>{channelLabels[record.channel]}</dd></div><div><dt>购买卡时</dt><dd>{formatCardHourDisplayMicros(record.cardHourMicros)}</dd></div><div><dt>支付金额</dt><dd>{money(record.amountCents)}</dd></div><div><dt>服务端状态</dt><dd>{credited ? "已确认并入账" : closed ? "已关闭" : reconciliationRequired ? "待人工核对" : "处理中"}</dd></div></dl> : null}
        {checking && !credited && !closed ? <p className={styles.notice} role="status">正在通过平台服务端核对支付结果，不读取浏览器回跳参数作为成功依据…</p> : null}
        {reconciliationRequired ? <p className={styles.notice} role="status">支付结果尚未确认，平台会继续受控核对；请勿重复付款或重新发起充值。</p> : null}
        {error ? <p className={styles.error} role="alert">{error}</p> : null}
        {!checking && !credited && !closed ? <p className={styles.notice}>支付结果仍未确认。延迟并不等于失败，也不会因此自动入账。</p> : null}
        <div className={styles.actions}>
          {!checking && !credited && !closed ? <button className={styles.primaryAction} onClick={() => { setChecking(true); pollCount.current = 0; void reconcile().then(() => setChecking(false)).catch((reason: unknown) => { setError(marketplaceErrorMessage(reason, reason instanceof Error ? reason.message : "支付结果暂时无法核对。")); setChecking(false); }); }} type="button">重新核对支付结果</button> : null}
          {!credited && record?.appealEligibility.canAppeal ? <Link className={styles.secondaryAction} href={`/member/card-hours/topups/${encodeURIComponent(orderId)}/appeal`}>充值遇到问题／发起申诉</Link> : null}
          <Link className={styles.secondaryAction} href="/member/card-hours">返回我的资产</Link>
        </div>
        {!credited && record?.appealEligibility.retryAt && !record.appealEligibility.canAppeal ? <p className={styles.notice}>支付仍在正常确认时间内；如届时仍未更新，可于 {dateTime(record.appealEligibility.retryAt)} 后发起申诉。</p> : null}
      </section>
    </div>
  );
}
