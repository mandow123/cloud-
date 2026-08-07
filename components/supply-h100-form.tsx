"use client";

import Link from "next/link";
import { FormEvent, useRef, useState } from "react";
import { createIdempotencyKey, marketplaceErrorMessage } from "@/lib/client/marketplace-client";
import {
  createSupplyPool,
  createVerificationJob,
  importSupplyMembers,
  sha256Digest,
  supplyApiUnavailable,
  type SupplyPool,
  type SupplyVerificationJob,
} from "@/components/supply-api-client";

const regions = ["华北", "华东", "华南", "西南", "西北"];

export function SupplyH100Form() {
  const [title, setTitle] = useState("H100 SXM5 80GB · 8 卡整机试运行");
  const [region, setRegion] = useState("华北");
  const [supplierAssetId, setSupplierAssetId] = useState("");
  const [serialDigest, setSerialDigest] = useState("");
  const [networkScope, setNetworkScope] = useState("整机独占 SSH；基础网络包含在试运行范围内，公网带宽与白名单由验真确认。");
  const [ownershipConfirmed, setOwnershipConfirmed] = useState(false);
  const [pool, setPool] = useState<SupplyPool | null>(null);
  const [verification, setVerification] = useState<SupplyVerificationJob | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const poolKey = useRef(createIdempotencyKey("h100-pool"));
  const memberKey = useRef(createIdempotencyKey("h100-member"));
  const verificationKey = useRef(createIdempotencyKey("h100-verification"));

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");

    if (supplierAssetId.trim().length < 4) {
      setError("请填写至少 4 个字符的内部资产编号。");
      return;
    }
    if (!/^sha256:[a-f0-9]{64}$/i.test(serialDigest.trim())) {
      setError("序列号必须先脱敏为 sha256 摘要，不能提交明文序列号。");
      return;
    }
    if (!ownershipConfirmed) {
      setError("请确认资源权属和整机独占交付能力。");
      return;
    }

    setBusy(true);
    try {
      const specification = {
        manufacturer: "NVIDIA",
        model: "H100 SXM5 80GB",
        gpuCount: 8,
        memoryGiBPerGpu: 80,
        topology: "SINGLE_NODE_NVLINK",
        migMode: "DISABLED",
        exclusive: true,
        networkScope: networkScope.trim(),
      };
      const specDigest = await sha256Digest(specification);
      const currentPool = pool ?? (await createSupplyPool({
        externalRef: `H100-8X-${supplierAssetId.trim()}`,
        assetKind: "H100_8X_NODE",
        name: title.trim(),
        region,
        deliveryForm: "整机独占 SSH",
        specDigest,
      }, poolKey.current)).record;
      setPool(currentPool);

      const memberResult = await importSupplyMembers(currentPool.id, [{
        externalRef: supplierAssetId.trim(),
        serialDigest: serialDigest.trim().toLowerCase(),
        hardwareUuidDigest: null,
        specDigest,
      }], memberKey.current);
      const member = memberResult.record.items[0];
      if (!member) throw new Error("上架服务没有返回 H100 节点成员。");
      const verificationRecord = (await createVerificationJob(member.id, verificationKey.current)).record;
      setVerification(verificationRecord);
      setNotice("资源池、8 卡整机成员和验真任务已写入服务端。验真通过后才允许生成发布计划；支付宝 LIVE 就绪前仍不会成交。");
    } catch (submitError) {
      setError(supplyApiUnavailable(submitError)
        ? "上架服务 API 尚未就绪，页面没有保存或伪造资源状态。请等待 /api/v1/supply 服务上线后重试。"
        : marketplaceErrorMessage(submitError, "H100 资源申报未完成；已成功的步骤会保留，刷新资产页可核对真实状态。"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="shell py-10 sm:py-14">
      <div className="grid items-start gap-8 xl:grid-cols-[minmax(0,1fr)_340px]">
        <section aria-labelledby="h100-form-title" className="border-t-4 border-[var(--accent)] bg-[var(--surface)] p-6 ring-1 ring-[var(--border)] sm:p-8">
          <p className="kicker">H100 pilot application</p>
          <h2 className="m-0 text-3xl" id="h100-form-title">新建 8 卡整机资源池</h2>
          <p className="section-lead text-base">本表单写入独立 supply 服务，固定 8 卡、¥1/卡时和整机独占 SSH；不直接创建可成交挂牌。</p>

          {error ? <div className="mt-5 border-l-4 border-[var(--error)] bg-[var(--error-bg)] p-4 text-sm text-[var(--error)]" role="alert">{error}</div> : null}
          {notice ? <div className="mt-5 border-l-4 border-[var(--success)] bg-[var(--success-bg)] p-4 text-sm" role="status">{notice}</div> : null}

          <form className="mt-7 grid gap-5 md:grid-cols-2" noValidate onSubmit={submit}>
            <label className="field md:col-span-2">
              <span>资源池名称</span>
              <input maxLength={100} minLength={4} onChange={(event) => setTitle(event.target.value)} required value={title} />
            </label>
            <label className="field">
              <span>资源地区</span>
              <select onChange={(event) => setRegion(event.target.value)} value={region}>
                {regions.map((item) => <option key={item}>{item}</option>)}
              </select>
            </label>
            <label className="field">
              <span>供应方内部资产编号</span>
              <input maxLength={80} minLength={4} onChange={(event) => setSupplierAssetId(event.target.value)} placeholder="例如 H100-NODE-001" required value={supplierAssetId} />
            </label>
            <label className="field md:col-span-2">
              <span>设备序列号摘要</span>
              <input autoComplete="off" maxLength={135} onChange={(event) => setSerialDigest(event.target.value)} placeholder="sha256:…（禁止填写明文序列号）" required value={serialDigest} />
            </label>
            <label className="field md:col-span-2">
              <span>网络与 SSH 交付范围</span>
              <textarea maxLength={500} minLength={8} onChange={(event) => setNetworkScope(event.target.value)} required rows={4} value={networkScope} />
            </label>

            <fieldset className="md:col-span-2 border border-[var(--border)] bg-[var(--info-bg)] p-5">
              <legend className="px-2 font-semibold text-[var(--ink)]">已锁定的试运行规则</legend>
              <dl className="grid gap-4 text-sm sm:grid-cols-2">
                <div><dt>硬件</dt><dd className="m-0 font-semibold text-[var(--ink)]">8×H100 SXM5 80GB · 同节点</dd></div>
                <div><dt>拓扑</dt><dd className="m-0 font-semibold text-[var(--ink)]">NVLink / NVSwitch 待验真</dd></div>
                <div><dt>价格</dt><dd className="m-0 font-semibold text-[var(--ink)]">¥1/卡时 · ¥8/整机时</dd></div>
                <div><dt>购买粒度</dt><dd className="m-0 font-semibold text-[var(--ink)]">最少 8 卡 · 最多 8 卡</dd></div>
                <div><dt>交付</dt><dd className="m-0 font-semibold text-[var(--ink)]">整机独占 SSH</dd></div>
                <div><dt>中断策略</dt><dd className="m-0 font-semibold text-[var(--ink)]">不可中断</dd></div>
              </dl>
            </fieldset>

            <label className="md:col-span-2 flex items-start gap-3 border border-[var(--border)] p-4 text-sm text-[var(--text)]">
              <input checked={ownershipConfirmed} className="mt-1 size-4 accent-[var(--brand)]" onChange={(event) => setOwnershipConfirmed(event.target.checked)} type="checkbox" />
              <span>我确认拥有该设备的合法处置或运营授权，并能在订单时间窗内提供 8 卡整机独占 SSH；最终发布仍以平台验真为准。</span>
            </label>

            <div className="md:col-span-2 flex flex-wrap items-center gap-4">
              <button className="button button-primary" disabled={busy} type="submit">{busy ? "正在写入并创建验真任务…" : "保存资源并申请验真"}</button>
              <Link className="button button-secondary" href="/supply/assets">查看资源资产</Link>
            </div>
          </form>
        </section>

        <aside className="border-t-4 border-[var(--border-strong)] bg-[var(--info-bg)] p-6 xl:sticky xl:top-28" aria-labelledby="h100-gates-title">
          <p className="kicker">Publication gates</p>
          <h2 className="m-0 text-2xl" id="h100-gates-title">发布安全门</h2>
          <ol className="mt-5 grid gap-3 p-0 text-sm">
            {[
              ["资源池", pool ? `${pool.id} · ${pool.status}` : "尚未创建"],
              ["8 卡成员", pool ? "已提交服务端入库" : "等待资源池"],
              ["验真任务", verification ? `${verification.id} · ${verification.status}` : "尚未创建"],
              ["发布预览", "等待验真通过后生成"],
              ["支付宝 LIVE", "未配置 · 成交阻断"],
            ].map(([label, value], index) => (
              <li className="list-none border-b border-[var(--border)] pb-3" key={label}>
                <span className="font-mono text-xs text-[var(--muted)]">0{index + 1}</span>
                <strong className="mt-1 block text-[var(--ink)]">{label}</strong>
                <span className="break-words text-[var(--text)]">{value}</span>
              </li>
            ))}
          </ol>
          <p className="mb-0 mt-5 border-l-2 border-[var(--warning)] pl-4 text-sm text-[var(--text)]">序列号、SSH 密钥和支付凭据都不能以明文写入本页面。</p>
        </aside>
      </div>
    </div>
  );
}
