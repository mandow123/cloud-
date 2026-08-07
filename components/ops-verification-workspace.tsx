"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ResourceAsset, VerificationRun } from "@/lib/exchange";
import { createIdempotencyKey, exchangeGet, exchangePost, marketplaceErrorMessage } from "@/lib/client/marketplace-client";
import { capacityDisplay, formatRateUnits } from "@/lib/capacity-display";

type ListResponse<T> = { items: T[]; count: number };

function localDate(days: number) {
  const date = new Date(Date.now() + days * 24 * 60 * 60 * 1_000);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60 * 1_000);
  return local.toISOString().slice(0, 16);
}

export function OpsVerificationWorkspace() {
  const [resources, setResources] = useState<ResourceAsset[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const keyRef = useRef<string | null>(null);

  const load = useCallback(async () => {
    setError("");
    try {
      const page = await exchangeGet<ListResponse<ResourceAsset>>("/api/v1/ops/resources", "ops");
      setResources(page.items);
      setSelectedId((current) => current || page.items[0]?.id || "");
    } catch (loadError) {
      setError(marketplaceErrorMessage(loadError, "验真队列暂时无法加载。"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    exchangeGet<ListResponse<ResourceAsset>>("/api/v1/ops/resources", "ops")
      .then((page) => {
        setResources(page.items);
        setSelectedId(page.items[0]?.id || "");
      })
      .catch((loadError) => setError(marketplaceErrorMessage(loadError, "验真队列暂时无法加载。")))
      .finally(() => setLoading(false));
  }, []);

  async function submit(formData: FormData) {
    setBusy(true);
    setError("");
    setNotice("");
    const resourceId = String(formData.get("resourceId"));
    const result = String(formData.get("result"));
    try {
      keyRef.current ??= createIdempotencyKey("exchange-verification");
      await exchangePost<VerificationRun>(`/api/v1/resources/${encodeURIComponent(resourceId)}/verification-runs`, "ops", {
        method: String(formData.get("method")),
        result,
        evidenceSummary: String(formData.get("evidenceSummary")),
        evidenceDigest: String(formData.get("evidenceDigest")),
        validUntil: result === "PASS" ? new Date(String(formData.get("validUntil"))).toISOString() : null,
      }, keyRef.current);
      keyRef.current = null;
      setNotice(result === "PASS" ? "验真已通过，供应商现在可以划分连续容量批次。" : "验真未通过，原因已记入资源时间线。即使重复提交也不会重复入账。");
      await load();
    } catch (submitError) {
      setError(marketplaceErrorMessage(submitError, "验真结论提交失败，请核对证据和有效期。"));
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <p className="border-l-2 border-[var(--accent)] pl-4">正在读取待验真资源…</p>;
  const selectedResource = resources.find((item) => item.id === selectedId);

  return (
    <div className="grid gap-10 lg:grid-cols-[minmax(320px,.7fr)_minmax(0,1fr)]">
      <section aria-labelledby="verification-queue-title">
        <div className="flex items-end justify-between gap-4 border-b border-[var(--border)] pb-5">
          <div><p className="kicker">运营队列</p><h2 id="verification-queue-title" className="m-0 text-2xl">资源验真队列</h2></div>
          <button className="button button-secondary" type="button" onClick={() => void load()}>刷新</button>
        </div>
        {resources.length ? (
          <ul className="m-0 grid p-0">
            {resources.map((resource) => (
              <li key={resource.id} className="list-none border-b border-[var(--border)]">
                <button type="button" onClick={() => setSelectedId(resource.id)} className={`w-full rounded-none border-0 bg-transparent p-5 text-left ${selectedId === resource.id ? "border-l-4 border-l-[var(--accent)] bg-[var(--accent-soft)]" : ""}`}>
                  <strong className="block text-lg text-[var(--ink)]">{resource.title}</strong>
                  <span>{resource.region} · {formatRateUnits(resource.productCode, resource.totalRateUnits)} · {resource.status}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : <p className="mt-6 bg-[var(--info-bg)] p-5">目前没有供应商资源进入验真队列。</p>}
      </section>

      <section aria-labelledby="verification-form-title" className="border-t-4 border-[var(--accent)] bg-[var(--surface)] pt-6">
        <p className="kicker">验真结论</p>
        <h2 id="verification-form-title" className="m-0 text-3xl">记录验真事实</h2>
        <p className="section-lead">核对选中资源的产品身份、{selectedResource ? capacityDisplay(selectedResource.productCode).rateFieldLabel : "容量数量"}、连续可用时间和交付方式。证据记录不会因后续重验而覆盖。</p>
        {error ? <div role="alert" className="mt-5 border-l-4 border-[var(--error)] bg-[var(--error-bg)] p-4 text-[var(--error)]">{error}</div> : null}
        {notice ? <div role="status" className="mt-5 border-l-4 border-[var(--success)] bg-[var(--success-bg)] p-4 text-[var(--ink)]">{notice}</div> : null}
        {selectedId ? (
          <form action={submit} className="form-grid mt-7">
            <input type="hidden" name="resourceId" value={selectedId} />
            <label className="field"><span>核验方式</span><select name="method"><option value="MANUAL">人工核验</option><option value="CONNECTOR">连接器</option><option value="CLOUD_API">云厂商 API</option></select></label>
            <label className="field"><span>核验结论</span><select name="result" defaultValue="PASS"><option value="PASS">通过</option><option value="FAIL">不通过</option></select></label>
            <label className="field full-span"><span>证据摘要</span><textarea name="evidenceSummary" required minLength={8} maxLength={1000} rows={4} defaultValue="已核对产品身份、容量数量、连续可用时间窗与交付方式。" /></label>
            <label className="field full-span"><span>证据引用或摘要指纹</span><input name="evidenceDigest" required minLength={16} maxLength={128} defaultValue={`manual:${selectedId}:hardware-window`} /></label>
            <label className="field full-span"><span>验真有效期（通过时必填）</span><input name="validUntil" type="datetime-local" step="1" required defaultValue={localDate(30)} /></label>
            <div className="full-span"><button className="button button-primary" disabled={busy}>{busy ? "正在写入验真记录…" : "提交验真结论"}</button></div>
          </form>
        ) : null}
      </section>
    </div>
  );
}
