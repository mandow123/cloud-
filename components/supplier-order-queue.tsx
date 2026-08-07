"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ExchangeOrder } from "@/lib/exchange";
import {
  createIdempotencyKey,
  exchangeGet,
  exchangePost,
  MarketplaceApiError,
  marketplaceErrorMessage,
} from "@/lib/client/marketplace-client";
import { capacityDisplay, formatCapacityHours, formatRateUnits } from "@/lib/capacity-display";

type ListResponse<T> = { items: T[]; count: number };

function localDate(hours: number) {
  const date = new Date(Date.now() + hours * 60 * 60 * 1_000);
  return localDateValue(date);
}

function localDateValue(date: Date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60 * 1_000);
  return local.toISOString().slice(0, 16);
}

function mayHaveReachedServer(error: unknown) {
  return error instanceof MarketplaceApiError && ["NETWORK_ERROR", "REQUEST_TIMEOUT"].includes(error.code);
}

function deliveryProtocol(productCode: ExchangeOrder["productCode"]) {
  if (productCode === "GPU_COMPUTE") return "SSH";
  if (productCode === "NAS_STORAGE") return "NFS";
  if (productCode === "RACK_SPACE") return "WORK_ORDER";
  return "HTTPS";
}

function deliveryPort(productCode: ExchangeOrder["productCode"]) {
  if (productCode === "GPU_COMPUTE") return 22;
  if (productCode === "NAS_STORAGE") return 2049;
  return 443;
}

async function publicProfileDigest(profile: Record<string, unknown>) {
  const bytes = new TextEncoder().encode(JSON.stringify(profile));
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  const hex = Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `sha256:${hex}`;
}

function orderSummary(order: ExchangeOrder) {
  return (
    <>
      <p className="m-0 font-mono text-sm text-[var(--accent)]">{order.id}</p>
      <div className="mt-3 flex items-start justify-between gap-5">
        <h3 className="m-0 text-xl">
          {formatRateUnits(order.productCode, order.rateUnits)} · {formatCapacityHours(order.productCode, order.capacityBaseUnits)}
        </h3>
        <strong className="font-mono text-xl text-[var(--ink)]">
          ¥{(order.totalAmountCents / 100).toFixed(2)}
        </strong>
      </div>
      <p>
        {new Date(order.startAt).toLocaleString("zh-CN")} 至 {new Date(order.endAt).toLocaleString("zh-CN")}
      </p>
    </>
  );
}

