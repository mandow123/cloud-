"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { createDemoRequestId } from "@/lib/market";
import type { DealMode, PricingUnit, ResourceCategory } from "@/lib/types";

export type RequestPrefill = {
  title?: string;
  category?: ResourceCategory;
  pricingUnit?: PricingUnit;
  region?: string;
};

type RequestWorkbenchProps = {
  initialMode?: DealMode;
  initialPrefill?: RequestPrefill;
};

type ProcurementValues = {
  dealMode: "rental" | "service";
  category: ResourceCategory;
  pricingUnit: PricingUnit;
  quantity: string;
  duration: string;
  region: string;
  deliveryDate: string;
  requirements: string;
  consent: boolean;
};

type SwapValues = {
  offeredCategory: ResourceCategory;
  offeredUnit: PricingUnit;
  offeredQuantity: string;
  offeredDescription: string;
  wantedCategory: ResourceCategory;
  wantedUnit: PricingUnit;
  wantedQuantity: string;
  wantedDescription: string;
  region: string;
  cashDirection: "none" | "offer" | "request";
  cashAmount: string;
  consent: boolean;
};

type LocalRequestRecord = {
  id: string;
  kind: DealMode;
  title: string;
  category: ResourceCategory;
  region: string;
  pricingUnit: PricingUnit;
  quantity: number;
  createdAt: string;
  status: "已记录";
  summary: string;
};

type Confirmation = {
  id: string;
  mode: "procurement" | "swap";
  title: string;
};

const REQUEST_STORAGE_KEY = "kai-cloud-demo-requests-v1";

const categories: Array<{ value: ResourceCategory; label: string }> = [
  { value: "gpu", label: "GPU 算力" },
  { value: "token_model", label: "Token / 模型服务" },
  { value: "rack_capacity", label: "整机柜 / 容量" },
  { value: "cloud_vendor", label: "云厂商资源" },
];

const categoryLabel: Record<ResourceCategory, string> = Object.fromEntries(
  categories.map((category) => [category.value, category.label]),
) as Record<ResourceCategory, string>;

const categoryUnits: Record<ResourceCategory, PricingUnit[]> = {
  gpu: ["卡时", "服务器时", "预留容量时"],
  token_model: ["百万 Token", "模型实例时", "预留容量时"],
  rack_capacity: ["机柜月", "kW 月", "预留容量时"],
  cloud_vendor: ["卡时", "服务器时", "预留容量时"],
};

const regions = ["北京", "上海", "广东", "浙江", "四川", "内蒙古"];

const inputClass =
  "min-h-11 w-full border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2 text-[var(--ink)] placeholder:text-[var(--muted)]";
const fieldLabelClass = "grid gap-1.5 text-sm font-semibold text-[var(--ink)]";

function firstUnit(category: ResourceCategory) {
  return categoryUnits[category][0];
}

function isCompatibleUnit(category: ResourceCategory, unit?: PricingUnit): unit is PricingUnit {
  return Boolean(unit && categoryUnits[category].includes(unit));
}

function validPositive(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0;
}

function persistRequest(record: LocalRequestRecord) {
  try {
    const parsed = JSON.parse(localStorage.getItem(REQUEST_STORAGE_KEY) ?? "[]") as unknown;
    const existing = Array.isArray(parsed) ? parsed : [];
    localStorage.setItem(REQUEST_STORAGE_KEY, JSON.stringify([record, ...existing].slice(0, 20)));
    window.dispatchEvent(new CustomEvent("kai-demo-requests-changed"));
  } catch {
    // Confirmation still works when browser storage is disabled.
  }
}

function ErrorText({ children }: { children?: string }) {
  if (!children) return null;
  return (
    <span className="text-xs font-normal text-[var(--error)]" role="alert">
      {children}
    </span>
  );
}

function UnitOptions({ category }: { category: ResourceCategory }) {
  return categoryUnits[category].map((unit) => (
    <option key={unit} value={unit}>
      {unit}
    </option>
  ));
}

function CategoryOptions() {
  return categories.map((category) => (
    <option key={category.value} value={category.value}>
      {category.label}
    </option>
  ));
}

