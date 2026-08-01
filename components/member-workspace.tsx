"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { resourceListings } from "@/lib/data";
import type { DealMode, PricingUnit, ResourceCategory, ResourceListing } from "@/lib/types";

type MemberRole = "buyer" | "supplier";

type LocalRequestRecord = {
  id: string;
  kind: DealMode;
  title: string;
  category: ResourceCategory;
  region: string;
  pricingUnit: PricingUnit;
  quantity: number;
  createdAt: string;
  status: string;
  summary: string;
};

type ResourceDraft = {
  id: string;
  title: string;
  category: ResourceCategory;
  capacity: string;
  status: "草稿";
};

type QuoteResponse = {
  id: string;
  demandId: string;
  demandTitle: string;
  unitPrice: number;
  pricingUnit: PricingUnit;
  leadTime: string;
  validDays: number;
  scopeNote: string;
  createdAt: string;
  status: "已保存在本机";
};

type StoredMemberState = {
  drafts: ResourceDraft[];
  responses: QuoteResponse[];
};

type QuoteValues = {
  demandId: string;
  unitPrice: string;
  leadTime: string;
  validDays: string;
  scopeNote: string;
  consent: boolean;
};

const WATCHLIST_KEY = "kai-cloud-demo-watchlist-v1";
const REQUESTS_KEY = "kai-cloud-demo-requests-v1";
const MEMBER_KEY = "kai-cloud-demo-member-v1";
const ROLE_KEY = "kai-cloud-demo-role-v1";
const DEFAULT_WATCHLIST_IDS = resourceListings.slice(0, 3).map((listing) => listing.id);

const categoryLabel: Record<ResourceCategory, string> = {
  gpu: "GPU 算力",
  token_model: "Token / 模型",
  rack_capacity: "整机柜 / 容量",
  cloud_vendor: "云厂商资源",
};

const seededRequests: LocalRequestRecord[] = [
  {
    id: "KAI-R-DEMO-7F21",
    kind: "rental",
    title: "GPU 算力 · 8 卡时",
    category: "gpu",
    region: "华北",
    pricingUnit: "卡时",
    quantity: 8,
    createdAt: "2026-07-31T09:20:00.000Z",
    status: "标准化中",
    summary: "演示：容器交付，要求明确电费、网络与 99.9% SLA。",
  },
  {
    id: "KAI-X-DEMO-3C08",
    kind: "swap",
    title: "GPU 算力 → Token / 模型 双边置换",
    category: "token_model",
    region: "多区域",
    pricingUnit: "百万 Token",
    quantity: 120,
    createdAt: "2026-07-29T06:10:00.000Z",
    status: "方案待确认",
    summary: "演示：以离峰 GPU 容量置换模型推理用量。",
  },
];

const defaultDrafts: ResourceDraft[] = [
  {
    id: "KAI-D-001",
    title: "华北 GPU 弹性池",
    category: "gpu",
    capacity: "演示容量：16 卡，可按 8 小时窗口交付",
    status: "草稿",
  },
  {
    id: "KAI-D-002",
    title: "华东模型实例预留",
    category: "token_model",
    capacity: "演示容量：12 实例，支持按周排期",
    status: "草稿",
  },
];

const inputClass =
  "min-h-11 w-full border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2 text-[var(--ink)] placeholder:text-[var(--muted)]";
const labelClass = "grid gap-1.5 text-sm font-semibold text-[var(--ink)]";

function readStringArray(key: string, fallback: string[]) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) ?? "null") as unknown;
    return Array.isArray(parsed) && parsed.every((item) => typeof item === "string") ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function isLocalRequest(value: unknown): value is LocalRequestRecord {
  if (!value || typeof value !== "object") return false;
  const request = value as Partial<LocalRequestRecord>;
  return (
    typeof request.id === "string" &&
    typeof request.title === "string" &&
    typeof request.category === "string" &&
    typeof request.pricingUnit === "string" &&
    typeof request.region === "string" &&
    typeof request.createdAt === "string"
  );
}

