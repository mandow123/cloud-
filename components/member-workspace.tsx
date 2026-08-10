"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import {
  createIdempotencyKey,
  MarketplaceApiError,
  type MarketplacePage,
  type MarketplacePageInfo,
  marketplaceErrorMessage,
  marketplaceGet,
  marketplacePost,
} from "@/lib/client/marketplace-client";
import { resourceListings } from "@/lib/data";
import {
  marketplaceQuoteLeadTimes,
  type MarketplaceDraftRecord,
  type MarketplaceNormalizedQuoteRecord,
  type MarketplaceRequestRecord,
  type MarketplaceSupplierQuoteRecord,
} from "@/lib/marketplace";
import type { ResourceCategory, ResourceListing } from "@/lib/types";

type MemberRole = "buyer" | "supplier";

type QuoteValues = {
  demandId: string;
  unitPrice: string;
  leadTime: string;
  validDays: string;
  scopeNote: string;
  consent: boolean;
};

type CollectionState<T> = {
  items: T[];
  count: number;
  updatedAt: string | null;
  status: "loading" | "ready" | "error";
  error: string | null;
  pageInfo: MarketplacePageInfo | null;
};

const WATCHLIST_KEY = "kai-cloud-watchlist-v1";
const ROLE_KEY = "kai-cloud-role-v1";
const DEFAULT_WATCHLIST_IDS = resourceListings.slice(0, 3).map((listing) => listing.id);

const categoryLabel: Record<ResourceCategory, string> = {
  gpu: "GPU 算力",
  token_model: "Token / 模型",
  rack_capacity: "整机柜 / 容量",
  cloud_vendor: "云厂商资源",
};

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

function useMarketplaceCollection<T>(path: string) {
  const [state, setState] = useState<CollectionState<T>>({
    items: [],
    count: 0,
    updatedAt: null,
    status: "loading",
    error: null,
    pageInfo: null,
  });

  const load = useCallback(async (cursor: string | null = null) => {
    setState((current) => ({ ...current, status: "loading", error: null }));
    const separator = path.includes("?") ? "&" : "?";
    const requestPath = cursor ? `${path}${separator}cursor=${encodeURIComponent(cursor)}` : path;
    try {
      const page = await marketplaceGet<MarketplacePage<T>>(requestPath);
      if (!Array.isArray(page.items) || !page.pageInfo || typeof page.pageInfo.hasMore !== "boolean") {
        throw new MarketplaceApiError({
          code: "INVALID_RESPONSE",
          message: "记录服务返回了无法识别的内容，请稍后重试。",
          status: 200,
        });
      }
      setState((current) => ({
        items: cursor ? [...current.items, ...page.items] : page.items,
        count: page.count,
        updatedAt: page.updatedAt,
        status: "ready",
        error: null,
        pageInfo: page.pageInfo,
      }));
    } catch (error) {
      setState((current) => ({
        ...current,
        status: "error",
        error: marketplaceErrorMessage(error, "暂时无法读取这组记录。"),
      }));
    }
  }, [path]);

  useEffect(() => {
    void load();
  }, [load]);

  return {
    state,
    reload: useCallback(() => load(null), [load]),
    loadMore: useCallback(() => {
      if (state.pageInfo?.nextCursor) void load(state.pageInfo.nextCursor);
    }, [load, state.pageInfo?.nextCursor]),
  };
}