export function RequestWorkbench({ initialMode = "rental", initialPrefill }: RequestWorkbenchProps) {
  const initialCategory = initialPrefill?.category ?? "gpu";
  const initialUnit = isCompatibleUnit(initialCategory, initialPrefill?.pricingUnit)
    ? initialPrefill.pricingUnit
    : firstUnit(initialCategory);
  const [activeTab, setActiveTab] = useState<"procurement" | "swap">(
    initialMode === "swap" ? "swap" : "procurement",
  );
  const [procurement, setProcurement] = useState<ProcurementValues>({
    dealMode: initialMode === "service" ? "service" : "rental",
    category: initialCategory,
    pricingUnit: initialUnit,
    quantity: "1",
    duration: "24",
    region: initialPrefill?.region ?? "",
    deliveryDate: "",
    requirements: initialPrefill?.title ? `希望获取「${initialPrefill.title}」的标准化演示方案。` : "",
    consent: false,
  });
  const [swap, setSwap] = useState<SwapValues>({
    offeredCategory: initialCategory,
    offeredUnit: initialUnit,
    offeredQuantity: "1",
    offeredDescription: initialPrefill?.title ? `可提供与「${initialPrefill.title}」同类的演示资源。` : "",
    wantedCategory: "token_model",
    wantedUnit: "百万 Token",
    wantedQuantity: "1",
    wantedDescription: "",
    region: initialPrefill?.region ?? "",
    cashDirection: "none",
    cashAmount: "",
    consent: false,
  });
  const [procurementErrors, setProcurementErrors] = useState<Partial<Record<keyof ProcurementValues, string>>>({});
  const [swapErrors, setSwapErrors] = useState<Partial<Record<keyof SwapValues, string>>>({});
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const confirmationRef = useRef<HTMLHeadingElement>(null);
  const procurementTabRef = useRef<HTMLButtonElement>(null);
  const swapTabRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (confirmation) confirmationRef.current?.focus();
  }, [confirmation]);

  const procurementSummary = useMemo(
    () =>
      `${procurement.dealMode === "rental" ? "租赁" : "服务采购"} · ${categoryLabel[procurement.category]} · ${procurement.quantity || "—"} ${procurement.pricingUnit}`,
    [procurement],
  );

  function updateProcurement<Key extends keyof ProcurementValues>(key: Key, value: ProcurementValues[Key]) {
    setProcurement((current) => ({ ...current, [key]: value }));
    setProcurementErrors((current) => ({ ...current, [key]: undefined }));
    setConfirmation(null);
  }

  function updateProcurementCategory(category: ResourceCategory) {
    setProcurement((current) => ({ ...current, category, pricingUnit: firstUnit(category) }));
    setProcurementErrors((current) => ({ ...current, category: undefined, pricingUnit: undefined }));
    setConfirmation(null);
  }

  function updateSwap<Key extends keyof SwapValues>(key: Key, value: SwapValues[Key]) {
    setSwap((current) => ({ ...current, [key]: value }));
    setSwapErrors((current) => ({ ...current, [key]: undefined }));
    setConfirmation(null);
  }

  function updateSwapCategory(side: "offered" | "wanted", category: ResourceCategory) {
    setSwap((current) =>
      side === "offered"
        ? { ...current, offeredCategory: category, offeredUnit: firstUnit(category) }
        : { ...current, wantedCategory: category, wantedUnit: firstUnit(category) },
    );
    setSwapErrors((current) =>
      side === "offered"
        ? { ...current, offeredCategory: undefined, offeredUnit: undefined }
        : { ...current, wantedCategory: undefined, wantedUnit: undefined },
    );
    setConfirmation(null);
  }

  function submitProcurement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors: Partial<Record<keyof ProcurementValues, string>> = {};

    if (!validPositive(procurement.quantity)) nextErrors.quantity = "数量必须大于 0。";
    if (!validPositive(procurement.duration)) nextErrors.duration = "时长必须大于 0。";
    if (!procurement.region) nextErrors.region = "请选择期望区域。";
    if (!procurement.deliveryDate) nextErrors.deliveryDate = "请选择期望开始日期。";
    if (procurement.requirements.trim().length < 8) nextErrors.requirements = "请用至少 8 个字描述交付要求。";
    if (!procurement.consent) nextErrors.consent = "请确认不传输的演示说明。";

    setProcurementErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    const seed = {
      dealMode: procurement.dealMode,
      category: procurement.category,
      pricingUnit: procurement.pricingUnit,
      quantity: procurement.quantity,
      duration: procurement.duration,
      region: procurement.region,
      deliveryDate: procurement.deliveryDate,
      requirements: procurement.requirements.trim(),
    };
    const id = createDemoRequestId(procurement.dealMode, seed);
    persistRequest({
      id,
      kind: procurement.dealMode,
      title: procurementSummary,
      category: procurement.category,
      region: procurement.region,
      pricingUnit: procurement.pricingUnit,
      quantity: Number(procurement.quantity),
      createdAt: new Date().toISOString(),
      status: "已记录",
      summary: procurement.requirements.trim(),
    });
    setConfirmation({ id, mode: "procurement", title: procurementSummary });
  }

  function submitSwap(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors: Partial<Record<keyof SwapValues, string>> = {};

    if (!validPositive(swap.offeredQuantity)) nextErrors.offeredQuantity = "可提供数量必须大于 0。";
    if (swap.offeredDescription.trim().length < 8) nextErrors.offeredDescription = "请用至少 8 个字描述可提供资源。";
    if (!validPositive(swap.wantedQuantity)) nextErrors.wantedQuantity = "期望数量必须大于 0。";
    if (swap.wantedDescription.trim().length < 8) nextErrors.wantedDescription = "请用至少 8 个字描述期望资源。";
    if (!swap.region) nextErrors.region = "请选择期望撮合区域。";
    if (swap.cashDirection !== "none" && !validPositive(swap.cashAmount)) nextErrors.cashAmount = "补差金额必须大于 0。";
    if (!swap.consent) nextErrors.consent = "请确认不传输的演示说明。";

    setSwapErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    const seed = {
      offeredCategory: swap.offeredCategory,
      offeredUnit: swap.offeredUnit,
      offeredQuantity: swap.offeredQuantity,
      offeredDescription: swap.offeredDescription.trim(),
      wantedCategory: swap.wantedCategory,
      wantedUnit: swap.wantedUnit,
      wantedQuantity: swap.wantedQuantity,
      wantedDescription: swap.wantedDescription.trim(),
      region: swap.region,
      cashDirection: swap.cashDirection,
      cashAmount: swap.cashDirection === "none" ? "0" : swap.cashAmount,
    };
    const id = createDemoRequestId("swap", seed);
    const title = `${categoryLabel[swap.offeredCategory]} → ${categoryLabel[swap.wantedCategory]} 双边置换`;
    persistRequest({
      id,
      kind: "swap",
      title,
      category: swap.wantedCategory,
      region: swap.region,
      pricingUnit: swap.wantedUnit,
      quantity: Number(swap.wantedQuantity),
      createdAt: new Date().toISOString(),
      status: "已记录",
      summary: `可提供：${swap.offeredDescription.trim()}；期望：${swap.wantedDescription.trim()}`,
    });
    setConfirmation({ id, mode: "swap", title });
  }

  function chooseTab(tab: "procurement" | "swap") {
    setActiveTab(tab);
    setConfirmation(null);
  }

  function moveTab(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const nextTab = event.key === "ArrowLeft" || event.key === "Home" ? "procurement" : "swap";
    chooseTab(nextTab);
    (nextTab === "procurement" ? procurementTabRef : swapTabRef).current?.focus();
  }

  return (
    <section aria-labelledby="request-workbench-title" className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="min-w-0">
        <div className="mb-6 flex items-center gap-3 text-xs font-semibold text-[var(--muted)]" aria-label="发布流程，共三步">
          <span className="text-[var(--accent)]">01 选择类型</span>
          <span aria-hidden="true">/</span>
          <span>02 描述资源</span>
          <span aria-hidden="true">/</span>
          <span>03 本机确认</span>
        </div>
        <h2 className="sr-only" id="request-workbench-title">
          需求类型与信息表单
        </h2>
        <div aria-label="需求类型" className="grid grid-cols-2 border-b border-[var(--border-strong)]" role="tablist">
          <button
            aria-controls="procurement-panel"
            aria-selected={activeTab === "procurement"}
            className={`min-h-14 border-b-2 px-4 text-left font-semibold ${
              activeTab === "procurement"
                ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--ink)]"
                : "border-transparent bg-[var(--surface)] text-[var(--muted)]"
            }`}
            id="procurement-tab"
            onKeyDown={moveTab}
            onClick={() => chooseTab("procurement")}
            ref={procurementTabRef}
            role="tab"
            tabIndex={activeTab === "procurement" ? 0 : -1}
            type="button"
          >
            租赁 / 服务采购
          </button>
          <button
            aria-controls="swap-panel"
            aria-selected={activeTab === "swap"}
            className={`min-h-14 border-b-2 px-4 text-left font-semibold ${
              activeTab === "swap"
                ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--ink)]"
                : "border-transparent bg-[var(--surface)] text-[var(--muted)]"
            }`}
            id="swap-tab"
            onKeyDown={moveTab}
            onClick={() => chooseTab("swap")}
            ref={swapTabRef}
            role="tab"
            tabIndex={activeTab === "swap" ? 0 : -1}
            type="button"
          >
            双边置换
          </button>
        </div>

        {activeTab === "procurement" ? (
          <div aria-labelledby="procurement-tab" className="border-x border-b border-[var(--border)] bg-[var(--surface)] p-5 sm:p-7" id="procurement-panel" role="tabpanel">
            <form noValidate onSubmit={submitProcurement}>
              <fieldset className="m-0 border-0 p-0">
                <legend className="mb-5 text-xl font-semibold text-[var(--ink)]">需求基础信息</legend>
                <div className="grid gap-5 sm:grid-cols-2">
                  <label className={fieldLabelClass}>
                    交易方式
                    <select
                      className={inputClass}
                      onChange={(event) => updateProcurement("dealMode", event.target.value as "rental" | "service")}
                      value={procurement.dealMode}
                    >
                      <option value="rental">算力租赁</option>
                      <option value="service">服务采购</option>
                    </select>
                  </label>
                  <label className={fieldLabelClass}>
                    资源类型
                    <select
                      className={inputClass}
                      onChange={(event) => updateProcurementCategory(event.target.value as ResourceCategory)}
                      value={procurement.category}
                    >
                      <CategoryOptions />
                    </select>
                  </label>
                  <label className={fieldLabelClass}>
                    计价单位
                    <select
                      className={inputClass}
                      onChange={(event) => updateProcurement("pricingUnit", event.target.value as PricingUnit)}
                      value={procurement.pricingUnit}
                    >
                      <UnitOptions category={procurement.category} />
                    </select>
                  </label>
                  <label className={fieldLabelClass}>
                    需求数量
                    <input
                      aria-invalid={Boolean(procurementErrors.quantity)}
                      className={inputClass}
                      inputMode="decimal"
                      min="0.01"
                      onChange={(event) => updateProcurement("quantity", event.target.value)}
                      step="0.01"
                      type="number"
                      value={procurement.quantity}
                    />
                    <ErrorText>{procurementErrors.quantity}</ErrorText>
                  </label>
                  <label className={fieldLabelClass}>
                    持续时长（小时）
                    <input
                      aria-invalid={Boolean(procurementErrors.duration)}
                      className={inputClass}
                      inputMode="numeric"
                      min="1"
                      onChange={(event) => updateProcurement("duration", event.target.value)}
                      step="1"
                      type="number"
                      value={procurement.duration}
                    />
                    <ErrorText>{procurementErrors.duration}</ErrorText>
                  </label>
                  <label className={fieldLabelClass}>
                    期望区域
                    <select
                      aria-invalid={Boolean(procurementErrors.region)}
                      className={inputClass}
                      onChange={(event) => updateProcurement("region", event.target.value)}
                      value={procurement.region}
                    >
                      <option value="">请选择</option>
                      {regions.map((region) => (
                        <option key={region}>{region}</option>
                      ))}
                    </select>
                    <ErrorText>{procurementErrors.region}</ErrorText>
                  </label>
                  <label className={fieldLabelClass}>
                    期望开始日期
                    <input
                      aria-invalid={Boolean(procurementErrors.deliveryDate)}
                      className={inputClass}
                      onChange={(event) => updateProcurement("deliveryDate", event.target.value)}
                      type="date"
                      value={procurement.deliveryDate}
                    />
                    <ErrorText>{procurementErrors.deliveryDate}</ErrorText>
                  </label>
                  <label className={`${fieldLabelClass} sm:col-span-2`}>
                    交付与 SLA 要求
                    <textarea
                      aria-invalid={Boolean(procurementErrors.requirements)}
                      className={`${inputClass} min-h-28 resize-y`}
                      onChange={(event) => updateProcurement("requirements", event.target.value)}
                      placeholder="例如：支持容器交付，期望 99.9% SLA，需要明确网络费用口径"
                      value={procurement.requirements}
                    />
                    <ErrorText>{procurementErrors.requirements}</ErrorText>
                  </label>
                </div>
              </fieldset>

              <Consent checked={procurement.consent} error={procurementErrors.consent} onChange={(checked) => updateProcurement("consent", checked)} />
              <button className="button button-primary mt-6 w-full sm:w-auto" type="submit">
                生成演示需求
              </button>
            </form>
          </div>
        ) : (
          <div aria-labelledby="swap-tab" className="border-x border-b border-[var(--border)] bg-[var(--surface)] p-5 sm:p-7" id="swap-panel" role="tabpanel">
            <form noValidate onSubmit={submitSwap}>
              <SwapLeg
                category={swap.offeredCategory}
                categoryError={swapErrors.offeredCategory}
                description={swap.offeredDescription}
                descriptionError={swapErrors.offeredDescription}
                heading="我可提供"
                onCategoryChange={(category) => updateSwapCategory("offered", category)}
                onDescriptionChange={(value) => updateSwap("offeredDescription", value)}
                onQuantityChange={(value) => updateSwap("offeredQuantity", value)}
                onUnitChange={(unit) => updateSwap("offeredUnit", unit)}
                quantity={swap.offeredQuantity}
                quantityError={swapErrors.offeredQuantity}
                side="offered"
                unit={swap.offeredUnit}
              />
              <div aria-hidden="true" className="my-5 text-center text-xl font-semibold text-[var(--accent)]">
                置换为
              </div>
              <SwapLeg
                category={swap.wantedCategory}
                categoryError={swapErrors.wantedCategory}
                description={swap.wantedDescription}
                descriptionError={swapErrors.wantedDescription}
                heading="我需要"
                onCategoryChange={(category) => updateSwapCategory("wanted", category)}
                onDescriptionChange={(value) => updateSwap("wantedDescription", value)}
                onQuantityChange={(value) => updateSwap("wantedQuantity", value)}
                onUnitChange={(unit) => updateSwap("wantedUnit", unit)}
                quantity={swap.wantedQuantity}
                quantityError={swapErrors.wantedQuantity}
                side="wanted"
                unit={swap.wantedUnit}
              />

              <fieldset className="mt-6 border-0 border-t border-[var(--border)] p-0 pt-6">
                <legend className="text-lg font-semibold text-[var(--ink)]">撮合条件</legend>
                <div className="mt-4 grid gap-5 sm:grid-cols-2">
                  <label className={fieldLabelClass}>
                    期望区域
                    <select
                      aria-invalid={Boolean(swapErrors.region)}
                      className={inputClass}
                      onChange={(event) => updateSwap("region", event.target.value)}
                      value={swap.region}
                    >
                      <option value="">请选择</option>
                      {regions.map((region) => (
                        <option key={region}>{region}</option>
                      ))}
                    </select>
                    <ErrorText>{swapErrors.region}</ErrorText>
                  </label>
                  <label className={fieldLabelClass}>
                    现金补差
                    <select
                      className={inputClass}
                      onChange={(event) => updateSwap("cashDirection", event.target.value as SwapValues["cashDirection"])}
                      value={swap.cashDirection}
                    >
                      <option value="none">不设置</option>
                      <option value="offer">我方可补差</option>
                      <option value="request">期望对方补差</option>
                    </select>
                  </label>
                  {swap.cashDirection !== "none" ? (
                    <label className={fieldLabelClass}>
                      补差上限（人民币元）
                      <input
                        aria-invalid={Boolean(swapErrors.cashAmount)}
                        className={inputClass}
                        inputMode="decimal"
                        min="0.01"
                        onChange={(event) => updateSwap("cashAmount", event.target.value)}
                        step="0.01"
                        type="number"
                        value={swap.cashAmount}
                      />
                      <ErrorText>{swapErrors.cashAmount}</ErrorText>
                    </label>
                  ) : null}
                </div>
              </fieldset>

              <Consent checked={swap.consent} error={swapErrors.consent} onChange={(checked) => updateSwap("consent", checked)} />
              <button className="button button-primary mt-6 w-full sm:w-auto" type="submit">
                生成演示置换需求
              </button>
            </form>
          </div>
        )}

        {confirmation ? <RequestConfirmation confirmation={confirmation} headingRef={confirmationRef} /> : null}
      </div>

      <aside className="self-start border-t-2 border-[var(--accent)] bg-[var(--info-bg)] p-5 lg:sticky lg:top-28">
        <p className="kicker">Before you start</p>
        <h2 className="m-0 text-xl">这不是正式询价</h2>
        <ul className="mt-4 grid gap-3 pl-5 text-sm text-[var(--text)]">
          <li>输入只在本机生成演示记录，不发送到 KAI 或供应商。</li>
          <li>不要填写姓名、手机号、公司机密、账号或访问密钥。</li>
          <li>演示报价不是要约，也不会触发合同、支付或资源开通。</li>
        </ul>
        {initialPrefill?.title ? (
          <div className="mt-5 border-t border-[var(--border)] pt-4 text-sm">
            <span className="block text-xs text-[var(--muted)]">已从资源页预填</span>
            <strong className="mt-1 block text-[var(--ink)]">{initialPrefill.title}</strong>
          </div>
        ) : null}
      </aside>
    </section>
  );
}