function readRequests() {
  try {
    const parsed = JSON.parse(localStorage.getItem(REQUESTS_KEY) ?? "[]") as unknown;
    return Array.isArray(parsed) ? parsed.filter(isLocalRequest) : [];
  } catch {
    return [];
  }
}

function readMemberState(): StoredMemberState {
  try {
    const parsed = JSON.parse(localStorage.getItem(MEMBER_KEY) ?? "null") as Partial<StoredMemberState> | null;
    if (parsed && Array.isArray(parsed.drafts) && Array.isArray(parsed.responses)) {
      return { drafts: parsed.drafts, responses: parsed.responses };
    }
  } catch {
    // Fall through to deterministic demo state.
  }
  return { drafts: defaultDrafts, responses: [] };
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: "CNY",
    minimumFractionDigits: value < 10 ? 2 : 0,
    maximumFractionDigits: value < 10 ? 2 : 0,
  }).format(value);
}

function shortDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit" }).format(date);
}

function localId(prefix: string, seed: string) {
  const hash = seed.split("").reduce((sum, char) => (sum * 33 + char.charCodeAt(0)) >>> 0, 5381);
  return `${prefix}-${hash.toString(36).toUpperCase().slice(0, 7).padStart(7, "0")}`;
}

export function MemberWorkspace() {
  const [role, setRole] = useState<MemberRole>("buyer");
  const [watchlistIds, setWatchlistIds] = useState<string[]>(DEFAULT_WATCHLIST_IDS);
  const [localRequests, setLocalRequests] = useState<LocalRequestRecord[]>([]);
  const [memberState, setMemberState] = useState<StoredMemberState>({ drafts: defaultDrafts, responses: [] });
  const [draftValues, setDraftValues] = useState({ title: "", category: "gpu" as ResourceCategory, capacity: "" });
  const [draftError, setDraftError] = useState<string | null>(null);
  const [quoteValues, setQuoteValues] = useState<QuoteValues>({
    demandId: seededRequests[0].id,
    unitPrice: "",
    leadTime: "",
    validDays: "7",
    scopeNote: "",
    consent: false,
  });
  const [quoteErrors, setQuoteErrors] = useState<Partial<Record<keyof QuoteValues, string>>>({});
  const [quoteReceipt, setQuoteReceipt] = useState<string | null>(null);

  useEffect(() => {
    const syncLocalData = () => {
      setWatchlistIds(readStringArray(WATCHLIST_KEY, DEFAULT_WATCHLIST_IDS));
      setLocalRequests(readRequests());
      setMemberState(readMemberState());
      const savedRole = sessionStorage.getItem(ROLE_KEY);
      if (savedRole === "buyer" || savedRole === "supplier") setRole(savedRole);
    };
    syncLocalData();

    window.addEventListener("storage", syncLocalData);
    window.addEventListener("kai-watchlist-changed", syncLocalData);
    window.addEventListener("kai-demo-requests-changed", syncLocalData);
    return () => {
      window.removeEventListener("storage", syncLocalData);
      window.removeEventListener("kai-watchlist-changed", syncLocalData);
      window.removeEventListener("kai-demo-requests-changed", syncLocalData);
    };
  }, []);

  const allRequests = useMemo(() => {
    const existingIds = new Set(localRequests.map((request) => request.id));
    return [...localRequests, ...seededRequests.filter((request) => !existingIds.has(request.id))];
  }, [localRequests]);
  const watchlist = watchlistIds
    .map((id) => resourceListings.find((listing) => listing.id === id))
    .filter((listing): listing is ResourceListing => Boolean(listing));
  const quoteListings = (watchlist.length > 0 ? watchlist : resourceListings).slice(0, 3);
  const selectedDemand = allRequests.find((request) => request.id === quoteValues.demandId) ?? allRequests[0];

  function chooseRole(nextRole: MemberRole) {
    setRole(nextRole);
    try {
      sessionStorage.setItem(ROLE_KEY, nextRole);
    } catch {
      // Role switching still works without storage.
    }
  }

  function moveRole(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const nextRole = event.key === "ArrowLeft" || event.key === "Home" ? "buyer" : "supplier";
    chooseRole(nextRole);
    document.getElementById(nextRole === "buyer" ? "buyer-role" : "supplier-role")?.focus();
  }

  function removeWatchlist(id: string) {
    const next = watchlistIds.filter((item) => item !== id);
    setWatchlistIds(next);
    try {
      localStorage.setItem(WATCHLIST_KEY, JSON.stringify(next));
      window.dispatchEvent(new CustomEvent("kai-watchlist-changed"));
    } catch {
      // UI remains usable when storage is unavailable.
    }
  }

  function persistMemberState(next: StoredMemberState) {
    setMemberState(next);
    try {
      localStorage.setItem(MEMBER_KEY, JSON.stringify(next));
    } catch {
      // Session UI remains usable when storage is unavailable.
    }
  }

  function addDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (draftValues.title.trim().length < 3 || draftValues.capacity.trim().length < 8) {
      setDraftError("资源名称至少 3 个字，容量说明至少 8 个字。请只使用演示信息。");
      return;
    }
    const draft: ResourceDraft = {
      id: localId("KAI-D", `${draftValues.title}-${draftValues.category}-${draftValues.capacity}`),
      title: draftValues.title.trim(),
      category: draftValues.category,
      capacity: draftValues.capacity.trim(),
      status: "草稿",
    };
    persistMemberState({ ...memberState, drafts: [draft, ...memberState.drafts] });
    setDraftValues({ title: "", category: "gpu", capacity: "" });
    setDraftError(null);
  }

  function updateQuote<Key extends keyof QuoteValues>(key: Key, value: QuoteValues[Key]) {
    setQuoteValues((current) => ({ ...current, [key]: value }));
    setQuoteErrors((current) => ({ ...current, [key]: undefined }));
    setQuoteReceipt(null);
  }

  function submitQuote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors: Partial<Record<keyof QuoteValues, string>> = {};
    const price = Number(quoteValues.unitPrice);
    const validDays = Number(quoteValues.validDays);
    if (!selectedDemand) nextErrors.demandId = "请选择匹配需求。";
    if (!Number.isFinite(price) || price <= 0) nextErrors.unitPrice = "请输入大于 0 的演示单价。";
    if (!quoteValues.leadTime) nextErrors.leadTime = "请选择交付周期。";
    if (!Number.isInteger(validDays) || validDays < 1 || validDays > 90) nextErrors.validDays = "有效期应为 1–90 天。";
    if (quoteValues.scopeNote.trim().length < 8) nextErrors.scopeNote = "请用至少 8 个字说明费用口径。";
    if (!quoteValues.consent) nextErrors.consent = "请确认本机演示说明。";
    setQuoteErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0 || !selectedDemand) return;

    const response: QuoteResponse = {
      id: localId("KAI-Q", `${selectedDemand.id}-${quoteValues.unitPrice}-${quoteValues.leadTime}-${quoteValues.scopeNote}`),
      demandId: selectedDemand.id,
      demandTitle: selectedDemand.title,
      unitPrice: price,
      pricingUnit: selectedDemand.pricingUnit,
      leadTime: quoteValues.leadTime,
      validDays,
      scopeNote: quoteValues.scopeNote.trim(),
      createdAt: new Date().toISOString(),
      status: "已保存在本机",
    };
    persistMemberState({ ...memberState, responses: [response, ...memberState.responses].slice(0, 20) });
    setQuoteReceipt(response.id);
    setQuoteValues((current) => ({ ...current, unitPrice: "", leadTime: "", scopeNote: "", consent: false }));
  }

  function resetDemo() {
    setWatchlistIds(DEFAULT_WATCHLIST_IDS);
    setLocalRequests([]);
    setMemberState({ drafts: defaultDrafts, responses: [] });
    setQuoteReceipt(null);
    try {
      localStorage.removeItem(WATCHLIST_KEY);
      localStorage.removeItem(REQUESTS_KEY);
      localStorage.removeItem(MEMBER_KEY);
      sessionStorage.removeItem(ROLE_KEY);
      window.dispatchEvent(new CustomEvent("kai-watchlist-changed"));
    } catch {
      // In-memory reset has already completed.
    }
  }

  return (
    <section aria-labelledby="member-workspace-heading">
      <div className="mb-8 grid gap-5 border-y border-[var(--border)] bg-[var(--surface)] p-5 sm:grid-cols-[1fr_auto] sm:items-center">
        <div>
          <p className="m-0 text-xs font-bold uppercase tracking-[0.12em] text-[var(--accent)]">No-password demo</p>
          <h2 className="mt-2 text-xl" id="member-workspace-heading">
            选择演示身份
          </h2>
          <p className="m-0 text-sm text-[var(--text)]">没有登录或真实账户。角色保存在当前标签会话，操作保存在本机浏览器。</p>
        </div>
        <div aria-label="会员演示身份" className="inline-grid grid-cols-2 border border-[var(--border-strong)]" role="tablist">
          <RoleButton active={role === "buyer"} controls="buyer-workspace" id="buyer-role" label="需求方" onClick={() => chooseRole("buyer")} onKeyDown={moveRole} />
          <RoleButton active={role === "supplier"} controls="supplier-workspace" id="supplier-role" label="供应方" onClick={() => chooseRole("supplier")} onKeyDown={moveRole} />
        </div>
      </div>

      {role === "buyer" ? (
        <div aria-labelledby="buyer-role" className="grid gap-14" id="buyer-workspace" role="tabpanel">
          <BuyerWatchlist listings={watchlist} onRemove={removeWatchlist} />
          <BuyerRequests requests={allRequests} />
          <StandardizedQuotes listings={quoteListings} />
        </div>
      ) : (
        <div aria-labelledby="supplier-role" className="grid gap-14" id="supplier-workspace" role="tabpanel">
          <SupplierDrafts
            draftError={draftError}
            drafts={memberState.drafts}
            values={draftValues}
            onSubmit={addDraft}
            onUpdate={(next) => {
              setDraftValues(next);
              setDraftError(null);
            }}
          />
          <MatchedDemands requests={allRequests} />
          <SupplierQuoteForm
            errors={quoteErrors}
            onSubmit={submitQuote}
            onUpdate={updateQuote}
            receipt={quoteReceipt}
            requests={allRequests}
            selectedDemand={selectedDemand}
            values={quoteValues}
          />
          <ResponseLog responses={memberState.responses} />
        </div>
      )}

      <div className="mt-14 flex flex-wrap items-center justify-between gap-4 border-t border-[var(--border)] pt-6">
        <p className="m-0 max-w-2xl text-xs text-[var(--muted)]">重置会清除 KAI Cloud 在此浏览器内创建的演示关注、需求、草稿与响应，不影响任何外部系统。</p>
        <button className="button button-secondary button-compact" onClick={resetDemo} type="button">
          重置本机演示数据
        </button>
      </div>
    </section>
  );
}