export function MemberWorkspace() {
  const [role, setRole] = useState<MemberRole>("buyer");
  const [watchlistIds, setWatchlistIds] = useState<string[]>(DEFAULT_WATCHLIST_IDS);
  const buyerRequests = useMarketplaceCollection<MarketplaceRequestRecord>("/api/requests?view=mine&limit=20");
  const marketRequests = useMarketplaceCollection<MarketplaceRequestRecord>("/api/requests?view=market&limit=20");
  const buyerQuotes = useMarketplaceCollection<MarketplaceNormalizedQuoteRecord>("/api/quotes?view=buyer&limit=20");
  const supplierQuotes = useMarketplaceCollection<MarketplaceSupplierQuoteRecord>("/api/quotes?view=supplier&limit=20");
  const supplierDrafts = useMarketplaceCollection<MarketplaceDraftRecord>("/api/drafts?view=mine&limit=20");
  const [draftValues, setDraftValues] = useState({ title: "", category: "gpu" as ResourceCategory, capacity: "" });
  const [draftError, setDraftError] = useState<string | null>(null);
  const [quoteValues, setQuoteValues] = useState<QuoteValues>({
    demandId: "",
    unitPrice: "",
    leadTime: "",
    validDays: "7",
    scopeNote: "",
    consent: false,
  });
  const [quoteErrors, setQuoteErrors] = useState<Partial<Record<keyof QuoteValues, string>>>({});
  const [quoteServerError, setQuoteServerError] = useState<string | null>(null);
  const [quoteReceipt, setQuoteReceipt] = useState<string | null>(null);
  const [draftSubmitting, setDraftSubmitting] = useState(false);
  const [quoteSubmitting, setQuoteSubmitting] = useState(false);
  const draftKeyRef = useRef<string | null>(null);
  const quoteKeyRef = useRef<string | null>(null);
  const draftLockRef = useRef(false);
  const quoteLockRef = useRef(false);
  const quoteFormRef = useRef<HTMLFormElement>(null);
  const reloadBuyerRequests = buyerRequests.reload;
  const reloadMarketRequests = marketRequests.reload;
  const reloadBuyerQuotes = buyerQuotes.reload;
  const reloadSupplierQuotes = supplierQuotes.reload;
  const reloadSupplierDrafts = supplierDrafts.reload;

  useEffect(() => {
    const syncLocalData = () => {
      setWatchlistIds(readStringArray(WATCHLIST_KEY, DEFAULT_WATCHLIST_IDS));
      const savedRole = sessionStorage.getItem(ROLE_KEY);
      if (savedRole === "buyer" || savedRole === "supplier") setRole(savedRole);
    };
    syncLocalData();

    window.addEventListener("storage", syncLocalData);
    window.addEventListener("kai-watchlist-changed", syncLocalData);
    return () => {
      window.removeEventListener("storage", syncLocalData);
      window.removeEventListener("kai-watchlist-changed", syncLocalData);
    };
  }, []);

  useEffect(() => {
    const reloadServerRecords = () => {
      void reloadBuyerRequests();
      void reloadMarketRequests();
      void reloadBuyerQuotes();
      void reloadSupplierQuotes();
      void reloadSupplierDrafts();
    };
    window.addEventListener("kai-server-records-changed", reloadServerRecords);
    return () => window.removeEventListener("kai-server-records-changed", reloadServerRecords);
  }, [reloadBuyerQuotes, reloadBuyerRequests, reloadMarketRequests, reloadSupplierDrafts, reloadSupplierQuotes]);

  const watchlist = watchlistIds
    .map((id) => resourceListings.find((listing) => listing.id === id))
    .filter((listing): listing is ResourceListing => Boolean(listing));
  const selectedDemand = marketRequests.state.items.find((request) => request.id === quoteValues.demandId) ?? marketRequests.state.items[0];

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

  async function addDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (draftLockRef.current) return;
    if (draftValues.title.trim().length < 3 || draftValues.capacity.trim().length < 8) {
      setDraftError("资源名称至少 3 个字，容量说明至少 8 个字。请只填写脱敏业务信息。");
      return;
    }
    draftLockRef.current = true;
    setDraftSubmitting(true);
    try {
      const idempotencyKey = draftKeyRef.current ?? createIdempotencyKey("supplier-draft");
      draftKeyRef.current = idempotencyKey;
      await marketplacePost<MarketplaceDraftRecord>(
        "/api/drafts",
        {
          title: draftValues.title.trim(),
          category: draftValues.category,
          capacity: draftValues.capacity.trim(),
        },
        idempotencyKey,
      );
      draftKeyRef.current = null;
      setDraftValues({ title: "", category: "gpu", capacity: "" });
      setDraftError(null);
      void supplierDrafts.reload();
    } catch (error) {
      setDraftError(marketplaceErrorMessage(error, "资源草稿保存失败。"));
    } finally {
      draftLockRef.current = false;
      setDraftSubmitting(false);
    }
  }

  function updateQuote<Key extends keyof QuoteValues>(key: Key, value: QuoteValues[Key]) {
    setQuoteValues((current) => ({ ...current, [key]: value }));
    setQuoteErrors((current) => ({ ...current, [key]: undefined }));
    quoteKeyRef.current = null;
    setQuoteServerError(null);
    setQuoteReceipt(null);
  }

  async function submitQuote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (quoteLockRef.current) return;
    const nextErrors: Partial<Record<keyof QuoteValues, string>> = {};
    const price = Number(quoteValues.unitPrice);
    const validDays = Number(quoteValues.validDays);
    if (!selectedDemand) nextErrors.demandId = "请选择匹配需求。";
    if (!Number.isFinite(price) || price <= 0) nextErrors.unitPrice = "请输入大于 0 的报价单价。";
    if (!quoteValues.leadTime) nextErrors.leadTime = "请选择交付周期。";
    if (!Number.isInteger(validDays) || validDays < 1 || validDays > 90) nextErrors.validDays = "有效期应为 1–90 天。";
    if (quoteValues.scopeNote.trim().length < 8) nextErrors.scopeNote = "请用至少 8 个字说明费用口径。";
    if (!quoteValues.consent) nextErrors.consent = "请确认服务器提交说明。";
    setQuoteErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0 || !selectedDemand) {
      window.requestAnimationFrame(() => quoteFormRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
      return;
    }

    quoteLockRef.current = true;
    setQuoteSubmitting(true);
    setQuoteServerError(null);
    try {
      const idempotencyKey = quoteKeyRef.current ?? createIdempotencyKey("supplier-quote");
      quoteKeyRef.current = idempotencyKey;
      const { record } = await marketplacePost<MarketplaceSupplierQuoteRecord>(
        "/api/quotes",
        {
          demandId: selectedDemand.id,
          unitPrice: price,
          leadTime: quoteValues.leadTime,
          validDays,
          scopeNote: quoteValues.scopeNote.trim(),
        },
        idempotencyKey,
      );
      quoteKeyRef.current = null;
      setQuoteReceipt(record.id);
      setQuoteValues((current) => ({ ...current, unitPrice: "", leadTime: "", scopeNote: "", consent: false }));
      void supplierQuotes.reload();
      void marketRequests.reload();
    } catch (error) {
      const message = marketplaceErrorMessage(error, "报价提交失败。");
      const field = error instanceof MarketplaceApiError && error.field && error.field in quoteValues
        ? error.field as keyof QuoteValues
        : undefined;
      if (field) {
        setQuoteErrors((current) => ({ ...current, [field]: message }));
        window.requestAnimationFrame(() => quoteFormRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
      } else {
        setQuoteServerError(message);
      }
    } finally {
      quoteLockRef.current = false;
      setQuoteSubmitting(false);
    }
  }

  function resetLocalPreferences() {
    setWatchlistIds(DEFAULT_WATCHLIST_IDS);
    setQuoteReceipt(null);
    try {
      localStorage.removeItem(WATCHLIST_KEY);
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
          <p className="m-0 text-xs font-bold uppercase tracking-[0.12em] text-[var(--accent)]">Transaction workspace</p>
          <h2 className="mt-2 text-xl" id="member-workspace-heading">
            选择工作视角
          </h2>
          <p className="m-0 text-sm text-[var(--text)]">工作视角保存在当前标签页；登录后，需求、草稿和报价按当前交易主体读取。</p>
        </div>
        <div aria-label="会员工作视角" className="inline-grid grid-cols-2 border border-[var(--border-strong)]" role="tablist">
          <RoleButton active={role === "buyer"} controls="buyer-workspace" id="buyer-role" label="需求方" onClick={() => chooseRole("buyer")} onKeyDown={moveRole} />
          <RoleButton active={role === "supplier"} controls="supplier-workspace" id="supplier-role" label="供应方" onClick={() => chooseRole("supplier")} onKeyDown={moveRole} />
        </div>
      </div>

      {role === "buyer" ? (
        <div aria-labelledby="buyer-role" className="grid gap-14" id="buyer-workspace" role="tabpanel">
          <BuyerWatchlist listings={watchlist} onRemove={removeWatchlist} />
          <BuyerRequests collection={buyerRequests.state} onLoadMore={buyerRequests.loadMore} onRetry={buyerRequests.reload} />
          <BuyerQuotes collection={buyerQuotes.state} onLoadMore={buyerQuotes.loadMore} onRetry={buyerQuotes.reload} />
        </div>
      ) : (
        <div aria-labelledby="supplier-role" className="grid gap-14" id="supplier-workspace" role="tabpanel">
          <SupplierDrafts
            collection={supplierDrafts.state}
            draftError={draftError}
            onLoadMore={supplierDrafts.loadMore}
            onRetry={supplierDrafts.reload}
            submitting={draftSubmitting}
            values={draftValues}
            onSubmit={addDraft}
            onUpdate={(next) => {
              setDraftValues(next);
              setDraftError(null);
              draftKeyRef.current = null;
            }}
          />
          <MatchedDemands collection={marketRequests.state} onLoadMore={marketRequests.loadMore} onRetry={marketRequests.reload} />
          <SupplierQuoteForm
            errors={quoteErrors}
            formRef={quoteFormRef}
            onSubmit={submitQuote}
            onUpdate={updateQuote}
            receipt={quoteReceipt}
            requests={marketRequests.state.items}
            selectedDemand={selectedDemand}
            serverError={quoteServerError}
            submitting={quoteSubmitting}
            values={quoteValues}
          />
          <ResponseLog collection={supplierQuotes.state} onLoadMore={supplierQuotes.loadMore} onRetry={supplierQuotes.reload} />
        </div>
      )}

      <div className="mt-14 flex flex-wrap items-center justify-between gap-4 border-t border-[var(--border)] pt-6">
        <p className="m-0 max-w-2xl text-xs text-[var(--muted)]">此操作只恢复本机关注列表与工作视角，不删除服务器中的需求、草稿或报价。</p>
        <button className="button button-secondary button-compact" onClick={resetLocalPreferences} type="button">
          恢复本机偏好
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

function CollectionStatus<T>({
  collection,
  label,
  onLoadMore,
  onRetry,
}: {
  collection: CollectionState<T>;
  label: string;
  onLoadMore: () => void;
  onRetry: () => void;
}) {
  if (collection.status === "loading" && collection.items.length === 0) {
    return <p className="border border-[var(--border)] bg-[var(--info-bg)] p-4 text-sm" role="status">正在读取{label}…</p>;
  }

  if (collection.status === "error") {
    return (
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-l-4 border-[var(--error)] bg-[var(--error-bg)] p-4" role="alert">
        <p className="m-0 text-sm text-[var(--error)]">{collection.error}</p>
        <button className="button button-secondary button-compact" onClick={onRetry} type="button">重试这组数据</button>
      </div>
    );
  }

  if (collection.pageInfo?.hasMore) {
    return (
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] pt-4 text-xs text-[var(--muted)]">
        <span>已显示 {collection.items.length} / {collection.count} 条{label}</span>
        <button className="button button-secondary button-compact" disabled={collection.status === "loading"} onClick={onLoadMore} type="button">
          {collection.status === "loading" ? "正在加载…" : "加载更多"}
        </button>
      </div>
    );
  }

  return null;
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
                查看资源详情
              </Link>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function BuyerRequests({
  collection,
  onLoadMore,
  onRetry,
}: {
  collection: CollectionState<MarketplaceRequestRecord>;
  onLoadMore: () => void;
  onRetry: () => void;
}) {
  const requests = collection.items;
  return (
    <section aria-labelledby="buyer-requests-title" className="scroll-mt-28" id="purchase-requests">
      <div id="buyer-requests-title">
        <SectionIntro kicker="Buyer / Requests" title="购买申请与需求" description="登录后只显示当前交易主体创建的购买申请与需求；界面不会用预置记录替代加载或错误状态。" />
      </div>
      <CollectionStatus collection={collection} label="需求" onLoadMore={onLoadMore} onRetry={onRetry} />
      {collection.status === "ready" && requests.length === 0 ? <EmptyState action="发布一条需求" description="当前会话还没有已发布需求。" href="/request" /> : null}
      {requests.length > 0 ? <div className="grid gap-5 lg:grid-cols-2">
        {requests.map((request) => (
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
      </div> : null}
      <Link className="button button-secondary mt-5" href="/request">新增需求</Link>
    </section>
  );
}

function MiniTimeline({ status }: { status: string }) {
  const active = status.includes("方案") || status.includes("标准") ? 3 : status.includes("报价") ? 2 : 1;
  return (
    <ol aria-label="需求处理进度" className="mt-5 grid grid-cols-3 gap-2 text-xs">
      {["已记录", "供应方响应", "KAI 标准化"].map((step, index) => (
        <li className={index + 1 <= active ? "text-[var(--success)]" : "text-[var(--muted)]"} key={step}>
          <span className={`mb-2 block h-1 ${index + 1 <= active ? "bg-[var(--success)]" : "bg-[var(--border)]"}`} />
          {step}
        </li>
      ))}
    </ol>
  );
}

function BuyerQuotes({
  collection,
  onLoadMore,
  onRetry,
}: {
  collection: CollectionState<MarketplaceNormalizedQuoteRecord>;
  onLoadMore: () => void;
  onRetry: () => void;
}) {
  const quotes = collection.items;
  return (
    <section aria-labelledby="standard-quotes-title">
      <div id="standard-quotes-title">
        <SectionIntro kicker="Buyer / Normalized quotes" title="KAI 标准化报价" description="需求方只看到 KAI 按统一口径处理后的报价，不公开供应方原始报价、身份或内部备注。" />
      </div>
      <CollectionStatus collection={collection} label="标准化报价" onLoadMore={onLoadMore} onRetry={onRetry} />
      {collection.status === "ready" && quotes.length === 0 ? <EmptyState description="当前会话暂无可见的 KAI 标准化报价。供应方原始报价不会直接显示在这里。" /> : null}
      {quotes.length > 0 ? (
        <div className="grid gap-5 lg:grid-cols-3">
        {quotes.map((quote) => (
          <article className="border-t-2 border-[var(--accent)] bg-[var(--surface)] p-5" key={quote.id}>
            <div className="flex justify-between gap-3 text-xs">
              <span className="font-semibold text-[var(--accent)]">KAI 标准化方案</span>
              <span className="text-[var(--muted)]">{shortDate(quote.createdAt)}</span>
            </div>
            <h3 className="mb-1 mt-4 text-lg">{quote.demandTitle}</h3>
            <p className="m-0 font-mono text-xs text-[var(--muted)]">{quote.id}</p>
            <p className="my-5 font-mono text-3xl font-semibold text-[var(--ink)]">
              {formatCurrency(quote.standardizedUnitPrice)} <span className="text-sm font-normal text-[var(--muted)]">/ {quote.pricingUnit}</span>
            </p>
            <dl className="grid gap-2 border-y border-[var(--border)] py-4 text-xs">
              <div className="flex justify-between gap-4"><dt>交付窗口</dt><dd className="text-[var(--ink)]">{quote.deliveryWindow}</dd></div>
              <div className="flex justify-between gap-4"><dt>有效至</dt><dd className="text-[var(--ink)]">{shortDate(quote.validUntil)}</dd></div>
              <div className="flex justify-between gap-4"><dt>状态</dt><dd className="text-[var(--success)]">{quote.status}</dd></div>
            </dl>
            <p className="mt-4 text-sm text-[var(--text)]">{quote.standardizedScope}</p>
            <p className="mt-3 border-t border-[var(--border)] pt-3 text-xs text-[var(--muted)]">{quote.standardizationNote}</p>
          </article>
        ))}
        </div>
      ) : null}
    </section>
  );
}

function SupplierDrafts({
  collection,
  values,
  draftError,
  submitting,
  onLoadMore,
  onRetry,
  onSubmit,
  onUpdate,
}: {
  collection: CollectionState<MarketplaceDraftRecord>;
  values: { title: string; category: ResourceCategory; capacity: string };
  draftError: string | null;
  submitting: boolean;
  onLoadMore: () => void;
  onRetry: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onUpdate: (values: { title: string; category: ResourceCategory; capacity: string }) => void;
}) {
  const drafts = collection.items;
  return (
    <section aria-labelledby="supplier-drafts-title">
      <div id="supplier-drafts-title"><SectionIntro kicker="Supplier / Drafts" title="资源草稿" description="草稿写入当前工作台，但不会自动成为公开资源。" /></div>
      <div className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
        <form className="border-t-2 border-[var(--accent)] bg-[var(--surface)] p-5" noValidate onSubmit={onSubmit}>
          <h3 className="mt-0 text-lg">新建资源草稿</h3>
          <div className="grid gap-4">
            <label className={labelClass}>资源名称<input className={inputClass} onChange={(event) => onUpdate({ ...values, title: event.target.value })} placeholder="使用脱敏资源代号" value={values.title} /></label>
            <label className={labelClass}>资源类型<select className={inputClass} onChange={(event) => onUpdate({ ...values, category: event.target.value as ResourceCategory })} value={values.category}>{Object.entries(categoryLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label className={labelClass}>容量摘要<textarea className={`${inputClass} min-h-24 resize-y`} onChange={(event) => onUpdate({ ...values, capacity: event.target.value })} placeholder="例如：16 卡，可按周排期，交付前确认库存" value={values.capacity} /></label>
          </div>
          {draftError ? <p className="text-sm text-[var(--error)]" role="alert">{draftError}</p> : null}
          <button className="button button-primary mt-4" disabled={submitting} type="submit">{submitting ? "正在保存…" : "保存到工作台"}</button>
        </form>
        <div className="grid content-start gap-3">
          <CollectionStatus collection={collection} label="资源草稿" onLoadMore={onLoadMore} onRetry={onRetry} />
          {collection.status === "ready" && drafts.length === 0 ? <EmptyState description="当前会话暂无资源草稿。保存左侧表单后会在这里出现。" /> : drafts.map((draft) => (
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

function MatchedDemands({
  collection,
  onLoadMore,
  onRetry,
}: {
  collection: CollectionState<MarketplaceRequestRecord>;
  onLoadMore: () => void;
  onRetry: () => void;
}) {
  const requests = collection.items;
  return (
    <section aria-labelledby="matched-demands-title">
      <div id="matched-demands-title"><SectionIntro kicker="Supplier / Matching" title="可响应需求" description="来自服务器的匿名业务字段；不包含联系人或公司资料。" /></div>
      <CollectionStatus collection={collection} label="可响应需求" onLoadMore={onLoadMore} onRetry={onRetry} />
      {collection.status === "ready" && requests.length === 0 ? <EmptyState action="发布一条需求" description="当前没有可响应的匿名市场需求。" href="/request" /> : null}
      {requests.length > 0 ? <div className="data-table-wrap">
        <table className="data-table">
          <caption className="sr-only">供应方匹配需求</caption>
          <thead><tr><th scope="col">需求</th><th scope="col">类别</th><th scope="col">区域</th><th scope="col">数量</th><th scope="col">状态</th></tr></thead>
          <tbody>{requests.map((request) => <tr key={request.id}><th className="text-[var(--ink)]" scope="row"><span className="block font-mono text-xs text-[var(--muted)]">{request.id}</span>{request.title}</th><td>{categoryLabel[request.category]}</td><td>{request.region}</td><td>{request.quantity} {request.pricingUnit}</td><td>{request.status}</td></tr>)}</tbody>
        </table>
      </div> : null}
    </section>
  );
}

function SupplierQuoteForm({
  requests,
  selectedDemand,
  values,
  errors,
  formRef,
  receipt,
  serverError,
  submitting,
  onUpdate,
  onSubmit,
}: {
  requests: MarketplaceRequestRecord[];
  selectedDemand?: MarketplaceRequestRecord;
  values: QuoteValues;
  errors: Partial<Record<keyof QuoteValues, string>>;
  formRef: React.RefObject<HTMLFormElement | null>;
  receipt: string | null;
  serverError: string | null;
  submitting: boolean;
  onUpdate: <Key extends keyof QuoteValues>(key: Key, value: QuoteValues[Key]) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <section aria-labelledby="quote-submit-title">
      <div id="quote-submit-title"><SectionIntro kicker="Supplier / Quote" title="提交报价" description="供应方可查看自己的原始报价；需求方只会收到 KAI 标准化后的版本。" /></div>
      <form className="border-t-2 border-[var(--accent)] bg-[var(--surface)] p-5 sm:p-7" noValidate onSubmit={onSubmit} ref={formRef}>
        <div className="grid gap-5 md:grid-cols-2">
          <label className={labelClass}>匹配需求<select aria-describedby={errors.demandId ? "quote-demand-error" : undefined} aria-invalid={Boolean(errors.demandId)} className={inputClass} disabled={requests.length === 0} id="quote-demand" onChange={(event) => onUpdate("demandId", event.target.value)} value={selectedDemand?.id ?? ""}><option value="">{requests.length === 0 ? "暂无可响应需求" : "请选择"}</option>{requests.map((request) => <option key={request.id} value={request.id}>{request.id} · {request.title}</option>)}</select><FieldError error={errors.demandId} id="quote-demand-error" /></label>
          <label className={labelClass}>报价单价（人民币 / {selectedDemand?.pricingUnit ?? "单位"}）<input aria-describedby={errors.unitPrice ? "quote-price-error" : undefined} aria-invalid={Boolean(errors.unitPrice)} className={inputClass} id="quote-price" inputMode="decimal" min="0.01" onChange={(event) => onUpdate("unitPrice", event.target.value)} step="0.01" type="number" value={values.unitPrice} /><FieldError error={errors.unitPrice} id="quote-price-error" /></label>
          <label className={labelClass}>交付周期<select aria-describedby={errors.leadTime ? "quote-lead-error" : undefined} aria-invalid={Boolean(errors.leadTime)} className={inputClass} id="quote-lead" onChange={(event) => onUpdate("leadTime", event.target.value)} value={values.leadTime}><option value="">请选择</option>{marketplaceQuoteLeadTimes.map((leadTime) => <option key={leadTime}>{leadTime}</option>)}</select><FieldError error={errors.leadTime} id="quote-lead-error" /></label>
          <label className={labelClass}>报价有效期（天）<input aria-describedby={errors.validDays ? "quote-valid-error" : undefined} aria-invalid={Boolean(errors.validDays)} className={inputClass} id="quote-valid" max="90" min="1" onChange={(event) => onUpdate("validDays", event.target.value)} type="number" value={values.validDays} /><FieldError error={errors.validDays} id="quote-valid-error" /></label>
          <label className={`${labelClass} md:col-span-2`}>费用与服务口径<textarea aria-describedby={errors.scopeNote ? "quote-scope-error" : undefined} aria-invalid={Boolean(errors.scopeNote)} className={`${inputClass} min-h-24 resize-y`} id="quote-scope" onChange={(event) => onUpdate("scopeNote", event.target.value)} placeholder="例如：报价含税含电，公网流量另计，目标 SLA 99.9%" value={values.scopeNote} /><FieldError error={errors.scopeNote} id="quote-scope-error" /></label>
        </div>
        <label className="mt-5 flex items-start gap-3 border border-[var(--border)] bg-[var(--info-bg)] p-4 text-sm"><input aria-describedby={errors.consent ? "quote-consent-error" : undefined} aria-invalid={Boolean(errors.consent)} checked={values.consent} className="mt-1 size-4 accent-[var(--brand)]" id="quote-consent" onChange={(event) => onUpdate("consent", event.target.checked)} type="checkbox" /><span>我确认只填写脱敏业务字段，并将这条报价保存到 KAI Cloud 工作台；正式交易前需双方复核。<FieldError error={errors.consent} id="quote-consent-error" /></span></label>
        {serverError ? <p className="mt-5 border-l-4 border-[var(--error)] bg-[var(--error-bg)] p-4 text-sm text-[var(--error)]" role="alert">{serverError}</p> : null}
        <button className="button button-primary mt-5" disabled={submitting || requests.length === 0} type="submit">{submitting ? "正在提交…" : "提交报价"}</button>
        {receipt ? <p className="mt-5 border-l-4 border-[var(--success)] bg-[var(--success-bg)] p-4 text-sm text-[var(--ink)]" role="status">服务端报价已生成：<strong className="font-mono">{receipt}</strong></p> : null}
      </form>
    </section>
  );
}

function ResponseLog({
  collection,
  onLoadMore,
  onRetry,
}: {
  collection: CollectionState<MarketplaceSupplierQuoteRecord>;
  onLoadMore: () => void;
  onRetry: () => void;
}) {
  const responses = collection.items;
  return (
    <section aria-labelledby="response-log-title">
      <div id="response-log-title"><SectionIntro kicker="Supplier / Raw quote log" title="我的原始报价" description="只读取当前供应方会话提交的原始报价；这些字段不会原样公开给需求方。" /></div>
      <CollectionStatus collection={collection} label="原始报价" onLoadMore={onLoadMore} onRetry={onRetry} />
      {collection.status === "ready" && responses.length === 0 ? <EmptyState description="当前会话尚未提交原始报价。使用上方表单完成一条响应流程。" /> : null}
      {responses.length > 0 ? <div className="data-table-wrap"><table className="data-table"><caption className="sr-only">供应方原始报价响应记录</caption><thead><tr><th scope="col">响应编号</th><th scope="col">需求</th><th scope="col">单价</th><th scope="col">交付</th><th scope="col">状态</th></tr></thead><tbody>{responses.map((response) => <tr key={response.id}><th className="font-mono text-xs text-[var(--ink)]" scope="row">{response.id}</th><td>{response.demandTitle}</td><td>{formatCurrency(response.unitPrice)} / {response.pricingUnit}</td><td>{response.leadTime} · 有效至 {shortDate(response.validUntil)}</td><td>{response.status}</td></tr>)}</tbody></table></div> : null}
    </section>
  );
}

function FieldError({ error, id }: { error?: string; id?: string }) {
  return error ? <span className="text-xs font-normal text-[var(--error)]" id={id} role="alert">{error}</span> : null;
}

function EmptyState({ description, action, href }: { description: string; action?: string; href?: string }) {
  return (
    <div className="border border-dashed border-[var(--border-strong)] bg-[var(--info-bg)] p-6 text-sm">
      <p className="m-0">{description}</p>
      {action && href ? <Link className="button button-secondary mt-4" href={href}>{action}</Link> : null}
    </div>
  );
}
