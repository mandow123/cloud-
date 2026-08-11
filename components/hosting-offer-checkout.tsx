"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { createIdempotencyKey, MarketplaceApiError, marketplaceErrorMessage, marketplaceGet, marketplacePost } from "@/lib/client/marketplace-client";
import type { BuyerHostingContract, PublicHostingOffer } from "@/lib/hosting-v2-client";
import { formatCardHours, formatHostingTime } from "@/lib/hosting-v2-client";
import styles from "./hosting-marketplace.module.css";

export function HostingOfferCheckout({ offerId }: { offerId: string }) {
  const router = useRouter();
  const [offer, setOffer] = useState<PublicHostingOffer | null>(null);
  const [minutes, setMinutes] = useState(3);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loginRequired, setLoginRequired] = useState(false);
  const requestKey = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void marketplaceGet<{ records: PublicHostingOffer[] }>("/api/v2/offers")
      .then((result) => {
        if (cancelled) return;
        const current = result.records.find((item) => item.id === offerId) ?? null;
        setOffer(current);
        if (current) setMinutes(Math.ceil(current.minRentalSeconds / 60));
        else setError("该报价不存在、已被预留或已经停止发布。");
      })
      .catch((cause) => { if (!cancelled) setError(marketplaceErrorMessage(cause, "报价暂时无法读取。")); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [offerId]);

  const reservedSeconds = minutes * 60;
  const heldMicros = useMemo(() => offer ? Math.ceil(offer.pricing.cardHourMicrosPerGpuHour * reservedSeconds / 3_600) : 0, [offer, reservedSeconds]);

  async function reserve() {
    if (!offer || busy || reservedSeconds < offer.minRentalSeconds || reservedSeconds > offer.maxRentalSeconds) return;
    setBusy(true); setError(null); setLoginRequired(false);
    try {
      requestKey.current ??= createIdempotencyKey("hosting-reserve");
      const result = await marketplacePost<BuyerHostingContract>("/api/v2/contracts", { offerId: offer.id, reservedSeconds }, requestKey.current, 20_000);
      requestKey.current = null;
      router.push(`/gpu/contracts/${encodeURIComponent(result.record.id)}`);
    } catch (cause) {
      setLoginRequired(cause instanceof MarketplaceApiError && cause.status === 401);
      setError(marketplaceErrorMessage(cause, "预留失败，请核对卡时余额后重试。"));
    } finally { setBusy(false); }
  }

  if (loading) return <main className={styles.market}><div className={styles.loading}>正在核对报价和成交条件…</div></main>;
  if (!offer) return <main className={styles.market}><section className={styles.error} role="alert"><strong>无法继续租用</strong><span>{error}</span><Link href="/gpu">返回 GPU 市场</Link></section></main>;

  const minMinutes = Math.ceil(offer.minRentalSeconds / 60);
  const maxMinutes = Math.floor(offer.maxRentalSeconds / 60);
  const cny = heldMicros / 1_000_000 * 1.002;
  return (
    <main className={styles.market}>
      <header className={styles.detailHeader}><div><Link href="/gpu">← GPU 市场</Link><p className={styles.eyebrow}>LOCK A VERIFIED OFFER</p><h1>确认资源与卡时锁定</h1></div><span className={styles.statusPill}>报价可成交</span></header>
      <div className={styles.checkoutGrid}>
        <section className={styles.detailPanel}>
          <h2>{offer.title}</h2>
          <dl className={styles.detailList}>
            <div><dt>GPU</dt><dd>{offer.gpuModel} · 单卡独享</dd></div><div><dt>区域</dt><dd>{offer.region}</dd></div>
            <div><dt>可用时间</dt><dd>{formatHostingTime(offer.availableFrom)} – {formatHostingTime(offer.availableUntil)}</dd></div>
            <div><dt>交付</dt><dd>审核 OCI 模板 · SSH 临时公钥 · 单租户容器</dd></div><div><dt>条款版本</dt><dd>{offer.termsVersion}</dd></div>
          </dl>
          <div className={styles.policyNote}>成交后冻结型号、价格、时长、镜像和费率版本。浏览器不能修改设备、供应商、价格或结算字段。</div>
        </section>
        <aside className={styles.checkoutPanel}>
          <h2>租用配置</h2>
          <label><span>租用分钟数</span><input min={minMinutes} max={maxMinutes} step={1} type="number" value={minutes} onChange={(event) => setMinutes(Number(event.target.value))} /></label>
          <small>允许 {minMinutes}–{maxMinutes} 分钟；实际按秒计量，最低计费 3 分钟。</small>
          <dl className={styles.quoteList}><div><dt>网站价</dt><dd>{formatCardHours(offer.pricing.cardHourMicrosPerGpuHour)} 卡时 / GPU 小时</dd></div><div><dt>预估锁定</dt><dd>{formatCardHours(heldMicros)} KAI 标准卡时</dd></div><div><dt>人民币参考</dt><dd>约 ¥{cny.toFixed(3)}</dd></div></dl>
          <button className={styles.primary} disabled={busy || !Number.isSafeInteger(minutes) || minutes < minMinutes || minutes > maxMinutes} onClick={() => void reserve()} type="button">{busy ? "正在锁定卡时…" : "锁定卡时并创建合同"}</button>
          {error ? <p className={styles.inlineError} role="alert">{error}</p> : null}
          {loginRequired ? <Link className={styles.loginLink} href={`/login?returnTo=${encodeURIComponent(`/gpu/offers/${offer.id}`)}`}>登录或注册后继续</Link> : null}
          <small>公开自助充值和自动回购保持关闭；试运营卡时由平台双人审批发放。</small>
        </aside>
      </div>
    </main>
  );
}
