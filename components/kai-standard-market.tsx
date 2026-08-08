"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  formatCnyMicros,
  formatKaiDateTime,
  formatKaiDecimal,
  parseKaiStandardQuoteEnvelope,
  quotePresentationState,
  snapshotIsExpired,
  type KaiStandardQuoteEnvelope,
} from "@/lib/kai-standard-view-models";
import { KaiStandardEmpty, KaiStandardError, KaiStandardLoading } from "./kai-standard-state";
import styles from "./kai-standard-pages.module.css";

type LoadState =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "ready"; data: KaiStandardQuoteEnvelope };

export function KaiStandardMarket() {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<LoadState>({ kind: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/v1/standardization/quotes", { credentials: "same-origin", cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("QUOTE_REQUEST_FAILED");
        return parseKaiStandardQuoteEnvelope(await response.json());
      })
      .then((data) => setState({ kind: "ready", data }))
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setState({ kind: "error" });
      });
    return () => controller.abort();
  }, [attempt]);

  if (state.kind === "loading") return <KaiStandardLoading label="标准卡时行情" />;
  if (state.kind === "error") {
    return <KaiStandardError description="服务端没有返回可核对的行情快照。页面不会用初始化数字代替市场报价。" onRetry={() => { setState({ kind: "loading" }); setAttempt((value) => value + 1); }} />;
  }

  const { policy, quotes, snapshot } = state.data;
  const presentation = quotePresentationState(state.data);
  const stale = presentation === "STALE";
  const unavailable = presentation === "UNAVAILABLE";

  return (
    <div aria-live="polite">
      <div className={styles.statusBar}>
        <div className={styles.statusItem}><span>政策版本</span><strong>{policy.version}</strong></div>
        <div className={styles.statusItem}><span>行情截至</span><strong>{formatKaiDateTime(snapshot.asOf)}</strong></div>
        <div className={styles.statusItem}><span>有效至</span><strong>{formatKaiDateTime(snapshot.expiresAt)}</strong></div>
      </div>

      {unavailable ? (
        <KaiStandardEmpty title="当前没有可发布的标准卡时快照" description="缺少有效样本或标准化结果时，系统不展示换算价格。请稍后重新读取。" />
      ) : (
        <>
          {stale && (
            <div className={styles.warning} role="alert">
              <strong>这期行情已经过期</strong>
              <p>下方数据只保留历史观察意义，不能作为新订单、置换或结算依据。</p>
            </div>
          )}

          <div className={styles.threeWay} aria-label="三类数据的边界">
            <article className={styles.definition}>
              <b>DELIVERY FACT</b><h2>原生容量</h2>
              <p>卡时、服务器时、核时、模型实例时、Token 容量时、NAS TiB时和机柜容量，是订单真正锁定和交付的数量。</p>
            </article>
            <article className={styles.definition}>
              <b>MARKET COMPARISON</b><h2>KAI 市场等值</h2>
              <p>把同一时点的市场价值换算为 KAI-SCH，方便跨品类比较；它不是资金，也不代表固定兑换。</p>
            </article>
            <article className={styles.definition}>
              <b>PAYMENT FACT</b><h2>人民币结算</h2>
              <p>买方按订单价格支付，供应方在完成交付、计量和验收后按约定结算；最终金额以订单和支付记录为准。</p>
            </article>
          </div>

          <section className={styles.section} aria-labelledby="kai-sch-price-title">
            <div className={styles.sectionHead}>
              <h2 id="kai-sch-price-title">标准卡时人民币参考区间</h2>
              <p>单位：人民币 / KAI-SCH。参考区间描述样本分布，不构成供应商挂牌或买方成交承诺。</p>
            </div>
            <div className={styles.priceStrip}>
              <div className={styles.priceItem}><span>P25</span><strong>{formatCnyMicros(snapshot.p25CnyMicros)}</strong></div>
              <div className={styles.priceItem}><span>P50 市场中位</span><strong>{formatCnyMicros(snapshot.p50CnyMicros)}</strong></div>
              <div className={styles.priceItem}><span>P75</span><strong>{formatCnyMicros(snapshot.p75CnyMicros)}</strong></div>
              <div className={styles.priceItem}><span>有效样本</span><strong>{snapshot.sampleCount.toLocaleString("zh-CN")} 条</strong></div>
            </div>
          </section>

          <section className={styles.section} aria-labelledby="native-conversion-title">
            <div className={styles.sectionHead}>
              <h2 id="native-conversion-title">原生单位的市场等值</h2>
              <p>每行只说明“1 个原生单位在当期约等值多少 KAI-SCH”，实际订单仍交付原生资源。</p>
            </div>
            {quotes.length === 0 ? (
              <KaiStandardEmpty title="当前分组没有可比较报价" description="快照存在，但没有满足规格、地区、时间和样本要求的原生单位报价。" />
            ) : (
              <div className={styles.tableWrap} tabIndex={0} aria-label="标准卡时行情明细表，支持横向滚动">
                <table className={styles.table}>
                  <caption>原生资源单位折算为 KAI 标准卡时市场等值的分位区间</caption>
                  <thead><tr><th scope="col">资源与地区</th><th scope="col">原生单位</th><th scope="col">P25 等值</th><th scope="col">P50 等值</th><th scope="col">P75 等值</th><th scope="col">样本与时间</th></tr></thead>
                  <tbody>
                    {quotes.map((quote) => {
                      const quoteStale = stale || snapshotIsExpired(quote.expiresAt);
                      return (
                        <tr key={`${quote.productCode}:${quote.productVersionId}:${quote.region}:${quote.nativeUnitCode}`}>
                          <th scope="row">{quote.productLabel}<span className={styles.secondaryValue}>{quote.region} · {quote.productCode} · 版本 {quote.productVersionId}</span></th>
                          <td><span className={styles.primaryValue}>1 {quote.nativeUnitLabel}</span><span className={styles.secondaryValue}>{quote.nativeUnitCode}</span></td>
                          <td><span className={styles.primaryValue}>{formatKaiDecimal(quote.p25KaiSch)} KAI-SCH</span></td>
                          <td><span className={styles.primaryValue}>{formatKaiDecimal(quote.p50KaiSch)} KAI-SCH</span></td>
                          <td><span className={styles.primaryValue}>{formatKaiDecimal(quote.p75KaiSch)} KAI-SCH</span></td>
                          <td>{quote.sampleCount.toLocaleString("zh-CN")} 条<span className={styles.secondaryValue}>{formatKaiDateTime(quote.asOf)}</span>{quoteStale && <span className={styles.staleTag}>已过期</span>}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <div className={styles.policyGrid}>
            <section className={styles.policyBlock} aria-labelledby="policy-title">
              <h2 id="policy-title">当前基准：{policy.benchmarkLabel}</h2>
              <p>单位代码：{policy.unitCode}。标准卡时只承担价格比较作用，订单创建时必须保存当时政策版本、原生数量、行情时间和最终人民币价格。</p>
              <ul>
                <li>供应商可自主挂牌，KAI 参考区间不是统一规定售价。</li>
                <li>跨品类置换只能锁定一笔有期限的报价，不能形成永久固定比例。</li>
                <li>促销价、规格缺失和过期数据不应进入当期有效行情。</li>
              </ul>
            </section>
            <aside className={styles.policyBlock} aria-labelledby="next-title">
              <h2 id="next-title">继续交易</h2>
              <p>采购和出售都从具体原生资源开始，页面不会把 KAI 等值变成可交付数量。</p>
              <div className={styles.actions}>
                <Link className={styles.primaryLink} href="/market/listings">购买在售资源</Link>
                <Link className={styles.secondaryLink} href="/buyer/orders">我的采购订单</Link>
                <Link className={styles.secondaryLink} href="/request?mode=rental">发布采购需求</Link>
                <Link className={styles.secondaryLink} href="/supply/new">登记可售容量</Link>
              </div>
            </aside>
          </div>
        </>
      )}
    </div>
  );
}
