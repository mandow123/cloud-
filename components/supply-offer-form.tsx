"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import type { FormEvent } from "react";
import { createIdempotencyKey, marketplaceErrorMessage } from "@/lib/client/marketplace-client";
import {
  createSupplyOffer,
  supplyApiUnavailable,
  type SupplyOffer,
  type SupplyPricingUnit,
  type SupplyQuantityUnit,
  type SupplyResourceType,
  type SupplySupplierType,
} from "@/components/supply-api-client";

const supplierTypes: Array<{ value: SupplySupplierType; label: string }> = [
  { value: "INDIVIDUAL", label: "个人供应方" },
  { value: "COMPANY", label: "企业供应方" },
  { value: "IDC", label: "IDC / 数据中心" },
  { value: "CLOUD_VENDOR", label: "云厂商" },
];

const resourceTypes: Array<{ value: SupplyResourceType; label: string }> = [
  { value: "GPU_CARD", label: "GPU 显卡" },
  { value: "GPU_SERVER", label: "GPU 服务器 / 整机" },
  { value: "CPU_SERVER", label: "CPU 服务器" },
  { value: "MAC_COMPUTE", label: "Mac 算力" },
  { value: "TOKEN_CAPACITY", label: "Token 容量" },
  { value: "MODEL_INSTANCE", label: "模型实例" },
  { value: "NAS_STORAGE", label: "NAS 存储" },
  { value: "RACK_CAPACITY", label: "机柜容量" },
  { value: "CLOUD_RESOURCE", label: "云厂商资源" },
];

const defaults: Record<SupplyResourceType, { product: string; specification: string }> = {
  GPU_CARD: { product: "例如 NVIDIA L40S", specification: "例如 显存 48GB；PCIe；单卡交付；驱动与 CUDA 版本" },
  GPU_SERVER: { product: "例如 4×RTX 4090 GPU 服务器", specification: "例如 GPU 型号及数量、显存、互联拓扑、CPU、内存、存储与网络" },
  CPU_SERVER: { product: "例如 双路 EPYC 9654 服务器", specification: "例如 CPU 型号与核心数、内存、存储、网络和虚拟化方式" },
  MAC_COMPUTE: { product: "例如 Mac mini M4 Pro", specification: "例如 芯片、统一内存、存储、macOS 版本和网络" },
  TOKEN_CAPACITY: { product: "例如 推理 Token 容量", specification: "例如 模型范围、输入输出口径、并发、限速和有效期" },
  MODEL_INSTANCE: { product: "例如 Qwen 推理实例", specification: "例如 模型版本、上下文长度、并发、吞吐和接口协议" },
  NAS_STORAGE: { product: "例如 高性能 NAS 容量", specification: "例如 可用容量、协议、吞吐、IOPS、冗余与备份策略" },
  RACK_CAPACITY: { product: "例如 20kW 高功率机柜", specification: "例如 U 位、功率、制冷、网络、PUE 和机房等级" },
  CLOUD_RESOURCE: { product: "例如 云厂商资源包", specification: "例如 云厂商、资源 SKU、地域、配额、期限和交付方式" },
};

type UnitPair = { quantityUnit: SupplyQuantityUnit; pricingUnit: SupplyPricingUnit; label: string };
const units: Record<SupplyResourceType, UnitPair[]> = {
  GPU_CARD: [{ quantityUnit: "CARD", pricingUnit: "CARD_HOUR", label: "卡 / 卡时" }],
  GPU_SERVER: [{ quantityUnit: "NODE", pricingUnit: "NODE_HOUR", label: "节点 / 节点时" }],
  CPU_SERVER: [{ quantityUnit: "SERVER", pricingUnit: "SERVER_HOUR", label: "服务器 / 服务器时" }],
  MAC_COMPUTE: [{ quantityUnit: "NODE", pricingUnit: "NODE_HOUR", label: "节点 / 节点时" }],
  TOKEN_CAPACITY: [{ quantityUnit: "M_TOKENS_PER_HOUR", pricingUnit: "TOKEN_CAPACITY_HOUR", label: "百万 Token/小时 / 容量时" }],
  MODEL_INSTANCE: [{ quantityUnit: "MODEL_INSTANCE", pricingUnit: "MODEL_INSTANCE_HOUR", label: "模型实例 / 实例时" }],
  NAS_STORAGE: [{ quantityUnit: "TIB", pricingUnit: "TIB_HOUR", label: "TiB / TiB时" }],
  RACK_CAPACITY: [
    { quantityUnit: "RACK", pricingUnit: "RACK_MONTH", label: "整柜 / 柜月" },
    { quantityUnit: "KW", pricingUnit: "KW_MONTH", label: "功率 kW / kW月" },
  ],
  CLOUD_RESOURCE: [{ quantityUnit: "QUOTA_UNIT", pricingUnit: "QUOTA_HOUR", label: "配额单位 / 配额时" }],
};

