"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import {
  createIdempotencyKey,
  MarketplaceApiError,
  marketplaceErrorMessage,
  marketplacePost,
} from "@/lib/client/marketplace-client";
import {
  marketplaceRegions,
  type MarketplaceRegion,
  type MarketplaceRequestRecord,
} from "@/lib/marketplace";
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

type Confirmation = {
  id: string;
  mode: "procurement" | "swap";
  title: string;
};

const categories: Array<{ value: ResourceCategory; label: string }> = [
  { value: "gpu", label: "GPU 算力" },
  { value: "token_model", label: "Token / 模型服务" },
  { value: "rack_capacity", label: "整机柜 / 容量" },
  { value: "cloud_vendor", label: "云厂商资源" },
];

const categoryUnits: Record<ResourceCategory, PricingUnit[]> = {
  gpu: ["卡时", "服务器时", "预留容量时"],
  token_model: ["百万 Token", "模型实例时", "预留容量时"],
  rack_capacity: ["机柜月", "kW 月", "预留容量时"],
  cloud_vendor: ["卡时", "服务器时", "预留容量时"],
};

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

function validCardHourAmount(value: string) {
  const normalized = value.trim();
  return /^\d{1,9}(?:\.\d{1,2})?$/u.test(normalized) && Number(normalized) > 0;
}

function durationConfig(unit: PricingUnit) {
  if (unit === "百万 Token") {
    return {
      required: false,
      label: "无需另填时长",
      defaultValue: "",
      help: "数量请直接按百万 Token 填写；服务端不会换算或提交小时数。",
    };
  }
  if (unit === "机柜月" || unit === "kW 月") {
    return {
      required: false,
      label: "无需另填时长",
      defaultValue: "",
      help: `数量请直接按${unit}填写；服务端不会换算或提交小时数。`,
    };
  }
  return {
    required: true,
    label: "持续时长（小时）",
    defaultValue: "24",
    help: "仅小时类计价单位需要填写，提交值保持小时口径。",
  };
}

function ErrorText({ children, id }: { children?: string; id?: string }) {
  if (!children) return null;
  return (
    <span className="text-xs font-normal text-[var(--error)]" id={id} role="alert">
      {children}
    </span>
  );
}