function RoleButton({
  active,
  controls,
  id,
  label,
  onClick,
  onKeyDown,
}: {
  active: boolean;
  controls: string;
  id: string;
  label: string;
  onClick: () => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>) => void;
}) {
  return (
    <button
      aria-controls={controls}
      aria-selected={active}
      className={`min-h-11 px-5 font-semibold ${active ? "bg-[var(--brand)] text-white" : "bg-[var(--surface)] text-[var(--text)]"}`}
      id={id}
      onClick={onClick}
      onKeyDown={onKeyDown}
      role="tab"
      tabIndex={active ? 0 : -1}
      type="button"
    >
      {label}
    </button>
  );
}

function SectionIntro({ kicker, title, description }: { kicker: string; title: string; description: string }) {
  return (
    <div className="mb-6">
      <p className="kicker">{kicker}</p>
      <h2 className="section-heading text-2xl">{title}</h2>
      <p className="mt-2 max-w-3xl text-sm text-[var(--text)]">{description}</p>
    </div>
  );
}

function BuyerWatchlist({ listings, onRemove }: { listings: ResourceListing[]; onRemove: (id: string) => void }) {
  return (
    <section aria-labelledby="watchlist-title">
      <div id="watchlist-title">
        <SectionIntro kicker="Buyer / Watchlist" title={`关注资源 · ${listings.length}`} description="资源市场与详情页使用同一份本机关注列表。" />
      </div>
      {listings.length === 0 ? (
        <EmptyState action="浏览资源市场" description="尚未关注资源。可以从资源市场添加最多三项进行比较。" href="/resources" />
      ) : (
        <div className="grid gap-px bg-[var(--border)] md:grid-cols-2 xl:grid-cols-3">
          {listings.map((listing) => (
            <article className="bg-[var(--surface)] p-5" key={listing.id}>
              <div className="flex items-start justify-between gap-3">
                <span className="text-xs font-semibold text-[var(--accent)]">{categoryLabel[listing.category]}</span>
                <button className="text-xs text-[var(--muted)] underline hover:text-[var(--error)]" onClick={() => onRemove(listing.id)} type="button">
                  取消关注
                </button>
              </div>
              <h3 className="mb-1 mt-4 text-lg">{listing.title}</h3>
              <p className="m-0 text-sm text-[var(--text)]">{listing.region} · {listing.deliveryForm}</p>
              <p className="mt-4 font-mono text-lg font-semibold text-[var(--ink)]">
                {formatCurrency(listing.quote.median)} <span className="text-xs font-normal text-[var(--muted)]">/ {listing.pricingUnit}</span>
              </p>
              <Link className="mt-4 inline-block text-sm font-semibold text-[var(--accent)] underline" href={`/resources/${listing.id}`}>
                查看演示详情
              </Link>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function BuyerRequests({ requests }: { requests: LocalRequestRecord[] }) {
  return (
    <section aria-labelledby="buyer-requests-title">
      <div id="buyer-requests-title">
        <SectionIntro kicker="Buyer / Requests" title="已发布需求" description="新建需求会出现在这里；示例需求用于补足完整状态演示。" />
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        {requests.slice(0, 4).map((request) => (
          <article className="border-t-2 border-[var(--accent)] bg-[var(--surface)] p-5" key={request.id}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <span className="font-mono text-xs font-semibold text-[var(--accent)]">{request.id}</span>
                <h3 className="mb-1 mt-2 text-lg">{request.title}</h3>
              </div>
              <span className="border border-[var(--border-strong)] bg-[var(--accent-soft)] px-2 py-1 text-xs font-semibold text-[var(--ink)]">{request.status}</span>
            </div>
            <p className="mt-3 text-sm text-[var(--text)]">{request.summary}</p>
            <dl className="mt-4 grid grid-cols-3 gap-3 border-y border-[var(--border)] py-3 text-xs">
              <div><dt className="text-[var(--muted)]">区域</dt><dd className="mt-1 font-semibold text-[var(--ink)]">{request.region}</dd></div>
              <div><dt className="text-[var(--muted)]">数量</dt><dd className="mt-1 font-semibold text-[var(--ink)]">{request.quantity} {request.pricingUnit}</dd></div>
              <div><dt className="text-[var(--muted)]">记录日期</dt><dd className="mt-1 font-semibold text-[var(--ink)]">{shortDate(request.createdAt)}</dd></div>
            </dl>
            <MiniTimeline status={request.status} />
          </article>
        ))}
      </div>
      <Link className="button button-secondary mt-5" href="/request">新增演示需求</Link>
    </section>
  );
}

function MiniTimeline({ status }: { status: string }) {
  const active = status.includes("方案") ? 3 : status.includes("标准") ? 2 : 1;
  return (
    <ol aria-label="需求处理进度" className="mt-5 grid grid-cols-3 gap-2 text-xs">
      {["已记录", "KAI 标准化", "方案待确认"].map((step, index) => (
        <li className={index + 1 <= active ? "text-[var(--success)]" : "text-[var(--muted)]"} key={step}>
          <span className={`mb-2 block h-1 ${index + 1 <= active ? "bg-[var(--success)]" : "bg-[var(--border)]"}`} />
          {step}
        </li>
      ))}
    </ol>
  );
}

function StandardizedQuotes({ listings }: { listings: ResourceListing[] }) {
  return (
    <section aria-labelledby="standard-quotes-title">
      <div id="standard-quotes-title">
        <SectionIntro kicker="Buyer / KAI quotes" title="KAI 标准化报价方案" description="供应商原始报价不相互公开；这里仅以统一口径展示虚构方案。" />
      </div>
      <div className="grid gap-5 lg:grid-cols-3">
        {listings.map((listing) => (
          <article className="border border-[var(--border)] bg-[var(--surface)] p-5" key={listing.id}>
            <div className="flex justify-between gap-3 text-xs">
              <span className="font-semibold text-[var(--accent)]">演示参考价</span>
              <span className="text-[var(--muted)]">样本 {listing.quote.sampleCount}</span>
            </div>
            <h3 className="mb-1 mt-4 text-lg">{listing.title}</h3>
            <p className="m-0 text-sm text-[var(--text)]">{listing.region} · {listing.supplierName}</p>
            <p className="my-5 font-mono text-2xl font-semibold text-[var(--ink)]">
              {formatCurrency(listing.quote.median)} <span className="text-xs font-normal text-[var(--muted)]">/ {listing.pricingUnit}</span>
            </p>
            <dl className="grid gap-2 border-y border-[var(--border)] py-4 text-xs">
              <div className="flex justify-between gap-4"><dt>参考区间</dt><dd className="font-mono text-[var(--ink)]">{formatCurrency(listing.quote.rangeMin)}–{formatCurrency(listing.quote.rangeMax)}</dd></div>
              <div className="flex justify-between gap-4"><dt>费用口径</dt><dd className="text-right text-[var(--ink)]">{listing.quote.taxIncluded ? "含税" : "未含税"} · {listing.quote.energyIncluded ? "含电" : "电费另计"} · {listing.quote.networkIncluded ? "含网络" : "网络另计"}</dd></div>
              <div className="flex justify-between gap-4"><dt>更新</dt><dd className="text-[var(--ink)]">{listing.quote.updatedAt}</dd></div>
            </dl>
            <p className="mt-4 text-xs text-[var(--muted)]">{listing.quote.scopeNote}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function SupplierDrafts({
  drafts,
  values,
  draftError,
  onSubmit,
  onUpdate,
}: {
  drafts: ResourceDraft[];
  values: { title: string; category: ResourceCategory; capacity: string };
  draftError: string | null;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onUpdate: (values: { title: string; category: ResourceCategory; capacity: string }) => void;
}) {
  return (
    <section aria-labelledby="supplier-drafts-title">
      <div id="supplier-drafts-title"><SectionIntro kicker="Supplier / Drafts" title="资源草稿" description="草稿只在本机保存，不会成为公开资源。" /></div>
      <div className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
        <form className="border-t-2 border-[var(--accent)] bg-[var(--surface)] p-5" noValidate onSubmit={onSubmit}>
          <h3 className="mt-0 text-lg">新建演示草稿</h3>
          <div className="grid gap-4">
            <label className={labelClass}>资源名称<input className={inputClass} onChange={(event) => onUpdate({ ...values, title: event.target.value })} placeholder="使用虚构名称" value={values.title} /></label>
            <label className={labelClass}>资源类型<select className={inputClass} onChange={(event) => onUpdate({ ...values, category: event.target.value as ResourceCategory })} value={values.category}>{Object.entries(categoryLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label className={labelClass}>容量摘要<textarea className={`${inputClass} min-h-24 resize-y`} onChange={(event) => onUpdate({ ...values, capacity: event.target.value })} placeholder="例如：演示容量 16 卡，可按周排期" value={values.capacity} /></label>
          </div>
          {draftError ? <p className="text-sm text-[var(--error)]" role="alert">{draftError}</p> : null}
          <button className="button button-primary mt-4" type="submit">保存到本机草稿</button>
        </form>
        <div className="grid content-start gap-3">
          {drafts.map((draft) => (
            <article className="border border-[var(--border)] bg-[var(--surface)] p-4" key={draft.id}>
              <div className="flex items-start justify-between gap-3"><div><span className="font-mono text-xs text-[var(--accent)]">{draft.id}</span><h3 className="mb-1 mt-2 text-base">{draft.title}</h3></div><span className="text-xs font-semibold text-[var(--muted)]">{draft.status}</span></div>
              <p className="m-0 text-sm">{categoryLabel[draft.category]} · {draft.capacity}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function MatchedDemands({ requests }: { requests: LocalRequestRecord[] }) {
  return (
    <section aria-labelledby="matched-demands-title">
      <div id="matched-demands-title"><SectionIntro kicker="Supplier / Matching" title="匹配需求" description="演示匹配只根据资源类别与地区字段，不连接真实需求方。" /></div>
      <div className="data-table-wrap">
        <table className="data-table">
          <caption className="sr-only">供应方演示匹配需求</caption>
          <thead><tr><th scope="col">需求</th><th scope="col">类别</th><th scope="col">区域</th><th scope="col">数量</th><th scope="col">状态</th></tr></thead>
          <tbody>{requests.slice(0, 5).map((request) => <tr key={request.id}><th className="text-[var(--ink)]" scope="row"><span className="block font-mono text-xs text-[var(--muted)]">{request.id}</span>{request.title}</th><td>{categoryLabel[request.category]}</td><td>{request.region}</td><td>{request.quantity} {request.pricingUnit}</td><td>{request.status}</td></tr>)}</tbody>
        </table>
      </div>
    </section>
  );
}

function SupplierQuoteForm({
  requests,
  selectedDemand,
  values,
  errors,
  receipt,
  onUpdate,
  onSubmit,
}: {
  requests: LocalRequestRecord[];
  selectedDemand?: LocalRequestRecord;
  values: QuoteValues;
  errors: Partial<Record<keyof QuoteValues, string>>;
  receipt: string | null;
  onUpdate: <Key extends keyof QuoteValues>(key: Key, value: QuoteValues[Key]) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <section aria-labelledby="quote-submit-title">
      <div id="quote-submit-title"><SectionIntro kicker="Supplier / Quote" title="提交演示报价" description="报价只写入本机响应记录，不会展示给真实需求方。" /></div>
      <form className="border-t-2 border-[var(--accent)] bg-[var(--surface)] p-5 sm:p-7" noValidate onSubmit={onSubmit}>
        <div className="grid gap-5 md:grid-cols-2">
          <label className={labelClass}>匹配需求<select aria-invalid={Boolean(errors.demandId)} className={inputClass} onChange={(event) => onUpdate("demandId", event.target.value)} value={values.demandId}>{requests.map((request) => <option key={request.id} value={request.id}>{request.id} · {request.title}</option>)}</select><FieldError error={errors.demandId} /></label>
          <label className={labelClass}>演示单价（人民币 / {selectedDemand?.pricingUnit ?? "单位"}）<input aria-invalid={Boolean(errors.unitPrice)} className={inputClass} inputMode="decimal" min="0.01" onChange={(event) => onUpdate("unitPrice", event.target.value)} step="0.01" type="number" value={values.unitPrice} /><FieldError error={errors.unitPrice} /></label>
          <label className={labelClass}>交付周期<select aria-invalid={Boolean(errors.leadTime)} className={inputClass} onChange={(event) => onUpdate("leadTime", event.target.value)} value={values.leadTime}><option value="">请选择</option><option>48 小时内</option><option>7 天内</option><option>30 天内</option><option>排期交付</option></select><FieldError error={errors.leadTime} /></label>
          <label className={labelClass}>报价有效期（天）<input aria-invalid={Boolean(errors.validDays)} className={inputClass} max="90" min="1" onChange={(event) => onUpdate("validDays", event.target.value)} type="number" value={values.validDays} /><FieldError error={errors.validDays} /></label>
          <label className={`${labelClass} md:col-span-2`}>费用与服务口径<textarea aria-invalid={Boolean(errors.scopeNote)} className={`${inputClass} min-h-24 resize-y`} onChange={(event) => onUpdate("scopeNote", event.target.value)} placeholder="例如：演示价含税含电，公网流量另计，支持 99.9% SLA" value={values.scopeNote} /><FieldError error={errors.scopeNote} /></label>
        </div>
        <label className="mt-5 flex items-start gap-3 border border-[var(--border)] bg-[var(--info-bg)] p-4 text-sm"><input checked={values.consent} className="mt-1 size-4 accent-[var(--brand)]" onChange={(event) => onUpdate("consent", event.target.checked)} type="checkbox" /><span>我确认只填写虚构报价，且此操作不会向需求方、供应商或 KAI Cloud 发送数据。<FieldError error={errors.consent} /></span></label>
        <button className="button button-primary mt-5" type="submit">保存演示报价响应</button>
        {receipt ? <p className="mt-5 border-l-4 border-[var(--success)] bg-[var(--success-bg)] p-4 text-sm text-[var(--ink)]" role="status">已生成本机响应：<strong className="font-mono">{receipt}</strong></p> : null}
      </form>
    </section>
  );
}

function ResponseLog({ responses }: { responses: QuoteResponse[] }) {
  return (
    <section aria-labelledby="response-log-title">
      <div id="response-log-title"><SectionIntro kicker="Supplier / Log" title="响应记录" description="仅显示本机提交的演示报价。" /></div>
      {responses.length === 0 ? <EmptyState description="尚未保存演示报价。使用上方表单完成一条完整响应流程。" /> : <div className="data-table-wrap"><table className="data-table"><caption className="sr-only">本机演示报价响应记录</caption><thead><tr><th scope="col">响应编号</th><th scope="col">需求</th><th scope="col">单价</th><th scope="col">交付</th><th scope="col">状态</th></tr></thead><tbody>{responses.map((response) => <tr key={response.id}><th className="font-mono text-xs text-[var(--ink)]" scope="row">{response.id}</th><td>{response.demandTitle}</td><td>{formatCurrency(response.unitPrice)} / {response.pricingUnit}</td><td>{response.leadTime} · {response.validDays} 天有效</td><td>{response.status}</td></tr>)}</tbody></table></div>}
    </section>
  );
}

function FieldError({ error }: { error?: string }) {
  return error ? <span className="text-xs font-normal text-[var(--error)]" role="alert">{error}</span> : null;
}

function EmptyState({ description, action, href }: { description: string; action?: string; href?: string }) {
  return (
    <div className="border border-dashed border-[var(--border-strong)] bg-[var(--info-bg)] p-6 text-sm">
      <p className="m-0">{description}</p>
      {action && href ? <Link className="button button-secondary mt-4" href={href}>{action}</Link> : null}
    </div>
  );
}
