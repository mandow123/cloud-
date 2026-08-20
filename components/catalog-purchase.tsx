"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import styles from "@/components/catalog-purchase.module.css";
import { createIdempotencyKey, marketplaceErrorMessage, marketplacePost } from "@/lib/client/marketplace-client";
import { formatCardHourValue } from "@/lib/card-hours";
import type { MarketplaceRequestRecord } from "@/lib/marketplace";
import type { ResourceListing } from "@/lib/types";
import { requiresManualSshPublicKey } from "@/lib/manual-delivery";

const hourlyUnits = new Set(["卡时", "服务器时", "模型实例时", "预留容量时"]);

type AccountSessionSnapshot = {
  authenticated?: boolean;
  organization?: { id?: string } | null;
  memberships?: Array<{ organizationId?: string; status?: string }>;
};

function tomorrow() {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  return date.toISOString().slice(0, 10);
}

export function CatalogPurchase({ resource, manualDeliveryEnabled }: { resource: ResourceListing; manualDeliveryEnabled: boolean }) {
  const [quantity, setQuantity] = useState("1");
  const [durationHours, setDurationHours] = useState("24");
  const [deliveryDate, setDeliveryDate] = useState(tomorrow);
  const [note, setNote] = useState("");
  const [sshPublicKey, setSshPublicKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [accountState, setAccountState] = useState<"loading" | "ready" | "signed-out" | "inactive">("loading");
  const [intent, setIntent] = useState<MarketplaceRequestRecord | null>(null);
  const keyRef = useRef<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/auth/session", { credentials: "same-origin", cache: "no-store", signal: controller.signal })
      .then(async (response): Promise<AccountSessionSnapshot> => response.ok
        ? response.json() as Promise<AccountSessionSnapshot>
        : { authenticated: false })
      .then((session) => {
        if (session.authenticated !== true) {
          setAccountState("signed-out");
          return;
        }
        const active = session.memberships?.some((membership) => (
          membership.organizationId === session.organization?.id && membership.status === "ACTIVE"
        ));
        setAccountState(active ? "ready" : "inactive");
      })
      .catch((sessionError: unknown) => {
        if (sessionError instanceof DOMException && sessionError.name === "AbortError") return;
        setAccountState("signed-out");
      });
    return () => controller.abort();
  }, []);
  const usesDuration = hourlyUnits.has(resource.pricingUnit);
  const requiresSshPublicKey = manualDeliveryEnabled && requiresManualSshPublicKey(resource);
  const quantityNumber = Number(quantity);
  const durationNumber = usesDuration ? Number(durationHours) : 1;
  const estimatedAmount = useMemo(
    () => Number.isFinite(quantityNumber) && Number.isFinite(durationNumber) && quantityNumber > 0 && durationNumber > 0
      ? resource.quote.median * quantityNumber * durationNumber
      : 0,
    [durationNumber, quantityNumber, resource.quote.median],
  );
  const estimatedCardHours = estimatedAmount > 0 ? estimatedAmount / 1.002 : 0;

  async function submit() {
    setBusy(true);
    setError("");
    try {
      keyRef.current ??= createIdempotencyKey("catalog-purchase");
      const result = await marketplacePost<MarketplaceRequestRecord>(
        "/api/v1/catalog-purchase-intents",
        {
          resourceId: resource.id,
          quantity: quantityNumber,
          durationHours: usesDuration ? durationNumber : null,
          deliveryDate,
          note,
          sshPublicKey: requiresSshPublicKey ? sshPublicKey.trim() : null,
        },
        keyRef.current,
        20_000,
      );
      keyRef.current = null;
      setIntent(result.record);
    } catch (submitError) {
      setError(marketplaceErrorMessage(submitError, "询价意向提交失败，请检查数量和交付日期后重试。"));
    } finally {
      setBusy(false);
    }
  }

  if (intent) {
    return (
      <div className={`shell ${styles.page}`}>
        <section className={styles.success} aria-labelledby="purchase-success-title">
          <p className={styles.eyebrow}>Inquiry accepted</p>
          <h2 id="purchase-success-title">询价意向已提交</h2>
          <p>申请编号：<strong>{intent.id}</strong></p>
          <p>平台将先人工确认库存、地域网络、供应商交付条件和正式卡时报价；确认后由运营人员把你的 SSH 公钥安全交给对应供应商并协调开通。当前仅为询价参考：未锁库存、未支付、未成交，也不会自动操作任何机器。</p>
          <div className={styles.successActions}>
            <Link className="button button-primary" href={`/member/purchases/${encodeURIComponent(intent.id)}`}>查看本次算力详情</Link>
            <Link className="button button-secondary" href="/member/purchases">查看全部申请</Link>
            <Link className="button button-secondary" href="/buy">继续选购算力</Link>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className={`shell ${styles.page}`}>
      <Link className={styles.backLink} href="/buy">← 返回 GPU 套餐</Link>
      <header className={styles.heading}>
        <p>REQUEST A SUPPLIER QUOTE</p>
        <h1>确认算力套餐与询价信息</h1>
        <p>核对 GPU 套餐、数量、时长和卡时参考总计。提交后由平台确认库存、地域网络与正式报价；本页不创建成交订单。</p>
      </header>

      <div className={styles.layout}>
        <main className={styles.main}>
          <section className={styles.resourceCard} aria-labelledby="purchase-resource-title">
            <p className={styles.eyebrow}>{resource.region} · {resource.deliveryForm}</p>
            <h2 id="purchase-resource-title">{resource.title}</h2>
            <p>{resource.summary}</p>
            <p className={styles.meta}><span>{resource.source ? `供应商来源：${resource.source.supplierName}` : resource.supplierName}</span><span>{resource.capacity}</span><span>SLA {resource.sla}</span></p>
            {resource.source ? <p className={styles.meta}><span>数据来源：《{resource.source.documentTitle}》</span><span>{resource.source.observedAt}</span><span>供应商提供报价 · 待确认</span></p> : null}
            <dl className={styles.specs}>
              {Object.entries(resource.specs).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
            </dl>
          </section>

          <section className={styles.formSection} aria-labelledby="purchase-form-title">
            <p className={styles.eyebrow}>Inquiry details</p>
            <h2 id="purchase-form-title">填写询价数量</h2>
            <div className={styles.formGrid}>
              <label className={styles.field}>
                资源数量
                <input type="number" min="1" step="1" value={quantity} onChange={(event) => setQuantity(event.target.value)} />
              </label>
              {usesDuration ? (
                <label className={styles.field}>
                  服务时长（小时）
                  <input type="number" min="1" step="1" value={durationHours} onChange={(event) => setDurationHours(event.target.value)} />
                </label>
              ) : null}
              <label className={styles.field}>
                计划开始日期
                <input type="date" min={tomorrow()} value={deliveryDate} onChange={(event) => setDeliveryDate(event.target.value)} />
              </label>
              <label className={`${styles.field} ${styles.wide}`}>
                补充要求（选填）
                <textarea maxLength={500} value={note} placeholder="例如：网络、存储、镜像、专线或交付窗口要求" onChange={(event) => setNote(event.target.value)} />
              </label>
              {requiresSshPublicKey ? <label className={`${styles.field} ${styles.wide}`}>
                SSH 公钥
                <textarea autoCapitalize="off" autoCorrect="off" maxLength={8192} rows={4} spellCheck={false} value={sshPublicKey} placeholder="ssh-ed25519 AAAA… your-device" onChange={(event) => { setSshPublicKey(event.target.value); keyRef.current = null; }} />
                <small>仅提交单行 OpenSSH 公钥，支持 Ed25519 或至少 2048 位 RSA。公钥会保存到平台数据库，供授权管理员人工交付；请勿提交私钥。</small>
              </label> : null}
            </div>
            {error ? <p className={styles.error} role="alert">{error}</p> : null}
          </section>
        </main>

        <aside className={styles.summary} aria-label="价格汇总">
          <p className={styles.eyebrow}>Price summary</p>
          <p className={styles.unitPrice}>
            {formatCardHourValue(resource.quote.median / 1.002)} 卡时
            <span>卡时 / 套·小时 · 正式价格以供应商确认为准</span>
          </p>
          <dl className={styles.priceRows}>
            <div><dt>资源数量</dt><dd>{quantityNumber > 0 ? quantityNumber : "—"}</dd></div>
            {usesDuration ? <div><dt>服务时长</dt><dd>{durationNumber > 0 ? `${durationNumber} 小时` : "—"}</dd></div> : null}
            <div><dt>卡时参考范围</dt><dd>{formatCardHourValue(resource.quote.rangeMin / 1.002)}–{formatCardHourValue(resource.quote.rangeMax / 1.002)} 卡时</dd></div>
            <div><dt>询价参考总计</dt><dd className={styles.estimated}>{estimatedCardHours > 0 ? `${formatCardHourValue(estimatedCardHours)} 卡时` : "—"}</dd></div>
          </dl>
          <p className={styles.scope}>{resource.quote.scopeNote}</p>
          <p className={styles.scope}><strong>询价参考 · 未锁库存 · 未支付 · 未成交</strong></p>
          <ol className={styles.flow}>
            <li>提交询价意向，不锁库存、不扣卡时</li>
            <li>平台人工确认库存与正式卡时报价</li>
            <li>管理员核对公钥并协调供应商人工开通</li>
            <li>买方收到连接信息后自行验收</li>
          </ol>
          {accountState === "signed-out" ? (
            <Link className={styles.submit} href={`/login?returnTo=${encodeURIComponent(`/checkout/${resource.id}`)}`}>
              <span>登录后提交询价</span><span aria-hidden="true">→</span>
            </Link>
          ) : accountState === "inactive" ? (
            <Link className={styles.submit} href="/member#profile">
              <span>完善交易主体后提交</span><span aria-hidden="true">→</span>
            </Link>
          ) : (
            <button className={styles.submit} type="button" disabled={accountState !== "ready" || busy || estimatedAmount <= 0 || !deliveryDate || requiresSshPublicKey && sshPublicKey.trim().length < 40} onClick={() => void submit()}>
              <span>{accountState === "loading" ? "正在核对账户…" : busy ? "正在提交…" : "提交询价"}</span><span aria-hidden="true">→</span>
            </button>
          )}
        </aside>
      </div>
    </div>
  );
}
