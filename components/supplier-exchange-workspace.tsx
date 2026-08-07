"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CapacityLot, CapacityWithdrawal, ListingVersion, ProductVersion, ResourceAsset } from "@/lib/exchange";
import {
  createIdempotencyKey,
  exchangeGet,
  exchangePost,
  MarketplaceApiError,
  marketplaceErrorMessage,
} from "@/lib/client/marketplace-client";
import { capacityDisplay, formatCapacityHours, formatRateUnits } from "@/lib/capacity-display";

type ListResponse<T> = { items: T[]; count: number };

const statusLabel: Record<ResourceAsset["status"] | CapacityLot["status"], string> = {
  DECLARED: "待 KAI 验真",
  VERIFIED: "验真通过",
  REJECTED: "验真未通过",
  SUSPENDED: "已暂停",
  WITHDRAWN: "已撤回",
  READY: "待上架",
  LISTED: "已上架",
  EXPIRED: "已结束",
};

const withdrawalReasonLabel: Record<CapacityLot["withdrawalEligibility"]["reasonCode"], string> = {
  ELIGIBLE: "可整批取出",
  LOT_NOT_READY: "批次当前不是待上架状态",
  LISTING_HISTORY_EXISTS: "已有挂牌历史，不能取出",
  RESERVATION_HISTORY_EXISTS: "已有占用历史，不能取出",
  ALREADY_WITHDRAWN: "批次已经取出",
  TRANSFER_HISTORY_NOT_PRISTINE: "容量账本已有业务转移，不能取出",
};

function localDateTime(offsetHours: number) {
  const date = new Date(Date.now() + offsetHours * 60 * 60 * 1_000);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60 * 1_000);
  return local.toISOString().slice(0, 16);
}

function toUtc(value: string) {
  return new Date(value).toISOString();
}

function rateInputStep(productCode: ProductVersion["productCode"] | undefined) {
  return productCode === "TOKEN_THROUGHPUT" ? "0.001" : "1";
}

function rateInputMinimum(productCode: ProductVersion["productCode"] | undefined) {
  return productCode === "TOKEN_THROUGHPUT" ? "0.001" : "1";
}

function displayedRateUnits(productCode: ProductVersion["productCode"] | undefined, rateUnits: number | undefined) {
  if (rateUnits === undefined) return undefined;
  return productCode === "TOKEN_THROUGHPUT"
    ? rateUnits / 1_000
    : productCode === "NAS_STORAGE"
      ? rateUnits / 1_024
      : rateUnits;
}

function canonicalRateUnits(productCode: ProductVersion["productCode"] | undefined, value: FormDataEntryValue | null) {
  const input = Number(value);
  const scaled = productCode === "TOKEN_THROUGHPUT"
    ? input * 1_000
    : productCode === "NAS_STORAGE"
      ? input * 1_024
      : input;
  if (!Number.isSafeInteger(scaled) || scaled <= 0) {
    throw new Error("可交付数量必须符合当前产品的最小计量精度。");
  }
  return scaled;
}

function rateUnitHint(productCode: ProductVersion["productCode"] | undefined) {
  if (productCode === "TOKEN_THROUGHPUT") return "（百万 Token/小时）";
  if (productCode === "NAS_STORAGE") return "（TiB）";
  if (productCode === "RACK_SPACE") return "（整柜）";
  return "";
}

function resourcePlaceholder(productCode: ProductVersion["productCode"] | undefined) {
  if (productCode === "MODEL_INSTANCE") return "例如：DeepSeek V4 Pro 标准实例池";
  if (productCode === "TOKEN_THROUGHPUT") return "例如：DeepSeek V4 Pro 标准吞吐池";
  if (productCode === "NAS_STORAGE") return "例如：华北 NFS 4.1 均衡型存储池";
  if (productCode === "RACK_SPACE") return "例如：北京 42U 10kW 整柜托管区";
  return "例如：华北 H100 SXM5 连续资源池";
}

function defaultDeliveryForm(productCode: ProductVersion["productCode"] | undefined) {
  if (productCode === "MODEL_INSTANCE") return "托管模型服务";
  if (productCode === "TOKEN_THROUGHPUT") return "Token API 服务";
  if (productCode === "NAS_STORAGE") return "NAS 存储卷";
  if (productCode === "RACK_SPACE") return "整柜托管工单";
  return "容器实例";
}