const regions = ["全国", "华北", "华东", "华南", "西南", "西北", "海外"];
const deliveryForms = ["平台账号交付", "独占 SSH", "API 调用", "专线 / VPN", "控制台授权", "线下机房交付", "其他（见备注）"];

function optionalIso(value: string) {
  return value ? new Date(value).toISOString() : undefined;
}

export function SupplyOfferForm() {
  const [supplierType, setSupplierType] = useState<SupplySupplierType>("COMPANY");
  const [resourceType, setResourceType] = useState<SupplyResourceType>("GPU_SERVER");
  const [productName, setProductName] = useState("");
  const [specification, setSpecification] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [quantityUnit, setQuantityUnit] = useState<SupplyQuantityUnit>(units.GPU_SERVER[0].quantityUnit);
  const [pricingUnit, setPricingUnit] = useState<SupplyPricingUnit>(units.GPU_SERVER[0].pricingUnit);
  const [region, setRegion] = useState("全国");
  const [deliveryForm, setDeliveryForm] = useState("平台账号交付");
  const [availabilityStartAt, setAvailabilityStartAt] = useState("");
  const [availabilityEndAt, setAvailabilityEndAt] = useState("");
  const [notes, setNotes] = useState("");
  const [offer, setOffer] = useState<SupplyOffer | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const mutationKey = useRef(createIdempotencyKey("general-offer"));

  function changeResourceType(next: SupplyResourceType) {
    setResourceType(next);
    setQuantityUnit(units[next][0].quantityUnit);
    setPricingUnit(units[next][0].pricingUnit);
  }

  function changeUnits(value: string) {
    const pair = units[resourceType].find((item) => `${item.quantityUnit}:${item.pricingUnit}` === value);
    if (!pair) return;
    setQuantityUnit(pair.quantityUnit);
    setPricingUnit(pair.pricingUnit);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const parsedQuantity = Number(quantity);
    if (productName.trim().length < 2 || specification.trim().length < 2) {
      setError("请完整填写产品名称和规格说明。");
      return;
    }
    if (!Number.isInteger(parsedQuantity) || parsedQuantity < 1 || parsedQuantity > 100_000) {
      setError("数量必须是 1–100000 之间的整数。");
      return;
    }
    if (Boolean(availabilityStartAt) !== Boolean(availabilityEndAt)) {
      setError("可用开始时间与结束时间需要同时填写，或同时留空。");
      return;
    }
    if (availabilityStartAt && availabilityEndAt && Date.parse(availabilityEndAt) <= Date.parse(availabilityStartAt)) {
      setError("可用结束时间必须晚于开始时间。");
      return;
    }

    setBusy(true);
    try {
      const result = await createSupplyOffer({
        supplierType,
        resourceType,
        productName: productName.trim(),
        specification: specification.trim(),
        quantity: parsedQuantity,
        quantityUnit,
        pricingUnit,
        region,
        deliveryForm,
        ...(availabilityStartAt ? { availabilityStartAt: optionalIso(availabilityStartAt) } : {}),
        ...(availabilityEndAt ? { availabilityEndAt: optionalIso(availabilityEndAt) } : {}),
        notes: notes.trim() || null,
      }, mutationKey.current);
      setOffer(result.record);
    } catch (submitError) {
      setError(supplyApiUnavailable(submitError)
        ? "通用上架 API 尚未就绪，本页没有保存或生成任何假记录。"
        : marketplaceErrorMessage(submitError, "资源上架未完成，请核对填写内容后重试。"));
    } finally {
      setBusy(false);
    }
  }

  const selected = defaults[resourceType];

  return (
    <div className="shell py-10 sm:py-14">
      <div className="grid items-start gap-8 xl:grid-cols-[minmax(0,1fr)_340px]">
        <section className="border-t-4 border-[var(--accent)] bg-[var(--surface)] p-6 ring-1 ring-[var(--border)] sm:p-8" aria-labelledby="offer-form-title">
          <p className="kicker">General supply offer</p>
          <h2 className="m-0 text-3xl" id="offer-form-title">提交上架申请</h2>
          <p className="section-lead text-base">个人、企业、IDC 与云厂商均可申报；本阶段只收集资源信息并进入管理员人工审核，不要求安装 Agent 或完成设备验真。</p>

          {error ? <div className="mt-5 border-l-4 border-[var(--error)] bg-[var(--error-bg)] p-4 text-sm text-[var(--error)]" role="alert">{error}</div> : null}
          {offer ? (
            <div className="mt-5 border-l-4 border-[var(--success)] bg-[var(--success-bg)] p-5" role="status">
              <strong className="block text-[var(--ink)]">管理员已收到上架申请</strong>
              <span className="mt-1 block font-mono text-sm">{offer.id}{offer.status ? ` · ${offer.status}` : ""}</span>
              <p className="mb-0 mt-2 text-sm">记录已经写入服务端数据库；这不代表已公开挂牌或已成交。</p>
            </div>
          ) : null}

          <form className="mt-7 grid gap-5 md:grid-cols-2" noValidate onSubmit={submit}>
            <label className="field">
              <span>供应方身份</span>
              <select onChange={(event) => setSupplierType(event.target.value as SupplySupplierType)} value={supplierType}>
                {supplierTypes.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
            </label>
            <label className="field">
              <span>资源类型</span>
              <select onChange={(event) => changeResourceType(event.target.value as SupplyResourceType)} value={resourceType}>
                {resourceTypes.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
            </label>
            <label className="field md:col-span-2">
              <span>产品 / 资源名称</span>
              <input maxLength={120} minLength={2} onChange={(event) => setProductName(event.target.value)} placeholder={selected.product} required value={productName} />
            </label>
            <label className="field md:col-span-2">
              <span>规格说明</span>
              <textarea maxLength={2000} minLength={4} onChange={(event) => setSpecification(event.target.value)} placeholder={selected.specification} required rows={5} value={specification} />
            </label>
            <label className="field">
              <span>可供数量</span>
              <input max="100000" min="1" onChange={(event) => setQuantity(event.target.value)} required step="1" type="number" value={quantity} />
            </label>
            <label className="field">
              <span>数量 / 计价口径</span>
              <select onChange={(event) => changeUnits(event.target.value)} value={`${quantityUnit}:${pricingUnit}`}>
                {units[resourceType].map((item) => <option key={item.label} value={`${item.quantityUnit}:${item.pricingUnit}`}>{item.label}</option>)}
              </select>
              <small className="text-[var(--muted)]">接口值：{quantityUnit} / {pricingUnit}</small>
            </label>
            <label className="field">
              <span>资源地区</span>
              <select onChange={(event) => setRegion(event.target.value)} value={region}>{regions.map((item) => <option key={item}>{item}</option>)}</select>
            </label>
            <label className="field md:col-span-2">
              <span>交付方式</span>
              <select onChange={(event) => setDeliveryForm(event.target.value)} value={deliveryForm}>{deliveryForms.map((item) => <option key={item}>{item}</option>)}</select>
            </label>
            <label className="field">
              <span>可用开始时间（可选）</span>
              <input onChange={(event) => setAvailabilityStartAt(event.target.value)} type="datetime-local" value={availabilityStartAt} />
            </label>
            <label className="field">
              <span>可用结束时间（可选）</span>
              <input onChange={(event) => setAvailabilityEndAt(event.target.value)} type="datetime-local" value={availabilityEndAt} />
            </label>
            <label className="field md:col-span-2">
              <span>补充说明</span>
              <textarea maxLength={2000} onChange={(event) => setNotes(event.target.value)} placeholder="例如最低起售量、网络边界、维护窗口或资质说明；不要填写密码、私钥。" rows={4} value={notes} />
            </label>
            <div className="md:col-span-2 flex flex-wrap items-center gap-3">
              <button className="button button-primary" disabled={busy || Boolean(offer)} type="submit">{busy ? "正在提交…" : offer ? "已提交服务端" : "提交上架申请"}</button>
              <Link className="button button-secondary" href="/supply/applications">查看申请记录</Link>
            </div>
          </form>
        </section>

        <aside className="border-t-4 border-[var(--border-strong)] bg-[var(--info-bg)] p-6 xl:sticky xl:top-28" aria-labelledby="offer-boundary-title">
          <p className="kicker">Declaration boundary</p>
          <h2 className="m-0 text-2xl" id="offer-boundary-title">本次只登记供给</h2>
          <ul className="mt-5 grid gap-3 pl-5 text-sm text-[var(--text)]">
            <li>交易方式暂不选择，提交后不会自动成交。</li>
            <li>计价单位用于表达报价口径，不代替后续价格审核。</li>
            <li>本次提交不要求安装 Agent，也不会自动发起硬件验真。</li>
            <li>管理员可在后台查看组织、账号、规格、数量和备注。</li>
            <li>接口缺失或请求失败时不在浏览器生成假记录。</li>
          </ul>
        </aside>
      </div>
    </div>
  );
}
