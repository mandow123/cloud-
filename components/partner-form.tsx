"use client";

import { FormEvent, useState } from "react";

type PartnerFormValues = {
  alias: string;
  category: string;
  region: string;
  capacity: string;
  delivery: string;
  unit: string;
  consent: boolean;
};

const initialValues: PartnerFormValues = {
  alias: "",
  category: "",
  region: "",
  capacity: "",
  delivery: "",
  unit: "",
  consent: false,
};

const inputClass =
  "min-h-11 w-full border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2 text-[var(--ink)] placeholder:text-[var(--muted)]";

export function PartnerForm() {
  const [values, setValues] = useState<PartnerFormValues>(initialValues);
  const [errors, setErrors] = useState<Partial<Record<keyof PartnerFormValues, string>>>({});
  const [receipt, setReceipt] = useState<string | null>(null);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors: Partial<Record<keyof PartnerFormValues, string>> = {};

    if (values.alias.trim().length < 2) nextErrors.alias = "请输入至少 2 个字的供应方代号。";
    if (!values.category) nextErrors.category = "请选择主要资源类型。";
    if (!values.region) nextErrors.region = "请选择资源所在区域。";
    if (values.capacity.trim().length < 8) nextErrors.capacity = "请用至少 8 个字描述可供容量。";
    if (!values.delivery) nextErrors.delivery = "请选择可交付周期。";
    if (!values.unit) nextErrors.unit = "请选择主要报价单位。";
    if (!values.consent) nextErrors.consent = "请确认这是不传输的本机预登记。";

    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      setReceipt(null);
      return;
    }

    const fingerprint = `${values.alias}-${values.category}-${values.region}`
      .split("")
      .reduce((sum, character) => (sum * 31 + character.charCodeAt(0)) >>> 0, 2166136261)
      .toString(36)
      .toUpperCase()
      .slice(0, 6)
      .padEnd(6, "0");

    setReceipt(`KAI-P-${fingerprint}`);
  }

  function update<Key extends keyof PartnerFormValues>(key: Key, value: PartnerFormValues[Key]) {
    setValues((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
    setReceipt(null);
  }

  return (
    <section aria-labelledby="partner-form-title" className="border-t-2 border-[var(--accent)] bg-[var(--surface)] p-5 sm:p-7">
      <div className="mb-6 border-b border-[var(--border)] pb-5">
        <p className="kicker">Local pre-registration</p>
        <h2 id="partner-form-title" className="m-0 text-2xl">
          资源入驻预登记
        </h2>
        <p className="mt-2 max-w-2xl text-sm text-[var(--text)]">
          表单仅用于预检入驻信息，不会联网、发送或持久化输入。请勿填写公司全称、联系人或商业机密。
        </p>
      </div>

      <form noValidate onSubmit={submit}>
        <div className="grid gap-5 md:grid-cols-2">
          <label className="grid gap-1.5 text-sm font-semibold text-[var(--ink)]">
            供应方代号
            <input
              aria-describedby={errors.alias ? "partner-alias-error" : "partner-alias-help"}
              aria-invalid={Boolean(errors.alias)}
              className={inputClass}
              onChange={(event) => update("alias", event.target.value)}
              placeholder="例如：华北节点 A"
              type="text"
              value={values.alias}
            />
            <span className="text-xs font-normal text-[var(--muted)]" id="partner-alias-help">
              请使用脱敏代号，不填写企业全称。
            </span>
            {errors.alias ? (
              <span className="text-xs font-normal text-[var(--error)]" id="partner-alias-error" role="alert">
                {errors.alias}
              </span>
            ) : null}
          </label>

          <label className="grid gap-1.5 text-sm font-semibold text-[var(--ink)]">
            主要资源类型
            <select
              aria-invalid={Boolean(errors.category)}
              className={inputClass}
              onChange={(event) => update("category", event.target.value)}
              value={values.category}
            >
              <option value="">请选择</option>
              <option value="gpu">GPU 算力</option>
              <option value="token_model">Token / 模型服务</option>
              <option value="rack_capacity">整机柜 / 容量</option>
              <option value="cloud_vendor">云厂商资源</option>
            </select>
            {errors.category ? <span className="text-xs font-normal text-[var(--error)]">{errors.category}</span> : null}
          </label>

          <label className="grid gap-1.5 text-sm font-semibold text-[var(--ink)]">
            资源区域
            <select
              aria-invalid={Boolean(errors.region)}
              className={inputClass}
              onChange={(event) => update("region", event.target.value)}
              value={values.region}
            >
              <option value="">请选择</option>
              <option>华北</option>
              <option>华东</option>
              <option>华南</option>
              <option>西南</option>
              <option>西北</option>
              <option>多区域</option>
            </select>
            {errors.region ? <span className="text-xs font-normal text-[var(--error)]">{errors.region}</span> : null}
          </label>

          <label className="grid gap-1.5 text-sm font-semibold text-[var(--ink)]">
            可交付周期
            <select
              aria-invalid={Boolean(errors.delivery)}
              className={inputClass}
              onChange={(event) => update("delivery", event.target.value)}
              value={values.delivery}
            >
              <option value="">请选择</option>
              <option value="48h">48 小时内</option>
              <option value="7d">7 天内</option>
              <option value="30d">30 天内</option>
              <option value="scheduled">排期交付</option>
            </select>
            {errors.delivery ? <span className="text-xs font-normal text-[var(--error)]">{errors.delivery}</span> : null}
          </label>

          <label className="grid gap-1.5 text-sm font-semibold text-[var(--ink)] md:col-span-2">
            可供容量摘要
            <textarea
              aria-describedby="partner-capacity-help"
              aria-invalid={Boolean(errors.capacity)}
              className={`${inputClass} min-h-28 resize-y`}
              id="partner-capacity"
              onChange={(event) => update("capacity", event.target.value)}
              placeholder="例如：32 卡并行容量，支持按周排期，库存接入后确认"
              value={values.capacity}
            />
            <span className="text-xs font-normal text-[var(--muted)]" id="partner-capacity-help">
              仅描述脱敏的资源范围，不填写机房地址、账号或访问密钥。
            </span>
            {errors.capacity ? <span className="text-xs font-normal text-[var(--error)]">{errors.capacity}</span> : null}
          </label>

          <label className="grid gap-1.5 text-sm font-semibold text-[var(--ink)]">
            主要报价单位
            <select
              aria-invalid={Boolean(errors.unit)}
              className={inputClass}
              onChange={(event) => update("unit", event.target.value)}
              value={values.unit}
            >
              <option value="">请选择</option>
              <option>卡时</option>
              <option>服务器时</option>
              <option>百万 Token</option>
              <option>模型实例时</option>
              <option>预留容量时</option>
              <option>机柜月</option>
              <option>kW 月</option>
            </select>
            {errors.unit ? <span className="text-xs font-normal text-[var(--error)]">{errors.unit}</span> : null}
          </label>
        </div>

        <label className="mt-6 flex items-start gap-3 border border-[var(--border)] bg-[var(--info-bg)] p-4 text-sm text-[var(--text)]">
          <input
            checked={values.consent}
            className="mt-1 size-4 shrink-0 accent-[var(--brand)]"
            onChange={(event) => update("consent", event.target.checked)}
            type="checkbox"
          />
          <span>
            我确认这是本机预登记，不会提交到 KAI Cloud 或任何供应方；我没有填写个人资料、商务报价或访问凭据。
            {errors.consent ? <span className="mt-1 block text-xs text-[var(--error)]">{errors.consent}</span> : null}
          </span>
        </label>

        <div className="mt-6 flex flex-wrap items-center gap-4">
          <button className="button button-primary" type="submit">
            生成预登记回执
          </button>
          <button
            className="button button-secondary"
            onClick={() => {
              setValues(initialValues);
              setErrors({});
              setReceipt(null);
            }}
            type="button"
          >
            清空
          </button>
        </div>
      </form>

      {receipt ? (
        <div aria-live="polite" className="mt-6 border-l-4 border-[var(--success)] bg-[var(--success-bg)] p-5" role="status">
          <p className="m-0 text-xs font-bold uppercase tracking-[0.12em] text-[var(--success)]">Pre-registration receipt</p>
          <p className="mt-2 text-xl font-semibold text-[var(--ink)]">{receipt}</p>
          <p className="mt-1 text-sm text-[var(--text)]">预登记校验已完成。此编号只存在于当前页面状态，刷新后即消失。</p>
        </div>
      ) : null}
    </section>
  );
}