function focusFirstInvalid(form: HTMLFormElement | null) {
  window.requestAnimationFrame(() => form?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
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
  const initialRegion = marketplaceRegions.includes(initialPrefill?.region as MarketplaceRegion)
    ? initialPrefill?.region as MarketplaceRegion
    : "";
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
    duration: durationConfig(initialUnit).defaultValue,
    region: initialRegion,
    deliveryDate: "",
    requirements: initialPrefill?.title ? `希望获取「${initialPrefill.title}」的标准化报价方案。` : "",
    consent: false,
  });
  const [swap, setSwap] = useState<SwapValues>({
    offeredCategory: initialCategory,
    offeredUnit: initialUnit,
    offeredQuantity: "1",
    offeredDescription: initialPrefill?.title ? `可提供与「${initialPrefill.title}」同类的资源，具体容量待确认。` : "",
    wantedCategory: "token_model",
    wantedUnit: "百万 Token",
    wantedQuantity: "1",
    wantedDescription: "",
    region: initialRegion,
    cashDirection: "none",
    cashAmount: "",
    consent: false,
  });
  const [procurementErrors, setProcurementErrors] = useState<Partial<Record<keyof ProcurementValues, string>>>({});
  const [swapErrors, setSwapErrors] = useState<Partial<Record<keyof SwapValues, string>>>({});
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const confirmationRef = useRef<HTMLHeadingElement>(null);
  const procurementTabRef = useRef<HTMLButtonElement>(null);
  const swapTabRef = useRef<HTMLButtonElement>(null);
  const procurementFormRef = useRef<HTMLFormElement>(null);
  const swapFormRef = useRef<HTMLFormElement>(null);
  const procurementKeyRef = useRef<string | null>(null);
  const swapKeyRef = useRef<string | null>(null);
  const submissionLockRef = useRef(false);

  useEffect(() => {
    if (confirmation) confirmationRef.current?.focus();
  }, [confirmation]);

  function updateProcurement<Key extends keyof ProcurementValues>(key: Key, value: ProcurementValues[Key]) {
    setProcurement((current) => ({ ...current, [key]: value }));
    setProcurementErrors((current) => ({ ...current, [key]: undefined }));
    procurementKeyRef.current = null;
    setServerError(null);
    setConfirmation(null);
  }

  function updateProcurementCategory(category: ResourceCategory) {
    const pricingUnit = firstUnit(category);
    setProcurement((current) => ({
      ...current,
      category,
      pricingUnit,
      duration: durationConfig(pricingUnit).defaultValue,
    }));
    setProcurementErrors((current) => ({ ...current, category: undefined, pricingUnit: undefined }));
    procurementKeyRef.current = null;
    setServerError(null);
    setConfirmation(null);
  }

  function updateProcurementUnit(pricingUnit: PricingUnit) {
    setProcurement((current) => ({
      ...current,
      pricingUnit,
      duration: durationConfig(pricingUnit).defaultValue,
    }));
    setProcurementErrors((current) => ({ ...current, pricingUnit: undefined, duration: undefined }));
    procurementKeyRef.current = null;
    setServerError(null);
    setConfirmation(null);
  }

  function updateSwap<Key extends keyof SwapValues>(key: Key, value: SwapValues[Key]) {
    setSwap((current) => ({ ...current, [key]: value }));
    setSwapErrors((current) => ({ ...current, [key]: undefined }));
    swapKeyRef.current = null;
    setServerError(null);
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
    swapKeyRef.current = null;
    setServerError(null);
    setConfirmation(null);
  }

  async function submitProcurement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submissionLockRef.current) return;
    const nextErrors: Partial<Record<keyof ProcurementValues, string>> = {};
    const duration = durationConfig(procurement.pricingUnit);

    if (!validPositive(procurement.quantity)) nextErrors.quantity = "数量必须大于 0。";
    if (duration.required && !validPositive(procurement.duration)) nextErrors.duration = "持续时长必须大于 0 小时。";
    if (!procurement.region) nextErrors.region = "请选择期望区域。";
    if (!procurement.deliveryDate) nextErrors.deliveryDate = "请选择期望开始日期。";
    if (procurement.requirements.trim().length < 8) nextErrors.requirements = "请用至少 8 个字描述交付要求。";
    if (!procurement.consent) nextErrors.consent = "请确认服务器提交说明。";

    setProcurementErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      focusFirstInvalid(procurementFormRef.current);
      return;
    }

    submissionLockRef.current = true;
    setSubmitting(true);
    setServerError(null);
    try {
      const idempotencyKey = procurementKeyRef.current ?? createIdempotencyKey("request-procurement");
      procurementKeyRef.current = idempotencyKey;
      const { record } = await marketplacePost<MarketplaceRequestRecord>(
        "/api/requests",
        {
          requestType: "procurement",
          dealMode: procurement.dealMode,
          category: procurement.category,
          pricingUnit: procurement.pricingUnit,
          quantity: Number(procurement.quantity),
          durationHours: duration.required ? Number(procurement.duration) : null,
          region: procurement.region,
          deliveryDate: procurement.deliveryDate,
          requirements: procurement.requirements.trim(),
        },
        idempotencyKey,
      );
      procurementKeyRef.current = null;
      setConfirmation({ id: record.id, mode: "procurement", title: record.title });
      window.dispatchEvent(new CustomEvent("kai-server-records-changed"));
    } catch (error) {
      const message = marketplaceErrorMessage(error, "需求服务暂时不可用，请稍后再试。");
      const fieldMap: Record<string, keyof ProcurementValues> = {
        dealMode: "dealMode",
        category: "category",
        pricingUnit: "pricingUnit",
        quantity: "quantity",
        durationHours: "duration",
        region: "region",
        deliveryDate: "deliveryDate",
        requirements: "requirements",
      };
      const field = error instanceof MarketplaceApiError && error.field ? fieldMap[error.field] : undefined;
      if (field) {
        setProcurementErrors((current) => ({ ...current, [field]: message }));
        focusFirstInvalid(procurementFormRef.current);
      } else {
        setServerError(message);
      }
    } finally {
      submissionLockRef.current = false;
      setSubmitting(false);
    }
  }

  async function submitSwap(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submissionLockRef.current) return;
    const nextErrors: Partial<Record<keyof SwapValues, string>> = {};

    if (!validPositive(swap.offeredQuantity)) nextErrors.offeredQuantity = "可提供数量必须大于 0。";
    if (swap.offeredDescription.trim().length < 8) nextErrors.offeredDescription = "请用至少 8 个字描述可提供资源。";
    if (!validPositive(swap.wantedQuantity)) nextErrors.wantedQuantity = "期望数量必须大于 0。";
    if (swap.wantedDescription.trim().length < 8) nextErrors.wantedDescription = "请用至少 8 个字描述期望资源。";
    if (!swap.region) nextErrors.region = "请选择期望撮合区域。";
    if (swap.cashDirection !== "none" && !validCardHourAmount(swap.cashAmount)) {
      nextErrors.cashAmount = "补差上限必须是大于 0 且最多两位小数的 KAI 标准卡时。";
    }
    if (!swap.consent) nextErrors.consent = "请确认服务器提交说明。";

    setSwapErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      focusFirstInvalid(swapFormRef.current);
      return;
    }

    submissionLockRef.current = true;
    setSubmitting(true);
    setServerError(null);
    try {
      const idempotencyKey = swapKeyRef.current ?? createIdempotencyKey("request-swap");
      swapKeyRef.current = idempotencyKey;
      const { record } = await marketplacePost<MarketplaceRequestRecord>(
        "/api/requests",
        {
          requestType: "swap",
          offered: {
            category: swap.offeredCategory,
            pricingUnit: swap.offeredUnit,
            quantity: Number(swap.offeredQuantity),
            description: swap.offeredDescription.trim(),
          },
          wanted: {
            category: swap.wantedCategory,
            pricingUnit: swap.wantedUnit,
            quantity: Number(swap.wantedQuantity),
            description: swap.wantedDescription.trim(),
          },
          region: swap.region,
          cashDirection: swap.cashDirection,
          cashAmount: swap.cashDirection === "none" ? null : Number(swap.cashAmount),
        },
        idempotencyKey,
      );
      swapKeyRef.current = null;
      setConfirmation({ id: record.id, mode: "swap", title: record.title });
      window.dispatchEvent(new CustomEvent("kai-server-records-changed"));
    } catch (error) {
      const message = marketplaceErrorMessage(error, "需求服务暂时不可用，请稍后再试。");
      const fieldMap: Record<string, keyof SwapValues> = {
        "offered.category": "offeredCategory",
        "offered.pricingUnit": "offeredUnit",
        "offered.quantity": "offeredQuantity",
        "offered.description": "offeredDescription",
        "wanted.category": "wantedCategory",
        "wanted.pricingUnit": "wantedUnit",
        "wanted.quantity": "wantedQuantity",
        "wanted.description": "wantedDescription",
        region: "region",
        cashDirection: "cashDirection",
        cashAmount: "cashAmount",
      };
      const field = error instanceof MarketplaceApiError && error.field ? fieldMap[error.field] : undefined;
      if (field) {
        setSwapErrors((current) => ({ ...current, [field]: message }));
        focusFirstInvalid(swapFormRef.current);
      } else {
        setServerError(message);
      }
    } finally {
      submissionLockRef.current = false;
      setSubmitting(false);
    }
  }

  function chooseTab(tab: "procurement" | "swap") {
    setActiveTab(tab);
    setServerError(null);
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
          <span>03 服务端确认</span>
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
            <form noValidate onSubmit={submitProcurement} ref={procurementFormRef}>
              <fieldset className="m-0 border-0 p-0">
                <legend className="mb-5 text-xl font-semibold text-[var(--ink)]">需求基础信息</legend>
                <div className="grid gap-5 sm:grid-cols-2">
                  <label className={fieldLabelClass}>
                    交易方式
                    <select
                      aria-describedby={procurementErrors.dealMode ? "procurement-deal-mode-error" : undefined}
                      aria-invalid={Boolean(procurementErrors.dealMode)}
                      className={inputClass}
                      id="procurement-deal-mode"
                      onChange={(event) => updateProcurement("dealMode", event.target.value as "rental" | "service")}
                      value={procurement.dealMode}
                    >
                      <option value="rental">算力租赁</option>
                      <option value="service">服务采购</option>
                    </select>
                    <ErrorText id="procurement-deal-mode-error">{procurementErrors.dealMode}</ErrorText>
                  </label>
                  <label className={fieldLabelClass}>
                    资源类型
                    <select
                      aria-describedby={procurementErrors.category ? "procurement-category-error" : undefined}
                      aria-invalid={Boolean(procurementErrors.category)}
                      className={inputClass}
                      id="procurement-category"
                      onChange={(event) => updateProcurementCategory(event.target.value as ResourceCategory)}
                      value={procurement.category}
                    >
                      <CategoryOptions />
                    </select>
                    <ErrorText id="procurement-category-error">{procurementErrors.category}</ErrorText>
                  </label>
                  <label className={fieldLabelClass}>
                    计价单位
                    <select
                      aria-describedby={procurementErrors.pricingUnit ? "procurement-unit-error" : undefined}
                      aria-invalid={Boolean(procurementErrors.pricingUnit)}
                      className={inputClass}
                      id="procurement-unit"
                      onChange={(event) => updateProcurementUnit(event.target.value as PricingUnit)}
                      value={procurement.pricingUnit}
                    >
                      <UnitOptions category={procurement.category} />
                    </select>
                    <ErrorText id="procurement-unit-error">{procurementErrors.pricingUnit}</ErrorText>
                  </label>
                  <label className={fieldLabelClass}>
                    需求数量（{procurement.pricingUnit}）
                    <input
                      aria-describedby={procurementErrors.quantity ? "procurement-quantity-error" : undefined}
                      aria-invalid={Boolean(procurementErrors.quantity)}
                      className={inputClass}
                      id="procurement-quantity"
                      inputMode="decimal"
                      min="0.01"
                      onChange={(event) => updateProcurement("quantity", event.target.value)}
                      step="0.01"
                      type="number"
                      value={procurement.quantity}
                    />
                    <ErrorText id="procurement-quantity-error">{procurementErrors.quantity}</ErrorText>
                  </label>
                  {durationConfig(procurement.pricingUnit).required ? (
                    <label className={fieldLabelClass}>
                      {durationConfig(procurement.pricingUnit).label}
                      <input
                        aria-describedby={`procurement-duration-help${procurementErrors.duration ? " procurement-duration-error" : ""}`}
                        aria-invalid={Boolean(procurementErrors.duration)}
                        className={inputClass}
                        id="procurement-duration"
                        inputMode="numeric"
                        min="1"
                        onChange={(event) => updateProcurement("duration", event.target.value)}
                        step="1"
                        type="number"
                        value={procurement.duration}
                      />
                      <span className="text-xs font-normal text-[var(--muted)]" id="procurement-duration-help">{durationConfig(procurement.pricingUnit).help}</span>
                      <ErrorText id="procurement-duration-error">{procurementErrors.duration}</ErrorText>
                    </label>
                  ) : (
                    <div className="border border-[var(--border)] bg-[var(--info-bg)] p-3 text-sm" role="note">
                      <strong className="block text-[var(--ink)]">{durationConfig(procurement.pricingUnit).label}</strong>
                      <span className="mt-1 block text-xs text-[var(--text)]">{durationConfig(procurement.pricingUnit).help}</span>
                    </div>
                  )}
                  <label className={fieldLabelClass}>
                    期望区域
                    <select
                      aria-describedby={procurementErrors.region ? "procurement-region-error" : undefined}
                      aria-invalid={Boolean(procurementErrors.region)}
                      className={inputClass}
                      id="procurement-region"
                      onChange={(event) => updateProcurement("region", event.target.value)}
                      value={procurement.region}
                    >
                      <option value="">请选择</option>
                      {marketplaceRegions.map((region) => (
                        <option key={region}>{region}</option>
                      ))}
                    </select>
                    <ErrorText id="procurement-region-error">{procurementErrors.region}</ErrorText>
                  </label>
                  <label className={fieldLabelClass}>
                    期望开始日期
                    <input
                      aria-describedby={procurementErrors.deliveryDate ? "procurement-delivery-error" : undefined}
                      aria-invalid={Boolean(procurementErrors.deliveryDate)}
                      className={inputClass}
                      id="procurement-delivery"
                      onChange={(event) => updateProcurement("deliveryDate", event.target.value)}
                      type="date"
                      value={procurement.deliveryDate}
                    />
                    <ErrorText id="procurement-delivery-error">{procurementErrors.deliveryDate}</ErrorText>
                  </label>
                  <label className={`${fieldLabelClass} sm:col-span-2`}>
                    交付与 SLA 要求
                    <textarea
                      aria-describedby={procurementErrors.requirements ? "procurement-requirements-error" : undefined}
                      aria-invalid={Boolean(procurementErrors.requirements)}
                      className={`${inputClass} min-h-28 resize-y`}
                      id="procurement-requirements"
                      onChange={(event) => updateProcurement("requirements", event.target.value)}
                      placeholder="例如：支持容器交付，期望 99.9% SLA，需要明确网络费用口径"
                      value={procurement.requirements}
                    />
                    <ErrorText id="procurement-requirements-error">{procurementErrors.requirements}</ErrorText>
                  </label>
                </div>
              </fieldset>

              <Consent checked={procurement.consent} error={procurementErrors.consent} id="procurement-consent" onChange={(checked) => updateProcurement("consent", checked)} />
              {serverError ? <p className="mt-5 border-l-4 border-[var(--error)] bg-[var(--error-bg)] p-4 text-base text-[var(--error)]" role="alert">{serverError}</p> : null}
              <button className="button button-primary mt-6 w-full sm:w-auto" disabled={submitting} type="submit">
                {submitting ? "正在提交…" : "提交需求"}
              </button>
            </form>
          </div>
        ) : (
          <div aria-labelledby="swap-tab" className="border-x border-b border-[var(--border)] bg-[var(--surface)] p-5 sm:p-7" id="swap-panel" role="tabpanel">
            <form noValidate onSubmit={submitSwap} ref={swapFormRef}>
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
                unitError={swapErrors.offeredUnit}
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
                unitError={swapErrors.wantedUnit}
              />

              <fieldset className="mt-6 border-0 border-t border-[var(--border)] p-0 pt-6">
                <legend className="text-lg font-semibold text-[var(--ink)]">撮合条件</legend>
                <div className="mt-4 grid gap-5 sm:grid-cols-2">
                  <label className={fieldLabelClass}>
                    期望区域
                    <select
                      aria-describedby={swapErrors.region ? "swap-region-error" : undefined}
                      aria-invalid={Boolean(swapErrors.region)}
                      className={inputClass}
                      id="swap-region"
                      onChange={(event) => updateSwap("region", event.target.value)}
                      value={swap.region}
                    >
                      <option value="">请选择</option>
                      {marketplaceRegions.map((region) => (
                        <option key={region}>{region}</option>
                      ))}
                    </select>
                    <ErrorText id="swap-region-error">{swapErrors.region}</ErrorText>
                  </label>
                  <label className={fieldLabelClass}>
                    卡时补差
                    <select
                      aria-describedby={swapErrors.cashDirection ? "swap-cash-direction-error" : undefined}
                      aria-invalid={Boolean(swapErrors.cashDirection)}
                      className={inputClass}
                      id="swap-cash-direction"
                      onChange={(event) => updateSwap("cashDirection", event.target.value as SwapValues["cashDirection"])}
                      value={swap.cashDirection}
                    >
                      <option value="none">不设置</option>
                      <option value="offer">我方可补差</option>
                      <option value="request">期望对方补差</option>
                    </select>
                    <ErrorText id="swap-cash-direction-error">{swapErrors.cashDirection}</ErrorText>
                  </label>
                  {swap.cashDirection !== "none" ? (
                    <label className={fieldLabelClass}>
                      补差上限（KAI 标准卡时）
                      <input
                        aria-describedby={swapErrors.cashAmount ? "swap-cash-amount-error" : undefined}
                        aria-invalid={Boolean(swapErrors.cashAmount)}
                        className={inputClass}
                        id="swap-cash-amount"
                        inputMode="decimal"
                        min="0.01"
                        onBlur={() => {
                          if (validCardHourAmount(swap.cashAmount)) updateSwap("cashAmount", Number(swap.cashAmount).toFixed(2));
                        }}
                        onChange={(event) => updateSwap("cashAmount", event.target.value)}
                        step="0.01"
                        type="number"
                        value={swap.cashAmount}
                      />
                      <ErrorText id="swap-cash-amount-error">{swapErrors.cashAmount}</ErrorText>
                    </label>
                  ) : null}
                </div>
              </fieldset>

              <Consent checked={swap.consent} error={swapErrors.consent} id="swap-consent" onChange={(checked) => updateSwap("consent", checked)} />
              {serverError ? <p className="mt-5 border-l-4 border-[var(--error)] bg-[var(--error-bg)] p-4 text-base text-[var(--error)]" role="alert">{serverError}</p> : null}
              <button className="button button-primary mt-6 w-full sm:w-auto" disabled={submitting} type="submit">
                {submitting ? "正在提交…" : "提交置换需求"}
              </button>
            </form>
          </div>
        )}

        {confirmation ? <RequestConfirmation confirmation={confirmation} headingRef={confirmationRef} /> : null}
      </div>

      <aside className="self-start border-t-2 border-[var(--accent)] bg-[var(--info-bg)] p-5 lg:sticky lg:top-28">
        <p className="kicker">Before you start</p>
        <h2 className="m-0 text-xl">需求服务已接通</h2>
        <ul className="mt-4 grid gap-3 pl-5 text-sm text-[var(--text)]">
          <li>业务字段会保存到 KAI Cloud 服务器，会员中心可再次读取。</li>
          <li>不要填写姓名、手机号、公司机密、账号或访问密钥。</li>
          <li>目录参考条件不是要约；正式报价与补差上限只使用两位小数的 KAI 标准卡时。</li>
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

