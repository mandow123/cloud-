"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { marketplaceErrorMessage } from "@/lib/client/marketplace-client";
import { formatCardHourDisplayMicros } from "@/lib/card-hours";
import {
  createCardHourPaymentIntent,
  getSupplyOrder,
  submitSshPublicKey,
} from "@/components/supply-api-client";
import type { SupplyOrderDetail } from "@/components/supply-api-client";

function money(cents: number) {
  return `¥${(cents / 100).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function dateTime(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString("zh-CN") : "尚未生成";
}

export function SupplyOrderWorkspace({ orderId, role }: { orderId: string; role: "buyer" | "supplier" }) {
  const [detail, setDetail] = useState<SupplyOrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionBusy, setActionBusy] = useState(false);
  const [publicKey, setPublicKey] = useState("");
  const [actionNotice, setActionNotice] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setDetail(await getSupplyOrder(orderId, role));
    } catch (loadError) {
      setError(marketplaceErrorMessage(loadError, "暂时无法读取该供应订单。"));
    } finally {
      setLoading(false);
    }
  }, [orderId, role]);

  useEffect(() => {
    let cancelled = false;
    void getSupplyOrder(orderId, role)
      .then((record) => { if (!cancelled) setDetail(record); })
      .catch((loadError: unknown) => {
        if (!cancelled) setError(marketplaceErrorMessage(loadError, "暂时无法读取该供应订单。"));
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [orderId, role]);

  if (loading && !detail) return <div className="shell py-14"><p className="border-l-2 border-[var(--accent)] pl-4" role="status">正在读取服务端订单…</p></div>;
  if (error && !detail) return <div className="shell py-14"><div className="border-l-4 border-[var(--error)] bg-[var(--error-bg)] p-5 text-[var(--error)]" role="alert">{error}</div></div>;
  if (!detail) return null;

  const { order, allocation, payment, delivery } = detail;
  const latestConnection = [...detail.connectionChecks].sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
  const exactPilotShape = order.gpuCount === 8 && order.unitPriceMicrosPerGpuHour === 1_000_000 && order.durationHours <= 8;
  const readiness = detail.paymentReadiness;
  const cardHourReady = Boolean(
    readiness?.ready
      && readiness.environment.toUpperCase() === "LIVE"
      && readiness.provider === "KAI_CARD_HOUR",
  );
  const cardHourPayment = Boolean(payment?.provider === "KAI_CARD_HOUR");
  const sshReady = Boolean(detail.sshReadiness?.ready);

  async function startPayment() {
    setActionBusy(true);
    setError("");
    setActionNotice("");
    try {
      const intent = await createCardHourPaymentIntent(order.id);
      setActionNotice(`已扣减 ${formatCardHourDisplayMicros(intent.amountMicros)} 卡时，订单支付状态已由服务端确认。`);
      await load();
    } catch (actionError) {
      setError(marketplaceErrorMessage(actionError, "无法完成卡时支付，请检查余额后重试。"));
    } finally {
      setActionBusy(false);
    }
  }

  async function registerPublicKey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setActionBusy(true);
    setError("");
    setActionNotice("");
    try {
      const result = await submitSshPublicKey(order.id, publicKey.trim());
      setActionNotice(`SSH 公钥已登记；主机指纹 ${result.hostKeyFingerprint}。请在受控入口领取短期连接信息。`);
      setPublicKey("");
      await load();
    } catch (actionError) {
      setError(marketplaceErrorMessage(actionError, "SSH 公钥登记失败，请检查格式或稍后重试。"));
    } finally {
      setActionBusy(false);
    }
  }

  return (
    <div className="shell py-10 sm:py-14">
      <section className="border-t-4 border-[var(--accent)] bg-[var(--surface)] p-6 ring-1 ring-[var(--border)] sm:p-8" aria-labelledby="supply-order-title">
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div>
            <p className="kicker">Supply order · {order.id}</p>
            <h2 className="m-0 text-3xl" id="supply-order-title">{order.status}</h2>
            <p className="mb-0 mt-2 text-sm text-[var(--text)]">容量状态：{allocation.status} · 交付状态：{delivery?.status ?? "尚未生成"}</p>
          </div>
          <div className="text-right"><span className="block text-xs text-[var(--muted)]">订单金额</span><strong className="font-mono text-3xl text-[var(--ink)]">{money(order.amountCents)}</strong></div>
        </div>

        {error ? <div className="mt-5 border-l-4 border-[var(--error)] bg-[var(--error-bg)] p-4 text-[var(--error)]" role="alert">{error}</div> : null}
        {actionNotice ? <div className="mt-5 border-l-4 border-[var(--success)] bg-[var(--success-bg)] p-4" role="status">{actionNotice}</div> : null}
        {!exactPilotShape ? (
          <div className="mt-6 border-l-4 border-[var(--error)] bg-[var(--error-bg)] p-5 text-[var(--error)]">
            <strong>订单不符合 H100 试运行规则</strong>
            <p className="mb-0">试运行固定为整机 8 卡、¥1 / 卡时，且单笔最长 8 小时；本页不会提供支付或交付动作。</p>
          </div>
        ) : null}
        {!cardHourReady || (payment !== null && !cardHourPayment) ? (
          <div className="mt-6 border-l-4 border-[var(--warning)] bg-[var(--warning-bg)] p-5">
            <strong className="text-[var(--ink)]">真实支付阻断</strong>
            <p className="mb-0">订单详情未证明卡时结算服务可用，或本订单已绑定其他支付方式。本页不会调用测试支付，也不会把模拟状态展示为真实成交。</p>
            {readiness?.blockers.length ? <p className="mb-0 mt-2 text-sm">阻断原因：{readiness.blockers.join("；")}</p> : null}
          </div>
        ) : null}

        {role === "buyer" && order.status === "PAYMENT_PENDING" ? (
          <section className="mt-7 border border-[var(--border)] bg-[var(--surface)] p-5" aria-labelledby="card-hour-checkout-title">
            <p className="kicker">Buyer action</p>
            <h3 className="mb-0 mt-2 text-xl" id="card-hour-checkout-title">卡时支付</h3>
            <p className="mb-0 mt-2 text-sm text-[var(--text)]">人民币仅作参考价 {money(order.amountCents)}；服务端按 1 卡时 = ¥1.002 换算并从当前交易主体余额扣减。</p>
            <button className="button button-primary mt-5 rounded-none" disabled={!cardHourReady || !exactPilotShape || actionBusy} onClick={() => void startPayment()} type="button">
              {actionBusy ? "正在扣减卡时…" : "确认使用卡时支付"}
            </button>
            {!cardHourReady ? <p className="mb-0 mt-3 text-sm text-[var(--warning)]">卡时结算服务未就绪，支付按钮保持关闭。</p> : null}
          </section>
        ) : null}

        {role === "buyer" && order.status === "PAID" && delivery?.status === "AWAITING_KEY" ? (
          <form className="mt-7 border border-[var(--border)] bg-[var(--surface)] p-5" onSubmit={registerPublicKey}>
            <p className="kicker">Buyer action</p>
            <h3 className="mb-0 mt-2 text-xl">提交 SSH 公钥</h3>
            <label className="mt-5 block font-semibold" htmlFor="supply-ssh-public-key">OpenSSH 公钥</label>
            <textarea
              className="mt-2 min-h-32 w-full border border-[var(--border)] bg-[var(--canvas)] p-3 font-mono text-sm text-[var(--ink)]"
              id="supply-ssh-public-key"
              onChange={(event) => setPublicKey(event.target.value)}
              placeholder="ssh-ed25519 AAAA… user@device"
              required
              value={publicKey}
            />
            <p className="mt-2 text-sm text-[var(--muted)]">只提交公钥；私钥不得上传。真实 IP、用户名和凭据不会写入本页。</p>
            <button className="button button-primary mt-3" disabled={!sshReady || actionBusy || publicKey.trim().length < 32} type="submit">
              {actionBusy ? "正在登记…" : "登记公钥并准备交付"}
            </button>
            {!sshReady ? <p className="mb-0 mt-3 text-sm text-[var(--warning)]">SSH Provisioner 未配置，公钥提交保持关闭。</p> : null}
          </form>
        ) : null}

        {role === "supplier" ? (
          <div className="mt-7 border-l-4 border-[var(--accent)] bg-[var(--info-bg)] p-4 text-sm">
            当前为供应方只读视图。买方支付和公钥提交只在买方订单会话中显示。
          </div>
        ) : null}

        <dl className="mt-7 grid gap-px bg-[var(--border)] sm:grid-cols-2 lg:grid-cols-4">
          <div className="bg-[var(--info-bg)] p-5"><dt>购买卡数</dt><dd className="m-0 mt-1 text-2xl font-semibold text-[var(--ink)]">{order.gpuCount} 卡</dd></div>
          <div className="bg-[var(--info-bg)] p-5"><dt>服务时长</dt><dd className="m-0 mt-1 text-2xl font-semibold text-[var(--ink)]">{order.durationHours} 小时</dd></div>
          <div className="bg-[var(--info-bg)] p-5"><dt>卡时单价</dt><dd className="m-0 mt-1 text-2xl font-semibold text-[var(--ink)]">¥{(order.unitPriceMicrosPerGpuHour / 1_000_000).toLocaleString("zh-CN")}</dd></div>
          <div className="bg-[var(--info-bg)] p-5"><dt>支付状态</dt><dd className="m-0 mt-1 font-semibold text-[var(--ink)]">{payment ? `${payment.provider} / ${payment.status}` : "尚未创建"}</dd></div>
        </dl>

        <section className="mt-7 border border-[var(--border)]" aria-labelledby="order-timeline-title">
          <div className="border-b border-[var(--border)] p-5"><h3 className="m-0 text-xl" id="order-timeline-title">订单事实</h3></div>
          <dl className="grid gap-px bg-[var(--border)] sm:grid-cols-2">
            <div className="bg-[var(--surface)] p-5"><dt>开始时间</dt><dd className="m-0 font-semibold text-[var(--ink)]">{dateTime(order.startAt)}</dd></div>
            <div className="bg-[var(--surface)] p-5"><dt>结束时间</dt><dd className="m-0 font-semibold text-[var(--ink)]">{dateTime(order.endAt)}</dd></div>
            <div className="bg-[var(--surface)] p-5"><dt>待支付有效期</dt><dd className="m-0 font-semibold text-[var(--ink)]">{dateTime(order.expiresAt)}</dd></div>
            <div className="bg-[var(--surface)] p-5"><dt>SSH 交付</dt><dd className="m-0 font-semibold text-[var(--ink)]">{delivery?.status ?? "尚未生成交付任务"}</dd></div>
            <div className="bg-[var(--surface)] p-5"><dt>凭据有效期</dt><dd className="m-0 font-semibold text-[var(--ink)]">{dateTime(delivery?.credentialExpiresAt)}</dd></div>
            <div className="bg-[var(--surface)] p-5"><dt>最近连接检查</dt><dd className="m-0 font-semibold text-[var(--ink)]">{latestConnection ? `${latestConnection.status} / ${latestConnection.diagnosticCode}` : "尚未执行"}</dd></div>
          </dl>
        </section>

        <div className="mt-7 flex flex-wrap gap-3">
          <button className="button button-secondary" disabled={loading} onClick={() => void load()} type="button">{loading ? "正在刷新…" : "刷新订单"}</button>
          <Link className="button button-secondary" href="/supply/listings">返回上架计划</Link>
        </div>
      </section>
    </div>
  );
}