function defaultResourceRate(productCode: ProductVersion["productCode"] | undefined) {
  if (productCode === "MODEL_INSTANCE") return "4";
  if (productCode === "TOKEN_THROUGHPUT") return "3";
  if (productCode === "NAS_STORAGE") return "20";
  if (productCode === "RACK_SPACE") return "2";
  return "8";
}

function defaultLotRate(productCode: ProductVersion["productCode"] | undefined) {
  if (productCode === "MODEL_INSTANCE") return 2;
  if (productCode === "TOKEN_THROUGHPUT") return 1;
  if (productCode === "NAS_STORAGE") return 10;
  if (productCode === "RACK_SPACE") return 1;
  return 4;
}

function defaultUnitPrice(productCode: ProductVersion["productCode"] | undefined) {
  if (productCode === "MODEL_INSTANCE") return "25.001";
  if (productCode === "TOKEN_THROUGHPUT") return "4.9";
  if (productCode === "NAS_STORAGE") return "0.35";
  if (productCode === "RACK_SPACE") return "18";
  return "26.9";
}

function defaultNetworkScope(productCode: ProductVersion["productCode"] | undefined) {
  if (productCode === "NAS_STORAGE") return "NFS 4.1 私网挂载；公网流量与跨区复制另行确认。";
  if (productCode === "RACK_SPACE") return "双路基础上联与托管工单入口；专线、BGP 和额外公网带宽另行确认。";
  if (productCode === "MODEL_INSTANCE" || productCode === "TOKEN_THROUGHPUT") return "含服务端点基础公网与访问控制；专线和额外流量另行确认。";
  return "含基础公网出口与集群内网；专线另行确认。";
}

function defaultScopeNote(productCode: ProductVersion["productCode"] | undefined) {
  if (productCode === "NAS_STORAGE") return "人民币含税，含约定存储容量、快照与基础私网访问；公网流量和跨区复制另行确认。";
  if (productCode === "RACK_SPACE") return "人民币含税，包含 42U 整柜、10kW 约定功率、基础网络、冷却与托管工单；额外功率和专线另行确认。";
  if (productCode === "TOKEN_THROUGHPUT") return "人民币含税，按百万 Token 容量时预留输入与输出总吞吐；超出预留和定制网络另行确认。";
  if (productCode === "MODEL_INSTANCE") return "人民币含税，包含独占模型实例、基础网络和约定 SLA；定制镜像与专线另行确认。";
  return "人民币含税，包含基础电力、网络与约定 SLA；专线和定制镜像另行确认。";
}