function Consent({ checked, error, id, onChange }: { checked: boolean; error?: string; id: string; onChange: (checked: boolean) => void }) {
  return (
    <label className="mt-6 flex items-start gap-3 border border-[var(--border)] bg-[var(--info-bg)] p-4 text-sm text-[var(--text)]">
      <input
        aria-describedby={error ? `${id}-error` : undefined}
        aria-invalid={Boolean(error)}
        checked={checked}
        className="mt-1 size-4 shrink-0 accent-[var(--brand)]"
        id={id}
        onChange={(event) => onChange(event.target.checked)}
        type="checkbox"
      />
      <span>
        我确认仅提交脱敏业务字段到 KAI Cloud 服务器，并且不含个人资料、商业机密或访问凭据。
        <ErrorText id={`${id}-error`}>{error}</ErrorText>
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
  unitError?: string;
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
            aria-describedby={props.categoryError ? `${props.side}-category-error` : undefined}
            aria-invalid={Boolean(props.categoryError)}
            className={inputClass}
            id={`${props.side}-category`}
            onChange={(event) => props.onCategoryChange(event.target.value as ResourceCategory)}
            value={props.category}
          >
            <CategoryOptions />
          </select>
          <ErrorText id={`${props.side}-category-error`}>{props.categoryError}</ErrorText>
        </label>
        <label className={fieldLabelClass}>
          计价单位
          <select
            aria-describedby={props.unitError ? `${props.side}-unit-error` : undefined}
            aria-invalid={Boolean(props.unitError)}
            className={inputClass}
            id={`${props.side}-unit`}
            onChange={(event) => props.onUnitChange(event.target.value as PricingUnit)}
            value={props.unit}
          >
            <UnitOptions category={props.category} />
          </select>
          <ErrorText id={`${props.side}-unit-error`}>{props.unitError}</ErrorText>
        </label>
        <label className={fieldLabelClass}>
          数量
          <input
            aria-describedby={props.quantityError ? `${props.side}-quantity-error` : undefined}
            aria-invalid={Boolean(props.quantityError)}
            className={inputClass}
            id={`${props.side}-quantity`}
            inputMode="decimal"
            min="0.01"
            onChange={(event) => props.onQuantityChange(event.target.value)}
            step="0.01"
            type="number"
            value={props.quantity}
          />
          <ErrorText id={`${props.side}-quantity-error`}>{props.quantityError}</ErrorText>
        </label>
        <label className={`${fieldLabelClass} sm:col-span-2`}>
          规格、容量与交付边界
          <textarea
            aria-describedby={props.descriptionError ? `${props.side}-description-error` : undefined}
            aria-invalid={Boolean(props.descriptionError)}
            className={`${inputClass} min-h-24 resize-y`}
            id={`${props.side}-description`}
            onChange={(event) => props.onDescriptionChange(event.target.value)}
            placeholder={props.side === "offered" ? "描述可提供的型号、容量、可用时段和交付形态" : "描述期望获得的型号、容量、时段和 SLA"}
            value={props.description}
          />
          <ErrorText id={`${props.side}-description-error`}>{props.descriptionError}</ErrorText>
        </label>
      </div>
    </fieldset>
  );
}