function Consent({ checked, error, onChange }: { checked: boolean; error?: string; onChange: (checked: boolean) => void }) {
  return (
    <label className="mt-6 flex items-start gap-3 border border-[var(--border)] bg-[var(--info-bg)] p-4 text-sm text-[var(--text)]">
      <input
        checked={checked}
        className="mt-1 size-4 shrink-0 accent-[var(--brand)]"
        onChange={(event) => onChange(event.target.checked)}
        type="checkbox"
      />
      <span>
        我确认这是不传输的演示提交；输入只保存在当前浏览器，并且不含真实个人资料、商业机密或访问凭据。
        <ErrorText>{error}</ErrorText>
      </span>
    </label>
  );
}

type SwapLegProps = {
  side: "offered" | "wanted";
  heading: string;
  category: ResourceCategory;
  categoryError?: string;
  unit: PricingUnit;
  quantity: string;
  quantityError?: string;
  description: string;
  descriptionError?: string;
  onCategoryChange: (category: ResourceCategory) => void;
  onUnitChange: (unit: PricingUnit) => void;
  onQuantityChange: (value: string) => void;
  onDescriptionChange: (value: string) => void;
};

function SwapLeg(props: SwapLegProps) {
  return (
    <fieldset className="m-0 border border-[var(--border)] bg-[var(--canvas)] p-4 sm:p-5">
      <legend className="px-2 text-xl font-semibold text-[var(--ink)]">{props.heading}</legend>
      <div className="grid gap-5 sm:grid-cols-2">
        <label className={fieldLabelClass}>
          资源类型
          <select
            aria-invalid={Boolean(props.categoryError)}
            className={inputClass}
            onChange={(event) => props.onCategoryChange(event.target.value as ResourceCategory)}
            value={props.category}
          >
            <CategoryOptions />
          </select>
          <ErrorText>{props.categoryError}</ErrorText>
        </label>
        <label className={fieldLabelClass}>
          计价单位
          <select className={inputClass} onChange={(event) => props.onUnitChange(event.target.value as PricingUnit)} value={props.unit}>
            <UnitOptions category={props.category} />
          </select>
        </label>
        <label className={fieldLabelClass}>
          数量
          <input
            aria-invalid={Boolean(props.quantityError)}
            className={inputClass}
            inputMode="decimal"
            min="0.01"
            onChange={(event) => props.onQuantityChange(event.target.value)}
            step="0.01"
            type="number"
            value={props.quantity}
          />
          <ErrorText>{props.quantityError}</ErrorText>
        </label>
        <label className={`${fieldLabelClass} sm:col-span-2`}>
          规格、容量与交付边界
          <textarea
            aria-invalid={Boolean(props.descriptionError)}
            className={`${inputClass} min-h-24 resize-y`}
            onChange={(event) => props.onDescriptionChange(event.target.value)}
            placeholder={props.side === "offered" ? "描述可提供的型号、容量、可用时段和交付形态" : "描述期望获得的型号、容量、时段和 SLA"}
            value={props.description}
          />
          <ErrorText>{props.descriptionError}</ErrorText>
        </label>
      </div>
    </fieldset>
  );
}