function money(cents: number) {
  return `¥${(cents / 100).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function serviceAccounting(order: ExchangeOrder) {
  const metering = order.metering;
  if (!metering) return null;
  const vocabulary = capacityDisplay(order.productCode);
  return (
    <div className="mt-5 border-t border-[var(--border)] pt-5">
      <dl className="grid gap-px bg-[var(--border)] sm:grid-cols-2">
        <div className="bg-[var(--surface)] p-4">
          <dt>实际开始</dt>
          <dd className="m-0 font-semibold text-[var(--ink)]">
            {metering.actualStartAt ? new Date(metering.actualStartAt).toLocaleString("zh-CN") : "尚未开始"}
          </dd>
        </div>
        <div className="bg-[var(--surface)] p-4">
          <dt>SLA 可用率结果</dt>
          <dd className="m-0 font-semibold text-[var(--ink)]">
            {metering.status === "FINAL" && metering.availabilityPpm !== null ? `${(metering.availabilityPpm / 10_000).toLocaleString("zh-CN", { maximumFractionDigits: 4 })}%` : "服务结束后生成"}
          </dd>
        </div>
        <div className="bg-[var(--surface)] p-4">
          <dt>{vocabulary.availabilityLabel}</dt>
          <dd className="m-0 font-mono font-semibold text-[var(--ink)]">{metering.status === "FINAL" ? formatCapacityHours(order.productCode, metering.availableCapacityBaseUnits) : "—"}</dd>
        </div>
        <div className="bg-[var(--surface)] p-4">
          <dt>缺少证据的{vocabulary.capacityFieldLabel}</dt>
          <dd className="m-0 font-mono font-semibold text-[var(--ink)]">{metering.status === "FINAL" ? formatCapacityHours(order.productCode, metering.unprovenCapacityBaseUnits) : "—"}</dd>
        </div>
      </dl>
      {order.settlement ? (
        <div className="mt-px bg-[var(--surface)] p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span>合同 {money(order.settlement.grossAmountCents)} · 基础冲减 -{money(order.settlement.baseCreditCents)}</span>
            <strong>净应付 {money(order.settlement.netSupplierPayableCents)}</strong>
          </div>
          <p className="mb-0 mt-2 text-sm"><strong>测试结算未发生真实资金移动。</strong></p>
        </div>
      ) : null}
    </div>
  );
}

export function SupplierOrderQueue() {
  const [orders, setOrders] = useState<ExchangeOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [rejectReasons, setRejectReasons] = useState<Record<string, string>>({});
  const keys = useRef(new Map<string, string>());

  const load = useCallback(async () => {
    setError("");
    try {
      const page = await exchangeGet<ListResponse<ExchangeOrder>>("/api/v1/orders", "supplier");
      setOrders(page.items);
    } catch (loadError) {
      setError(marketplaceErrorMessage(loadError, "供应商订单队列暂时无法加载。"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    exchangeGet<ListResponse<ExchangeOrder>>("/api/v1/orders", "supplier")
      .then((page) => {
        if (!cancelled) setOrders(page.items);
      })
      .catch((loadError) => {
        if (!cancelled) setError(marketplaceErrorMessage(loadError, "供应商订单队列暂时无法加载。"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function decide(order: ExchangeOrder, action: "CONFIRM" | "REJECT") {
    const reason = action === "CONFIRM"
      ? "已核对容量时间窗和交付排期，可以进入待支付。"
      : (rejectReasons[order.id] ?? "").trim();
    if (action === "REJECT" && reason.length < 4) {
      setError("无法交付时请填写至少 4 个字的具体原因。");
      return;
    }

    setBusyId(order.id);
    setError("");
    setNotice("");
    const scope = `${order.id}:${action}`;
    const key = keys.current.get(scope) ?? createIdempotencyKey(`supplier-${action.toLowerCase()}`);
    keys.current.set(scope, key);
    try {
      await exchangePost<ExchangeOrder>(
        `/api/v1/orders/${encodeURIComponent(order.id)}/supplier-confirmation`,
        "supplier",
        { action, expectedVersion: order.version, reason },
        key,
      );
      keys.current.delete(scope);
      setNotice(action === "CONFIRM"
        ? "容量已确认，平台测试支付单已创建；尚未开始交付。"
        : "订单已拒绝，预留容量已经释放。");
      await load();
    } catch (submitError) {
      setError(marketplaceErrorMessage(submitError, "订单处理失败，请刷新状态后重试。"));
    } finally {
      setBusyId("");
    }
  }

  async function startProvisioning(order: ExchangeOrder) {
    setBusyId(order.id);
    setError("");
    setNotice("");
    const scope = `${order.id}:START_PROVISIONING`;
    const key = keys.current.get(scope) ?? createIdempotencyKey("start-provisioning");
    keys.current.set(scope, key);
    try {
      await exchangePost<ExchangeOrder>(
        `/api/v1/orders/${encodeURIComponent(order.id)}/delivery-start`,
        "supplier",
        {
          expectedVersion: order.version,
          reason: `供应商已领取开通任务并开始准备${capacityDisplay(order.productCode).deliveryNoun}。`,
        },
        key,
      );
      keys.current.delete(scope);
      setNotice("开通任务已开始。请提交脱敏的测试交付包，等待 KAI 核验。");
      await load();
    } catch (submitError) {
      setError(marketplaceErrorMessage(submitError, "开通任务启动失败，请刷新状态后重试。"));
    } finally {
      setBusyId("");
    }
  }

  async function submitDeliveryPackage(order: ExchangeOrder, formData: FormData) {
    if (!order.delivery) return;
    const endpointDisplay = String(formData.get("endpointDisplay") ?? "").trim();
    if (!endpointDisplay.includes("*")) {
      setError("脱敏入口必须包含 *，例如 service-***.supplier.example；不要填写真实完整地址。");
      return;
    }
    if (/[\s@]/.test(endpointDisplay) || endpointDisplay.includes("://")) {
      setError("脱敏入口只填写主机展示值，不要包含协议、账号、密码或 URL。");
      return;
    }

    setBusyId(order.id);
    setError("");
    setNotice("");
    const scope = `${order.id}:SUBMIT_DELIVERY_PACKAGE`;
    const key = keys.current.get(scope) ?? createIdempotencyKey("submit-delivery-package");
    keys.current.set(scope, key);
    try {
      const publicProfile = {
        protocol: String(formData.get("protocol")),
        endpointDisplay,
        port: Number(formData.get("port")),
        usernameHint: String(formData.get("usernameHint") ?? "").trim(),
        expiresAt: new Date(String(formData.get("expiresAt"))).toISOString(),
        instructionsSummary: String(formData.get("instructionsSummary") ?? "").trim(),
      };
      await exchangePost(
        `/api/v1/delivery-tasks/${encodeURIComponent(order.delivery.id)}/packages`,
        "supplier",
        {
          expectedVersion: order.delivery.version,
          publicProfile,
          evidenceDigest: await publicProfileDigest(publicProfile),
        },
        key,
      );
      keys.current.delete(scope);
      setNotice("测试交付包已提交 KAI 核验。未提交密码、私钥或任何生产凭据。");
      await load();
    } catch (submitError) {
      if (!mayHaveReachedServer(submitError)) keys.current.delete(scope);
      setError(marketplaceErrorMessage(submitError, "测试交付包提交失败，请核对脱敏档案并刷新后重试。"));
    } finally {
      setBusyId("");
    }
  }

  const pending = orders.filter((order) => order.status === "PENDING_SUPPLIER_CONFIRMATION");
  const ready = orders.filter((order) => order.delivery?.status === "PENDING");
  const packageReady = orders.filter((order) => order.allowedActions.includes("SUBMIT_DELIVERY_PACKAGE"));
  const verifying = orders.filter((order) => order.delivery?.status === "VERIFYING");
  const delivered = orders.filter((order) => order.delivery?.status === "DELIVERED");
  const serviceOrders = orders.filter((order) => order.metering?.status === "ACTIVE" || order.metering?.status === "FINAL");

  return (
    <section aria-labelledby="supplier-orders-title" className="border-b border-[var(--border)] bg-[var(--surface)]">
      <div className="shell py-10 sm:py-12">
        <div className="flex flex-wrap items-end justify-between gap-5">
          <div>
            <p className="kicker">订单队列</p>
            <h2 id="supplier-orders-title" className="m-0 text-3xl">供应商订单与测试交付</h2>
          </div>
          <button type="button" className="button button-secondary" onClick={() => void load()}>刷新订单</button>
        </div>
        <p className="section-lead max-w-4xl">
          测试交付包只记录脱敏连接档案。不要填写密码、私钥、API Key、完整主机地址或任何生产凭据；
          一次性 TEST code 由平台在买方领取时生成。
        </p>
        {error ? <div role="alert" className="mt-5 border-l-4 border-[var(--error)] bg-[var(--error-bg)] p-4 text-[var(--error)]">{error}</div> : null}
        {notice ? <div role="status" className="mt-5 border-l-4 border-[var(--success)] bg-[var(--success-bg)] p-4">{notice}</div> : null}
        {loading ? <p className="mt-6 border-l-2 border-[var(--accent)] pl-4">正在读取订单队列…</p> : null}

        {!loading ? (
          <div className="mt-8 grid gap-10">
            <div>
              <h3 className="text-2xl">待确认容量</h3>
              {pending.length === 0 ? <p className="bg-[var(--info-bg)] p-5">当前没有等待确认的容量订单。</p> : (
                <div className="grid gap-px bg-[var(--border)] lg:grid-cols-2">
                  {pending.map((order) => (
                    <article key={order.id} className="bg-[var(--info-bg)] p-6">
                      {orderSummary(order)}
                      <label className="field mt-4">
                        <span>无法交付原因（拒绝时必填）</span>
                        <textarea value={rejectReasons[order.id] ?? ""} onChange={(event) => setRejectReasons((current) => ({ ...current, [order.id]: event.target.value }))} />
                      </label>
                      <div className="mt-5 flex flex-wrap gap-3">
                        <button type="button" className="button button-primary" disabled={Boolean(busyId)} onClick={() => void decide(order, "CONFIRM")}>{busyId === order.id ? "正在处理…" : "确认可交付"}</button>
                        <button type="button" className="button button-secondary" disabled={Boolean(busyId)} onClick={() => void decide(order, "REJECT")}>无法交付并释放</button>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </div>

            <div>
              <h3 className="text-2xl">待开始开通</h3>
              {ready.length === 0 ? <p className="bg-[var(--info-bg)] p-5">当前没有已锁定容量、等待开通的订单。</p> : (
                <div className="grid gap-px bg-[var(--border)] lg:grid-cols-2">
                  {ready.map((order) => (
                    <article key={order.id} className="bg-[var(--accent-soft)] p-6">
                      {orderSummary(order)}
                      <p><strong>平台已确认测试支付 · 未实际收款</strong></p>
                      <button type="button" className="button button-primary" disabled={Boolean(busyId)} onClick={() => void startProvisioning(order)}>{busyId === order.id ? "正在启动…" : "开始准备测试交付"}</button>
                    </article>
                  ))}
                </div>
              )}
            </div>

            <div>
              <h3 className="text-2xl">待提交测试交付包</h3>
              {packageReady.length === 0 ? <p className="bg-[var(--info-bg)] p-5">当前没有等待提交测试交付包的订单。</p> : (
                <div className="grid gap-6">
                  {packageReady.map((order) => (
                    <article key={order.id} className="border-t-4 border-[var(--accent)] bg-[var(--info-bg)] p-6">
                      {orderSummary(order)}
                      {order.delivery?.package?.status === "REJECTED" ? (
                        <div className="my-5 border-l-4 border-[var(--warning)] bg-[var(--warning-bg)] p-4">
                          <strong>上一版已退回，请修正后提交新版本</strong>
                          <p className="mb-0">{order.delivery.package.review?.reason || "请按 KAI 核验意见修正脱敏连接档案。"}</p>
                        </div>
                      ) : null}
                      <form action={(formData) => submitDeliveryPackage(order, formData)} className="form-grid mt-5">
                        <label className="field">
                          <span>连接协议</span>
                          <select name="protocol" defaultValue={deliveryProtocol(order.productCode)} required>
                            <option value="SSH">SSH</option>
                            <option value="HTTPS">HTTPS</option>
                            <option value="JUPYTER">Jupyter HTTPS</option>
                            <option value="NFS">NFS 4.1</option>
                            <option value="WORK_ORDER">托管工单</option>
                          </select>
                        </label>
                        <label className="field">
                          <span>端口</span>
                          <input name="port" type="number" min="1" max="65535" defaultValue={deliveryPort(order.productCode)} required />
                        </label>
                        <label className="field full-span">
                          <span>脱敏入口展示（必须包含 *）</span>
                          <input name="endpointDisplay" required minLength={5} maxLength={255} placeholder="service-***.supplier.example" autoComplete="off" />
                        </label>
                        <label className="field">
                          <span>脱敏用户名提示</span>
                          <input name="usernameHint" required minLength={2} maxLength={80} placeholder="kai-test-***" autoComplete="off" />
                        </label>
                        <label className="field">
                          <span>测试档案有效至</span>
                          <input
                            name="expiresAt"
                            type="datetime-local"
                            min={localDate(1)}
                            defaultValue={localDateValue(new Date(Date.parse(order.endAt) + 60 * 60 * 1_000))}
                            required
                          />
                          <small>有效期须覆盖订单服务结束；过期后需重新提交、领取并完成连接检查。</small>
                        </label>
                        <label className="field full-span">
                          <span>连接说明摘要</span>
                          <textarea name="instructionsSummary" required minLength={8} maxLength={800} rows={3} placeholder="仅说明测试连接步骤、允许来源和环境准备要求；不要粘贴命令中的密码、令牌或私钥。" />
                        </label>
                        <label className="full-span flex items-start gap-3 border-l-4 border-[var(--warning)] bg-[var(--warning-bg)] p-4">
                          <input type="checkbox" required className="mt-1" />
                          <span>我确认没有填写密码、私钥、API Key、完整主机地址或其他生产凭据。</span>
                        </label>
                        <div className="full-span">
                          <button className="button button-primary" disabled={Boolean(busyId)}>{busyId === order.id ? "正在提交…" : order.delivery?.package?.status === "REJECTED" ? "修正后重新提交" : "提交 KAI 核验"}</button>
                        </div>
                      </form>
                    </article>
                  ))}
                </div>
              )}
            </div>

            <div>
              <h3 className="text-2xl">KAI 核验中</h3>
              {verifying.length === 0 ? <p className="bg-[var(--info-bg)] p-5">当前没有等待 KAI 核验的测试交付包。</p> : (
                <div className="grid gap-px bg-[var(--border)] lg:grid-cols-2">
                  {verifying.map((order) => (
                    <article key={order.id} className="bg-[var(--info-bg)] p-6">
                      {orderSummary(order)}
                      <p><strong>测试交付包第 {order.delivery?.package?.revision ?? 1} 版正在核验</strong></p>
                      <p className="mb-0">通过后只开放买方领取一次性 TEST code；不代表连接可达、开始计费、服务完成或最终验收。</p>
                    </article>
                  ))}
                </div>
              )}
            </div>

            <div>
              <h3 className="text-2xl">已开放测试领取</h3>
              {delivered.length === 0 ? <p className="bg-[var(--info-bg)] p-5">当前没有已核验并等待买方领取的测试交付包。</p> : (
                <div className="grid gap-px bg-[var(--border)] lg:grid-cols-2">
                  {delivered.map((order) => (
                    <article key={order.id} className="bg-[var(--accent-soft)] p-6">
                      {orderSummary(order)}
                      <p><strong>测试交付包已核验</strong></p>
                      <p className="mb-0">买方可领取一次性 TEST code。此状态不是服务完成，也不会自动开始计费或验收。</p>
                    </article>
                  ))}
                </div>
              )}
            </div>

            <div>
              <h3 className="text-2xl">服务、计量与结算</h3>
              {serviceOrders.length === 0 ? <p className="bg-[var(--info-bg)] p-5">当前没有已经开始服务或完成计量的订单。</p> : (
                <div className="grid gap-px bg-[var(--border)] lg:grid-cols-2">
                  {serviceOrders.map((order) => (
                    <article key={order.id} className="bg-[var(--info-bg)] p-6">
                      {orderSummary(order)}
                      <p>
                        <strong>{order.metering?.status === "ACTIVE" ? "服务进行中" : order.acceptance?.status === "ACCEPTED" ? "买方已验收" : order.acceptance?.status === "DISPUTED" ? "买方已发起争议" : "计量已完成，等待买方验收"}</strong>
                      </p>
                      {serviceAccounting(order)}
                    </article>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