function RequestConfirmation({ confirmation, headingRef }: { confirmation: Confirmation; headingRef: React.RefObject<HTMLHeadingElement | null> }) {
  return (
    <section aria-live="polite" className="mt-8 border-t-2 border-[var(--success)] bg-[var(--success-bg)] p-5 sm:p-7" role="status">
      <p className="kicker">Request confirmed</p>
      <h2 className="m-0 text-2xl" ref={headingRef} tabIndex={-1}>
        需求已写入服务端
      </h2>
      <p className="mt-2 text-sm text-[var(--text)]">{confirmation.title}</p>
      <div className="mt-5 flex flex-wrap items-baseline justify-between gap-3 border-y border-[var(--border)] py-4">
        <span className="text-xs font-semibold text-[var(--muted)]">服务端需求编号</span>
        <strong className="font-mono text-lg text-[var(--ink)]">{confirmation.id}</strong>
      </div>
      <ol className="mt-6 grid gap-0" aria-label="需求处理状态">
        {[
          ["已记录", "刚刚", "业务字段已写入服务器。"],
          ["KAI 标准化", "下一步", confirmation.mode === "swap" ? "整理双边资源的容量与补差口径。" : "整理计价、SLA 与交付口径。"],
          ["方案待确认", "匹配后", "展示标准化方案；具体交易需双方人工确认。"],
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
      <p className="m-0 border-t border-[var(--border)] pt-4 text-xs text-[var(--muted)]">刷新页面后确认区会消失；会员中心仍可从服务端读取这条记录。</p>
    </section>
  );
}
