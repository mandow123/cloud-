"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DeliveryPackage } from "@/lib/exchange";
import {
  createIdempotencyKey,
  exchangeGet,
  exchangePost,
  MarketplaceApiError,
  marketplaceErrorMessage,
} from "@/lib/client/marketplace-client";

type ListResponse<T> = { items: T[]; count: number };

function mayHaveReachedServer(error: unknown) {
  return error instanceof MarketplaceApiError && ["NETWORK_ERROR", "REQUEST_TIMEOUT"].includes(error.code);
}

async function reviewEvidenceDigest(value: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return `sha256:${Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function statusLabel(status: DeliveryPackage["status"]) {
  if (status === "SUBMITTED") return "待核验";
  if (status === "VERIFIED") return "已开放领取";
  if (status === "REJECTED") return "已退回";
  if (status === "CLAIMED") return "买方已领取";
  if (status === "EXPIRED") return "已过期";
  return "已撤销";
}

export function OpsDeliveryWorkspace() {
  const [packages, setPackages] = useState<DeliveryPackage[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [decision, setDecision] = useState<"PASS" | "REJECT">("PASS");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const keyRef = useRef<string | null>(null);

  const selected = useMemo(
    () => packages.find((deliveryPackage) => deliveryPackage.id === selectedId) ?? null,
    [packages, selectedId],
  );

  const load = useCallback(async () => {
    setError("");
    try {
      const page = await exchangeGet<ListResponse<DeliveryPackage>>("/api/v1/ops/delivery-packages", "ops");
      setPackages(page.items);
      setSelectedId((current) => page.items.some((item) => item.id === current) ? current : page.items[0]?.id ?? "");
    } catch (loadError) {
      setError(marketplaceErrorMessage(loadError, "订单测试交付核验队列暂时无法加载。"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    exchangeGet<ListResponse<DeliveryPackage>>("/api/v1/ops/delivery-packages", "ops")
      .then((page) => {
        if (cancelled) return;
        setPackages(page.items);
        setSelectedId(page.items[0]?.id ?? "");
      })
      .catch((loadError) => {
        if (!cancelled) setError(marketplaceErrorMessage(loadError, "订单测试交付核验队列暂时无法加载。"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function submitReview(formData: FormData) {
    if (!selected || !selected.allowedActions.includes("REVIEW_DELIVERY_PACKAGE")) return;
    const reason = String(formData.get("reason") ?? "").trim();
    if (decision === "REJECT" && reason.length < 8) {
      setError("退回时请填写至少 8 个字的明确修正意见。");
      return;
    }

    setBusy(true);
    setError("");
    setNotice("");
    keyRef.current ??= createIdempotencyKey("review-delivery-package");
    try {
      const verificationMethod = String(formData.get("verificationMethod"));
      const reviewReason = reason || "已核对测试交付包的脱敏公开档案、有效期和订单快照。";
      await exchangePost<DeliveryPackage>(
        `/api/v1/delivery-packages/${encodeURIComponent(selected.id)}/reviews`,
        "ops",
        {
          expectedVersion: selected.version,
          decision,
          verificationMethod,
          reason: reviewReason,
          evidenceDigest: await reviewEvidenceDigest({
            packageId: selected.id,
            revision: selected.revision,
            decision,
            verificationMethod,
            reason: reviewReason,
          }),
        },
        keyRef.current,
      );
      keyRef.current = null;
      setNotice(decision === "PASS"
        ? "测试交付包已通过核验并开放买方领取。此结论不代表连接可达、开始计费、服务完成或最终验收。"
        : "测试交付包已退回；供应商可根据意见提交新版本，历史版本不会被覆盖。");
      await load();
    } catch (submitError) {
      if (!mayHaveReachedServer(submitError)) keyRef.current = null;
      setError(marketplaceErrorMessage(submitError, "核验结论提交失败，请刷新队列并核对当前版本。"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section id="delivery-review" aria-labelledby="delivery-review-title" className="border-t border-[var(--border)] py-12 sm:py-16">
      <div className="mb-8 max-w-4xl">
        <p className="kicker">交付核验</p>
        <h2 id="delivery-review-title" className="m-0 text-3xl sm:text-4xl">订单测试交付核验</h2>
        <p className="section-lead">
          这里只核对脱敏公开连接档案、有效期和订单一致性，不显示密码、私钥或生产凭据。
          核验通过只会开放一次性 TEST code 领取，不代表连接可达、开始计费、服务完成或最终验收。
        </p>
      </div>

      {error ? <div role="alert" className="mb-5 border-l-4 border-[var(--error)] bg-[var(--error-bg)] p-4 text-[var(--error)]">{error}</div> : null}
      {notice ? <div role="status" className="mb-5 border-l-4 border-[var(--success)] bg-[var(--success-bg)] p-4">{notice}</div> : null}
      {loading ? <p className="border-l-2 border-[var(--accent)] pl-4">正在读取测试交付包…</p> : null}

      {!loading ? (
        <div className="grid gap-10 lg:grid-cols-[minmax(320px,.7fr)_minmax(0,1fr)]">
          <section aria-labelledby="delivery-package-queue-title">
            <div className="flex items-end justify-between gap-4 border-b border-[var(--border)] pb-5">
              <div>
                <p className="kicker">待处理队列</p>
                <h3 id="delivery-package-queue-title" className="m-0 text-2xl">测试交付包记录</h3>
              </div>
              <button className="button button-secondary" type="button" onClick={() => void load()}>刷新</button>
            </div>
            {packages.length ? (
              <ul className="m-0 grid p-0">
                {packages.map((deliveryPackage) => (
                  <li key={deliveryPackage.id} className="list-none border-b border-[var(--border)]">
                    <button
                      type="button"
                      onClick={() => setSelectedId(deliveryPackage.id)}
                      className={`w-full rounded-none border-0 bg-transparent p-5 text-left ${selectedId === deliveryPackage.id ? "border-l-4 border-l-[var(--accent)] bg-[var(--accent-soft)]" : ""}`}
                    >
                      <span className="font-mono text-sm text-[var(--accent)]">{deliveryPackage.orderId}</span>
                      <strong className="mt-1 block text-lg text-[var(--ink)]">第 {deliveryPackage.revision} 版 · {statusLabel(deliveryPackage.status)}</strong>
                      <span>{deliveryPackage.publicProfile.region} · {deliveryPackage.publicProfile.protocol} · {deliveryPackage.publicProfile.endpointDisplay}:{deliveryPackage.publicProfile.port}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-6 bg-[var(--info-bg)] p-5">当前没有供应商提交的测试交付包。</p>
            )}
          </section>

          <section aria-labelledby="delivery-package-review-form-title" className="border-t-4 border-[var(--accent)] bg-[var(--surface)] pt-6">
            {selected ? (
              <>
                <p className="kicker">交付包 {selected.id}</p>
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <h3 id="delivery-package-review-form-title" className="m-0 text-3xl">核对第 {selected.revision} 版档案</h3>
                    <p className="section-lead">订单 {selected.orderId}</p>
                  </div>
                  <strong className="border border-[var(--border)] px-3 py-2">{statusLabel(selected.status)}</strong>
                </div>

                <dl className="mt-6 grid gap-px bg-[var(--border)] sm:grid-cols-2">
                  {[
                    ["环境", "TEST · 测试交付"],
                    ["交付形态", selected.publicProfile.deliveryForm],
                    ["地区", selected.publicProfile.region],
                    ["连接协议", selected.publicProfile.protocol],
                    ["脱敏入口", `${selected.publicProfile.endpointDisplay}:${selected.publicProfile.port}`],
                    ["用户名提示", selected.publicProfile.usernameHint],
                    ["凭据形态", "一次性 TEST code（核验页不显示）"],
                    ["有效至", new Date(selected.publicProfile.expiresAt).toLocaleString("zh-CN")],
                  ].map(([label, value]) => (
                    <div key={label} className="bg-[var(--info-bg)] p-4">
                      <dt>{label}</dt>
                      <dd className="m-0 break-words font-semibold text-[var(--ink)]">{value}</dd>
                    </div>
                  ))}
                </dl>
                <div className="mt-px bg-[var(--info-bg)] p-5">
                  <strong>连接说明摘要</strong>
                  <p className="mb-0">{selected.publicProfile.instructionsSummary}</p>
                </div>

                {selected.review ? (
                  <div className="mt-6 border-l-4 border-[var(--warning)] bg-[var(--warning-bg)] p-4">
                    <strong>已有核验结论：{selected.review.decision === "PASS" ? "通过" : "退回"}</strong>
                    <p className="mb-0">{selected.review.reason}</p>
                  </div>
                ) : null}

                {selected.allowedActions.includes("REVIEW_DELIVERY_PACKAGE") ? (
                  <form action={submitReview} className="form-grid mt-7">
                    <label className="field">
                      <span>核验结论</span>
                      <select value={decision} onChange={(event) => setDecision(event.target.value as "PASS" | "REJECT")}>
                        <option value="PASS">通过并开放测试领取</option>
                        <option value="REJECT">退回供应商修改</option>
                      </select>
                    </label>
                    <label className="field">
                      <span>核验方式</span>
                      <select name="verificationMethod" defaultValue="MANUAL">
                        <option value="MANUAL">人工核验</option>
                        <option value="SIMULATED_TEST">测试结构检查</option>
                      </select>
                    </label>
                    <label className="field full-span">
                      <span>{decision === "REJECT" ? "退回原因（至少 8 个字）" : "通过说明"}</span>
                      <textarea name="reason" required={decision === "REJECT"} minLength={decision === "REJECT" ? 8 : 0} maxLength={1000} rows={4} placeholder={decision === "REJECT" ? "说明需要修正的字段和原因。" : "已核对脱敏档案、有效期和订单快照。"} />
                    </label>
                    <p className="full-span m-0 bg-[var(--info-bg)] p-4">提交时会根据交付包版本、核验方式和结论自动生成 SHA-256 证据指纹，不能用自由文本代替摘要。</p>
                    <div className="full-span border-l-4 border-[var(--warning)] bg-[var(--warning-bg)] p-4">
                      <strong>核验边界</strong>
                      <p className="mb-0">通过仅表示测试交付包可被领取；不代表连接可达、开始计费、服务完成或最终验收。</p>
                    </div>
                    <div className="full-span">
                      <button className="button button-primary" disabled={busy}>{busy ? "正在提交…" : decision === "PASS" ? "通过并开放测试领取" : "退回供应商修改"}</button>
                    </div>
                  </form>
                ) : (
                  <p className="mt-6 bg-[var(--info-bg)] p-5">此版本没有可执行的核验动作。请刷新队列确认最新状态。</p>
                )}
              </>
            ) : (
              <p className="bg-[var(--info-bg)] p-5">选择左侧测试交付包后查看脱敏档案和核验动作。</p>
            )}
          </section>
        </div>
      ) : null}
    </section>
  );
}