function RequestConfirmation({ confirmation, headingRef }: { confirmation: Confirmation; headingRef: React.RefObject<HTMLHeadingElement | null> }) {
  return (
    <section aria-live="polite" className="mt-8 border-t-2 border-[var(--success)] bg-[var(--success-bg)] p-5 sm:p-7" role="status">
      <p className="kicker">Demo confirmed</p>
      <h2 className="m-0 text-2xl" ref={headingRef} tabIndex={-1}>
        演示需求已记录
      </h2>
      <p className="mt-2 text-sm text-[var(--text)]">{confirmation.title}</p>
      <div className="mt-5 flex flex-wrap items-baseline justify-between gap-3 border-y border-[var(--border)] py-4">
        <span className="text-xs font-semibold text-[var(--muted)]">本机演示编号</span>
        <strong className="font-mono text-lg text-[var(--ink)]">{confirmation.id}</strong>
      </div>
      <ol className="mt-6 grid gap-0" aria-label="演示处理状态">
        {[
          ["已记录", "刚刚", "表单已写入当前浏览器。"],
          ["KAI 标准化", "下一步（演示）", confirmation.mode === "swap" ? "整理双边资源的容量与补差口径。" : "整理计价、SLA 与交付口径。"],
          ["方案待确认", "匹配后（演示）", "展示标准化方案；不会联系真实供应商。"],
        ].map(([status, time, description], index) => (
          <li className="grid grid-cols-[18px_1fr] gap-3" key={status}>
            <span className="relative flex justify-center" aria-hidden="true">
              <span className={`mt-1 size-2.5 rounded-full ${index === 0 ? "bg-[var(--success)]" : "border border-[var(--border-strong)] bg-[var(--surface)]"}`} />
              {index < 2 ? <span className="absolute bottom-0 top-4 w-px bg-[var(--border-strong)]" /> : null}
            </span>
            <div className="pb-5">
              <div className="flex flex-wrap justify-between gap-2">
                <strong className="text-sm text-[var(--ink)]">{status}</strong>
                <span className="text-xs text-[var(--muted)]">{time}</span>
              </div>
              <p className="mb-0 mt-1 text-sm text-[var(--text)]">{description}</p>
            </div>
          </li>
        ))}
      </ol>
      <p className="m-0 border-t border-[var(--border)] pt-4 text-xs text-[var(--muted)]">刷新页面后确认区会消失；会员中心可读取本机保存的演示记录。</p>
    </section>
  );
}