export function SupplierExchangeWorkspace() {
  const [products, setProducts] = useState<ProductVersion[]>([]);
  const [resources, setResources] = useState<ResourceAsset[]>([]);
  const [lots, setLots] = useState<CapacityLot[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"resource" | "lot" | "listing" | "withdraw" | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [selectedProductId, setSelectedProductId] = useState("");
  const [selectedResourceId, setSelectedResourceId] = useState("");
  const [selectedLotId, setSelectedLotId] = useState("");
  const [withdrawLotId, setWithdrawLotId] = useState<string | null>(null);
  const resourceKey = useRef<string | null>(null);
  const lotKey = useRef<string | null>(null);
  const listingKey = useRef<string | null>(null);
  const withdrawalKey = useRef<string | null>(null);
  const withdrawalReasonRef = useRef<HTMLTextAreaElement>(null);

  const load = useCallback(async () => {
    setError("");
    try {
      const [productPage, resourcePage, lotPage] = await Promise.all([
        exchangeGet<ListResponse<ProductVersion>>("/api/v1/product-versions", "supplier"),
        exchangeGet<ListResponse<ResourceAsset>>("/api/v1/resources", "supplier"),
        exchangeGet<ListResponse<CapacityLot>>("/api/v1/capacity-lots", "supplier"),
      ]);
      setProducts(productPage.items);
      setResources(resourcePage.items);
      setLots(lotPage.items);
      setSelectedProductId((current) => productPage.items.some((item) => item.id === current) ? current : productPage.items[0]?.id || "");
      setSelectedResourceId((current) => resourcePage.items.some((item) => item.id === current && item.status === "VERIFIED") ? current : resourcePage.items.find((item) => item.status === "VERIFIED")?.id || "");
      setSelectedLotId((current) => lotPage.items.some((item) => item.id === current && item.status === "READY") ? current : lotPage.items.find((item) => item.status === "READY")?.id || "");
    } catch (loadError) {
      setError(marketplaceErrorMessage(loadError, "供应工作台暂时无法加载。"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    Promise.all([
      exchangeGet<ListResponse<ProductVersion>>("/api/v1/product-versions", "supplier"),
      exchangeGet<ListResponse<ResourceAsset>>("/api/v1/resources", "supplier"),
      exchangeGet<ListResponse<CapacityLot>>("/api/v1/capacity-lots", "supplier"),
    ]).then(([productPage, resourcePage, lotPage]) => {
      setProducts(productPage.items);
      setResources(resourcePage.items);
      setLots(lotPage.items);
      setSelectedProductId(productPage.items[0]?.id || "");
      setSelectedResourceId(resourcePage.items.find((item) => item.status === "VERIFIED")?.id || "");
      setSelectedLotId(lotPage.items.find((item) => item.status === "READY")?.id || "");
    }).catch((loadError) => {
      setError(marketplaceErrorMessage(loadError, "供应工作台暂时无法加载。"));
    }).finally(() => setLoading(false));
  }, []);

  const verifiedResources = useMemo(() => resources.filter((item) => item.status === "VERIFIED"), [resources]);
  const readyLots = useMemo(() => lots.filter((item) => item.status === "READY"), [lots]);
  const selectedProduct = products.find((item) => item.id === selectedProductId);
  const selectedResource = verifiedResources.find((item) => item.id === selectedResourceId);
  const selectedLot = readyLots.find((item) => item.id === selectedLotId);
  const selectedProductVocabulary = selectedProduct && (selectedProduct.productCode === "GPU_COMPUTE" || selectedProduct.productCode === "MODEL_INSTANCE" || selectedProduct.productCode === "TOKEN_THROUGHPUT" || selectedProduct.productCode === "NAS_STORAGE" || selectedProduct.productCode === "RACK_SPACE")
    ? capacityDisplay(selectedProduct.productCode)
    : null;

  async function submitResource(formData: FormData) {
    setBusy("resource");
    setError("");
    setNotice("");
    try {
      resourceKey.current ??= createIdempotencyKey("exchange-resource");
      const product = products.find((item) => item.id === String(formData.get("productVersionId")));
      await exchangePost<ResourceAsset>("/api/v1/resources", "supplier", {
        productVersionId: String(formData.get("productVersionId")),
        title: String(formData.get("title")),
        region: String(formData.get("region")),
        deliveryForm: String(formData.get("deliveryForm")),
        totalRateUnits: canonicalRateUnits(product?.productCode, formData.get("totalRateUnits")),
        interruptibility: String(formData.get("interruptibility")),
        networkScope: String(formData.get("networkScope")),
      }, resourceKey.current);
      resourceKey.current = null;
      setNotice("资源已登记，下一步由 KAI 运营核验型号、数量与可用窗口。");
      await load();
    } catch (submitError) {
      setError(marketplaceErrorMessage(submitError, "资源登记失败，请核对后重试。"));
    } finally {
      setBusy(null);
    }
  }

  async function submitLot(formData: FormData) {
    setBusy("lot");
    setError("");
    setNotice("");
    try {
      lotKey.current ??= createIdempotencyKey("exchange-lot");
      const resource = resources.find((item) => item.id === String(formData.get("resourceAssetId")));
      await exchangePost<CapacityLot>("/api/v1/capacity-lots", "supplier", {
        resourceAssetId: String(formData.get("resourceAssetId")),
        startAt: toUtc(String(formData.get("startAt"))),
        endAt: toUtc(String(formData.get("endAt"))),
        rateUnits: canonicalRateUnits(resource?.productCode, formData.get("rateUnits")),
        interruptibility: String(formData.get("interruptibility")),
      }, lotKey.current);
      lotKey.current = null;
      setNotice(`连续容量批次已建立。${resource ? capacityDisplay(resource.productCode).capacityFieldLabel : "容量"}由系统根据数量与起止时间计算。`);
      await load();
    } catch (submitError) {
      setError(marketplaceErrorMessage(submitError, "容量批次建立失败，请检查连续时间窗和可用数量。"));
    } finally {
      setBusy(null);
    }
  }

  async function submitListing(formData: FormData) {
    setBusy("listing");
    setError("");
    setNotice("");
    try {
      const lotId = String(formData.get("capacityLotId"));
      const lot = lots.find((item) => item.id === lotId);
      if (!lot) throw new Error("所选容量批次已变化，请刷新后重试。");
      listingKey.current ??= createIdempotencyKey("exchange-listing");
      await exchangePost<ListingVersion>(`/api/v1/capacity-lots/${encodeURIComponent(lotId)}/listings`, "supplier", {
        expectedLotVersion: lot.version,
        unitPriceMicros: Math.round(Number(formData.get("unitPriceYuan")) * 1_000_000),
        minRateUnits: canonicalRateUnits(lot?.productCode, formData.get("minRateUnits")),
        maxRateUnits: canonicalRateUnits(lot?.productCode, formData.get("maxRateUnits")),
        minDurationMinutes: Number(formData.get("minDurationMinutes")),
        taxIncluded: formData.get("taxIncluded") === "on",
        energyIncluded: formData.get("energyIncluded") === "on",
        networkIncluded: formData.get("networkIncluded") === "on",
        scopeNote: String(formData.get("scopeNote")),
        sla: {
          availabilityPercent: Number(formData.get("availabilityPercent")),
          responseMinutes: Number(formData.get("responseMinutes")),
        },
        deliveryForm: String(formData.get("deliveryForm")),
        validFrom: toUtc(String(formData.get("validFrom"))),
        validUntil: toUtc(String(formData.get("validUntil"))),
      }, listingKey.current);
      listingKey.current = null;
      setNotice("容量已发布到交易市场，成交将锁定这一版价格和交付口径。");
      await load();
    } catch (submitError) {
      setError(marketplaceErrorMessage(submitError, "发布失败，请检查价格、有效期和容量上限。"));
    } finally {
      setBusy(null);
    }
  }

  function beginWithdrawal(lotId: string) {
    setWithdrawLotId(lotId);
    setError("");
    setNotice("");
    queueMicrotask(() => withdrawalReasonRef.current?.focus());
  }

  function cancelWithdrawal() {
    setWithdrawLotId(null);
    withdrawalKey.current = null;
  }

  async function submitWithdrawal(formData: FormData) {
    const lotId = String(formData.get("capacityLotId"));
    const lot = lots.find((item) => item.id === lotId);
    if (!lot || !lot.withdrawalEligibility.eligible || !lot.allowedActions.includes("WITHDRAW")) {
      await load();
      setError("该批次的取出资格已经变化，系统已刷新最新状态。");
      return;
    }

    setBusy("withdraw");
    setError("");
    setNotice("");
    try {
      withdrawalKey.current ??= createIdempotencyKey("capacity-withdrawal");
      await exchangePost<CapacityWithdrawal>(`/api/v1/capacity-lots/${encodeURIComponent(lotId)}/withdraw`, "supplier", {
        expectedVersion: lot.version,
        reason: String(formData.get("reason")),
      }, withdrawalKey.current);
      withdrawalKey.current = null;
      setWithdrawLotId(null);
      setNotice("容量批次已整批取出。资源、验真与账本历史仍然保留。");
      await load();
    } catch (submitError) {
      if (submitError instanceof MarketplaceApiError && submitError.status === 409) {
        withdrawalKey.current = null;
        setWithdrawLotId(null);
        await load();
        setError("批次状态已变化，系统已刷新最新状态；本次没有重复取出。");
      } else {
        setError(marketplaceErrorMessage(submitError, "整批取出失败，请检查原因后重试。"));
      }
    } finally {
      setBusy(null);
    }
  }

  if (loading) return <p className="border-l-2 border-[var(--accent)] pl-4">正在读取供应资源与容量状态…</p>;

  return (
    <div className="grid gap-10">
      <section aria-labelledby="supply-progress-title" className="border-y border-[var(--border)] py-6">
        <div className="flex flex-wrap items-end justify-between gap-5">
          <div>
            <p className="kicker">供应流程</p>
            <h2 id="supply-progress-title" className="m-0 text-2xl">一条资源从申报到可交易</h2>
          </div>
          <button className="button button-secondary" type="button" onClick={() => void load()}>刷新状态</button>
        </div>
        <ol className="mt-6 grid gap-px bg-[var(--border)] md:grid-cols-4">
          {[
            ["01", "资源申报", `${resources.length} 条`],
            ["02", "KAI 验真", `${verifiedResources.length} 条通过`],
            ["03", "容量批次", `${lots.length} 个`],
            ["04", "市场上架", `${lots.filter((item) => item.status === "LISTED").length} 个`],
          ].map(([index, label, value]) => (
            <li key={index} className="list-none bg-[var(--surface)] p-5">
              <span className="font-mono text-sm text-[var(--accent)]">{index}</span>
              <strong className="mt-3 block text-lg text-[var(--ink)]">{label}</strong>
              <span>{value}</span>
            </li>
          ))}
        </ol>
      </section>

      {error ? <div role="alert" className="border-l-4 border-[var(--error)] bg-[var(--error-bg)] p-4 text-[var(--error)]">{error}</div> : null}
      {notice ? <div role="status" className="border-l-4 border-[var(--success)] bg-[var(--success-bg)] p-4 text-[var(--ink)]">{notice}</div> : null}

      <div className="grid gap-12 xl:grid-cols-[minmax(0,1fr)_minmax(360px,.72fr)]">
        <div className="grid gap-12">
          <section aria-labelledby="resource-form-title">
            <p className="kicker">01 / 登记资源</p>
            <h2 id="resource-form-title" className="m-0 text-3xl">登记可交付资源</h2>
            <p className="section-lead">先选择标准产品，再声明实际可交付数量；报价在容量批次核验通过后填写。</p>
            <form action={submitResource} className="form-grid mt-7">
              <label className="field full-span"><span>标准产品版本</span><select name="productVersionId" required value={selectedProductId} onChange={(event) => setSelectedProductId(event.target.value)}>{products.map((product) => <option key={product.id} value={product.id}>{product.displayName}</option>)}</select></label>
              <label className="field full-span"><span>资源名称</span><input name="title" required minLength={4} maxLength={100} placeholder={resourcePlaceholder(selectedProduct?.productCode)} /></label>
              <label className="field"><span>地区</span><select name="region" defaultValue="北京"><option>北京</option><option>上海</option><option>广东</option><option>浙江</option><option>四川</option><option>内蒙古</option></select></label>
              <label className="field"><span>交付形态</span><select key={`delivery-${selectedProductId}`} name="deliveryForm" defaultValue={defaultDeliveryForm(selectedProduct?.productCode)}><option>容器实例</option><option>裸金属</option><option>专属集群</option><option>云主机</option><option>托管模型服务</option><option>专属模型端点</option><option>Token API 服务</option><option>NAS 存储卷</option><option>整柜托管工单</option></select></label>
              <label className="field"><span>总{selectedProductVocabulary?.rateFieldLabel ?? "可交付数量"}{rateUnitHint(selectedProduct?.productCode)}</span><input key={`resource-rate-${selectedProductId}`} name="totalRateUnits" type="number" min={rateInputMinimum(selectedProduct?.productCode)} step={rateInputStep(selectedProduct?.productCode)} required defaultValue={defaultResourceRate(selectedProduct?.productCode)} /></label>
              <label className="field"><span>中断属性</span><select name="interruptibility" defaultValue="NON_INTERRUPTIBLE"><option value="NON_INTERRUPTIBLE">不可中断</option><option value="INTERRUPTIBLE">可中断</option></select></label>
              <label className="field full-span"><span>网络交付范围</span><textarea key={`network-${selectedProductId}`} name="networkScope" required minLength={4} maxLength={500} rows={3} defaultValue={defaultNetworkScope(selectedProduct?.productCode)} /></label>
              <div className="full-span"><button className="button button-primary" disabled={busy !== null}>{busy === "resource" ? "正在登记…" : "提交资源申报"}</button></div>
            </form>
          </section>

          <section aria-labelledby="lot-form-title" className="border-t border-[var(--border)] pt-10">
            <p className="kicker">03 / 划分容量</p>
            <h2 id="lot-form-title" className="m-0 text-3xl">划出连续可售时间窗</h2>
            <p className="section-lead">填写连续可交付的数量和时间。系统自动选用覆盖完整时间窗的最新验真记录。</p>
            {verifiedResources.length === 0 ? (
              <p className="mt-6 bg-[var(--warning-bg)] p-5 text-[var(--warning)]">暂无通过验真的资源。先完成上一步并等待 KAI 运营核验。</p>
            ) : (
              <form action={submitLot} className="form-grid mt-7">
                <label className="field full-span"><span>已验真资源</span><select name="resourceAssetId" required value={selectedResourceId} onChange={(event) => setSelectedResourceId(event.target.value)}>{verifiedResources.map((item) => <option key={item.id} value={item.id}>{item.title} · {formatRateUnits(item.productCode, item.totalRateUnits)}</option>)}</select></label>
                <label className="field"><span>开始时间</span><input name="startAt" type="datetime-local" step="1" required defaultValue={localDateTime(24)} /></label>
                <label className="field"><span>结束时间</span><input name="endAt" type="datetime-local" step="1" required defaultValue={localDateTime(49)} /></label>
                <label className="field"><span>{selectedResource ? capacityDisplay(selectedResource.productCode).rateFieldLabel : "可售数量"}{rateUnitHint(selectedResource?.productCode)}</span><input key={`lot-rate-${selectedResourceId}`} name="rateUnits" type="number" min={rateInputMinimum(selectedResource?.productCode)} max={displayedRateUnits(selectedResource?.productCode, selectedResource?.totalRateUnits)} step={rateInputStep(selectedResource?.productCode)} required defaultValue={String(Math.min(defaultLotRate(selectedResource?.productCode), displayedRateUnits(selectedResource?.productCode, selectedResource?.totalRateUnits) ?? 1))} /></label>
                <label className="field"><span>中断属性</span><select name="interruptibility" defaultValue="NON_INTERRUPTIBLE"><option value="NON_INTERRUPTIBLE">不可中断</option><option value="INTERRUPTIBLE">可中断</option></select></label>
                <div className="full-span"><button className="button button-primary" disabled={busy !== null}>{busy === "lot" ? "正在计算并校验…" : "建立容量批次"}</button></div>
              </form>
            )}
          </section>

          <section aria-labelledby="lot-management-title" className="border-t border-[var(--border)] pt-10" id="capacity-lot-management">
            <p className="kicker">容量批次管理</p>
            <h2 id="lot-management-title" className="m-0 text-3xl">查看状态或整批取出</h2>
            <p className="section-lead">取出资格由服务端根据挂牌、占用和容量账本历史判定。首版只允许从未上架、从未占用的完整空闲批次整批取出。</p>
            {lots.length === 0 ? (
              <p className="mt-6 bg-[var(--info-bg)] p-5">尚未建立容量批次。</p>
            ) : (
              <ul className="mt-7 grid gap-px bg-[var(--border)] p-0">
                {lots.map((lot) => {
                  const confirming = withdrawLotId === lot.id;
                  const withdrawAllowed = lot.withdrawalEligibility.eligible && lot.allowedActions.includes("WITHDRAW");
                  return (
                    <li className="list-none bg-[var(--surface)] p-5 sm:p-6" key={lot.id}>
                      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                          <strong className="block break-words text-lg text-[var(--ink)]">{formatRateUnits(lot.productCode, lot.rateUnits)} · {formatCapacityHours(lot.productCode, lot.capacityBaseUnits)}</strong>
                          <span className="mt-1 block text-sm text-[var(--text)]">{new Date(lot.startAt).toLocaleString("zh-CN")} 至 {new Date(lot.endAt).toLocaleString("zh-CN")}</span>
                          <span className="mt-2 block text-sm text-[var(--muted)]">{statusLabel[lot.status]} · {withdrawalReasonLabel[lot.withdrawalEligibility.reasonCode]}</span>
                        </div>
                        {withdrawAllowed && !confirming ? (
                          <button className="button button-secondary shrink-0" disabled={busy !== null} onClick={() => beginWithdrawal(lot.id)} type="button">整批取出</button>
                        ) : null}
                      </div>
                      {confirming ? (
                        <form action={submitWithdrawal} className="mt-5 border-l-4 border-[var(--warning)] bg-[var(--warning-bg)] p-5">
                          <input name="capacityLotId" type="hidden" value={lot.id} />
                          <strong className="block text-[var(--ink)]">确认取出整个批次</strong>
                          <p className="mb-0 mt-2 text-sm text-[var(--text)]">成功后整个批次变为“已取出”，不能再次上架；不会删除资源、验真和历史记录。</p>
                          <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-3">
                            <div><dt className="text-[var(--muted)]">数量</dt><dd className="m-0 font-semibold text-[var(--ink)]">{formatRateUnits(lot.productCode, lot.rateUnits)}</dd></div>
                            <div><dt className="text-[var(--muted)]">容量</dt><dd className="m-0 font-semibold text-[var(--ink)]">{formatCapacityHours(lot.productCode, lot.capacityBaseUnits)}</dd></div>
                            <div><dt className="text-[var(--muted)]">批次版本</dt><dd className="m-0 font-mono text-[var(--ink)]">v{lot.version}</dd></div>
                          </dl>
                          <label className="field mt-5">
                            <span>取出原因（4–300 字）</span>
                            <textarea maxLength={300} minLength={4} name="reason" ref={withdrawalReasonRef} required rows={3} />
                          </label>
                          <div className="mt-5 flex flex-col gap-3 sm:flex-row">
                            <button className="button button-primary" disabled={busy !== null} type="submit">{busy === "withdraw" ? "正在取出…" : "确认整批取出"}</button>
                            <button className="button button-secondary" disabled={busy !== null} onClick={cancelWithdrawal} type="button">取消</button>
                          </div>
                        </form>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section aria-labelledby="listing-form-title" className="border-t border-[var(--border)] pt-10">
            <p className="kicker">04 / 发布报价</p>
            <h2 id="listing-form-title" className="m-0 text-3xl">发布不可变报价版本</h2>
            <p className="section-lead">单价支持四位小数，成交后锁定这一版本的价格、容量口径和 SLA。</p>
            {readyLots.length === 0 ? (
              <p className="mt-6 bg-[var(--info-bg)] p-5">暂无待上架容量批次。完成连续时间窗划分后再发布。</p>
            ) : (
              <form action={submitListing} className="form-grid mt-7">
                <label className="field full-span"><span>容量批次</span><select name="capacityLotId" required value={selectedLotId} onChange={(event) => setSelectedLotId(event.target.value)}>{readyLots.map((lot) => <option key={lot.id} value={lot.id}>{formatRateUnits(lot.productCode, lot.rateUnits)} · {formatCapacityHours(lot.productCode, lot.capacityBaseUnits)} · {new Date(lot.startAt).toLocaleString("zh-CN")}</option>)}</select></label>
                <label className="field"><span>单价（元 / {selectedLot ? capacityDisplay(selectedLot.productCode).pricingUnitLabel : "容量小时"}）</span><input key={`price-${selectedLotId}`} name="unitPriceYuan" type="number" min="0.000001" step="0.000001" required defaultValue={defaultUnitPrice(selectedLot?.productCode)} />{selectedLot?.productCode === "RACK_SPACE" ? <small>页面会同时显示“柜时单价 × 720”的标准柜月比较值，订单仍按精确服务时间计算。</small> : null}</label>
                <label className="field"><span>最短时长（分钟）</span><input name="minDurationMinutes" type="number" min="1" step="1" required defaultValue="60" /></label>
                <label className="field"><span>最少{selectedLot ? capacityDisplay(selectedLot.productCode).rateFieldLabel : "数量"}{rateUnitHint(selectedLot?.productCode)}</span><input name="minRateUnits" type="number" min={rateInputMinimum(selectedLot?.productCode)} step={rateInputStep(selectedLot?.productCode)} required defaultValue={selectedLot?.productCode === "TOKEN_THROUGHPUT" ? "0.1" : "1"} /></label>
                <label className="field"><span>最多{selectedLot ? capacityDisplay(selectedLot.productCode).rateFieldLabel : "数量"}{rateUnitHint(selectedLot?.productCode)}</span><input key={`max-rate-${selectedLotId}`} name="maxRateUnits" type="number" min={rateInputMinimum(selectedLot?.productCode)} max={displayedRateUnits(selectedLot?.productCode, selectedLot?.rateUnits)} step={rateInputStep(selectedLot?.productCode)} required defaultValue={String(Math.min(defaultLotRate(selectedLot?.productCode), displayedRateUnits(selectedLot?.productCode, selectedLot?.rateUnits) ?? 1))} /></label>
                <label className="field"><span>上架生效时间</span><input name="validFrom" type="datetime-local" step="1" required defaultValue={localDateTime(0)} /></label>
                <label className="field"><span>报价截止时间</span><input name="validUntil" type="datetime-local" step="1" required defaultValue={localDateTime(12)} /></label>
                <label className="field"><span>SLA 可用率（%）</span><input name="availabilityPercent" type="number" min="90" max="100" step="0.01" required defaultValue="99.5" /></label>
                <label className="field"><span>响应时间（分钟）</span><input name="responseMinutes" type="number" min="1" step="1" required defaultValue="30" /></label>
                <label className="field full-span"><span>交付形态</span><select key={`listing-delivery-${selectedLotId}`} name="deliveryForm" defaultValue={defaultDeliveryForm(selectedLot?.productCode)}><option>容器实例</option><option>裸金属</option><option>专属集群</option><option>云主机</option><option>托管模型服务</option><option>专属模型端点</option><option>Token API 服务</option><option>NAS 存储卷</option><option>整柜托管工单</option></select></label>
                <fieldset className="full-span border border-[var(--border)] p-5"><legend className="px-2 font-semibold text-[var(--ink)]">价格包含口径</legend><div className="flex flex-wrap gap-6"><label><input name="taxIncluded" type="checkbox" defaultChecked /> 含税</label><label><input name="energyIncluded" type="checkbox" defaultChecked /> 含电费</label><label><input name="networkIncluded" type="checkbox" defaultChecked /> 含基础网络</label></div></fieldset>
                <label className="field full-span"><span>报价与服务口径</span><textarea key={`scope-${selectedLotId}`} name="scopeNote" required minLength={8} maxLength={1000} rows={3} defaultValue={defaultScopeNote(selectedLot?.productCode)} /></label>
                <div className="full-span"><button className="button button-primary" disabled={busy !== null}>{busy === "listing" ? "正在发布…" : "发布到交易市场"}</button></div>
              </form>
            )}
          </section>
        </div>

        <aside aria-labelledby="resource-ledger-title" className="self-start border-t-4 border-[var(--accent)] bg-[var(--info-bg)] p-6 xl:sticky xl:top-28">
          <h2 id="resource-ledger-title" className="m-0 text-2xl">供应记录</h2>
          <div className="mt-6 grid gap-7">
            <div><h3 className="m-0 text-lg">资源</h3>{resources.length ? <ul className="mt-3 grid gap-3 p-0">{resources.map((item) => <li key={item.id} className="list-none border-b border-[var(--border)] pb-3"><strong className="block text-[var(--ink)]">{item.title}</strong><span>{formatRateUnits(item.productCode, item.totalRateUnits)} · {statusLabel[item.status]}</span></li>)}</ul> : <p>尚未登记资源。</p>}</div>
            <div><h3 className="m-0 text-lg">容量批次</h3>{lots.length ? <ul className="mt-3 grid gap-3 p-0">{lots.map((lot) => <li key={lot.id} className="list-none border-b border-[var(--border)] pb-3"><strong className="block text-[var(--ink)]">{formatRateUnits(lot.productCode, lot.rateUnits)}</strong><span>{formatCapacityHours(lot.productCode, lot.capacityBaseUnits)} · {statusLabel[lot.status]}</span></li>)}</ul> : <p>尚未建立容量批次。</p>}</div>
          </div>
        </aside>
      </div>
    </div>
  );
}
