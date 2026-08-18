"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  accountPresentationState,
  formatCnyCents,
  formatKaiDateTime,
  formatKaiSchDisplay,
  memberResponseState,
  parseKaiHoursAccountEnvelope,
  type KaiHoursAccountEnvelope,
} from "@/lib/kai-standard-view-models";
import { KaiStandardEquivalentLine } from "./kai-standard-equivalent-line";
import { KaiStandardEmpty, KaiStandardError, KaiStandardLoading, KaiStandardSignIn } from "./kai-standard-state";
import styles from "./kai-standard-pages.module.css";

type LoadState =
  | { kind: "loading" }
  | { kind: "signed-out" }
  | { kind: "forbidden" }
  | { kind: "error" }
  | { kind: "ready"; data: KaiHoursAccountEnvelope };

export function KaiStandardAccount() {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<LoadState>({ kind: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/v1/member/kai-hours", { credentials: "same-origin", cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const responseState = memberResponseState(response.status);
        if (responseState === "SIGNED_OUT") return { kind: "signed-out" } as const;
        if (responseState === "FORBIDDEN") return { kind: "forbidden" } as const;
        if (responseState === "ERROR") throw new Error("ACCOUNT_REQUEST_FAILED");
        return { kind: "ready", data: parseKaiHoursAccountEnvelope(await response.json()) } as const;
      })
      .then(setState)
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setState({ kind: "error" });
      });
    return () => controller.abort();
  }, [attempt]);

  if (state.kind === "loading") return <KaiStandardLoading label="本组织的容量与结算" />;
  if (state.kind === "signed-out") return <KaiStandardSignIn />;
  if (state.kind === "forbidden") {
    return <KaiStandardError title="当前主体不能查看这份数据" description="请切换到具有容量或订单记录的个人、企业、IDC 或云厂商主体。" onRetry={() => { setState({ kind: "loading" }); setAttempt((value) => value + 1); }} />;
  }
  if (state.kind === "error") {
    return <KaiStandardError description="服务端没有返回完整的原生容量、KAI 等值和人民币结算数据。页面不会用本地数字补齐。" onRetry={() => { setState({ kind: "loading" }); setAttempt((value) => value + 1); }} />;
  }

  const { data } = state;
  const presentation = accountPresentationState(data);
  const stale = presentation === "STALE";
  if (presentation === "UNAVAILABLE") {
    return (
      <>
        <SnapshotHeader policyVersion={data.policyVersion} asOf={data.asOf} expiresAt={data.expiresAt} />
        <KaiStandardEmpty title="当前主体没有可用的容量快照" description="缺少有效验真、容量账或结算投影时，系统不展示账户数字。" />
      </>
    );
  }

  return (
    <div aria-live="polite">
      <SnapshotHeader policyVersion={data.policyVersion} asOf={data.asOf} expiresAt={data.expiresAt} />
      {stale && (
        <div className={styles.warning} role="alert">
          <strong>账户快照已经过期</strong>
          <p>下方数字只用于核对历史，不代表当前可售、可退出或可结算状态。请等待服务端更新后再操作。</p>
        </div>
      )}

      <section className={styles.section} aria-labelledby="summary-title">
        <div className={styles.sectionHead}>
          <h2 id="summary-title">四个核心数字</h2>
          <p>KAI-SCH 只表达市场等值；人民币数字只来自订单结算事实。两者不互相覆盖。</p>
        </div>
        <div className={styles.metricGrid}>
          <article className={styles.metric}>
            <span>已验真入库等值</span><strong>{formatKaiSchDisplay(data.summary.depositedKaiSch)} KAI-SCH</strong>
            <small>所有已验真容量按当前政策版本折算的观察值，不代表人民币金额。</small>
          </article>
          <article className={styles.metric}>
            <span>当前可售等值</span><strong>{formatKaiSchDisplay(data.summary.availableKaiSch)} KAI-SCH</strong>
            <small>尚未被报价、订单或交付占用的容量等值；真正上架数量以原生单位为准。</small>
          </article>
          <article className={styles.metric}>
            <span>已完成服务等值</span><strong>{formatKaiSchDisplay(data.summary.earnedKaiSch)} KAI-SCH</strong>
            <small>已交付服务规模的等值记录，不等于收入，也不产生固定收益。</small>
          </article>
          <article className={styles.metric}>
            <span>累计结算金额</span><strong>{formatCnyCents(data.summary.settlementCnyCents)}</strong>
            <small>来自已完成订单的人民币结算事实，以支付机构和收款账户记录为准。</small>
          </article>
        </div>
      </section>

      <section className={styles.section} aria-labelledby="positions-title">
        <div className={styles.sectionHead}>
          <h2 id="positions-title">原生容量明细</h2>
          <p>原生数量负责实际锁定、交付和退出；KAI 等值只负责同一时点的市场比较。</p>
        </div>
        {data.positions.length === 0 ? (
          <KaiStandardEmpty title="当前没有容量明细" description="本组织尚无通过服务端投影返回的原生容量批次。" />
        ) : (
          <div className={styles.tableWrap} tabIndex={0} aria-label="原生容量明细表，支持横向滚动">
            <table className={styles.table}>
              <caption>本组织原生容量及其可售、订单占用 KAI 标准卡时等值</caption>
              <thead><tr><th scope="col">资源</th><th scope="col">原生容量与当前等值</th><th scope="col">订单占用等值</th></tr></thead>
              <tbody>
                {data.positions.map((position) => (
                  <tr key={`${position.productCode}:${position.productVersionId}:${position.nativeUnitLabel}`}>
                    <th scope="row">{position.productLabel}<span className={styles.secondaryValue}>{position.productCode} · 版本 {position.productVersionId}</span></th>
                    <td><KaiStandardEquivalentLine nativeAmount={position.nativeAmount} nativeUnitLabel={position.nativeUnitLabel} kaiSchAmount={position.availableKaiSch} policyVersion={data.policyVersion} asOf={data.asOf} label="当前可售等值" stale={stale} /></td>
                    <td><span className={styles.primaryValue}>{formatKaiSchDisplay(position.heldKaiSch)} KAI-SCH</span><span className={styles.secondaryValue}>暂不能退出或重复出售</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className={styles.section} aria-labelledby="income-title">
        <div className={styles.sectionHead}>
          <h2 id="income-title">人民币收入进度</h2>
          <p>订单收入必须经过交付、计量、验收和结算；页面不把 KAI 等值当成人民币收入。</p>
        </div>
        <div className={styles.incomeGrid}>
          <article className={styles.incomeItem}><span>待确认收入</span><strong>{formatCnyCents(data.income.pendingCnyCents)}</strong><small>订单已经形成，仍需完成交付、验收或退款观察。</small></article>
          <article className={styles.incomeItem}><span>可结算收入</span><strong>{formatCnyCents(data.income.payableCnyCents)}</strong><small>已满足业务结算条件，实际到账仍以支付或分账结果为准。</small></article>
          <article className={styles.incomeItem}><span>已结算收入</span><strong>{formatCnyCents(data.income.settledCnyCents)}</strong><small>服务端已经记录完成结算的历史金额。</small></article>
        </div>
      </section>

      <div className={styles.policyGrid}>
        <section className={styles.policyBlock} aria-labelledby="liquidity-title">
          <h2 id="liquidity-title">不作“随时变现”承诺</h2>
          <p>支持随时发布符合条件的可售容量；是否成交取决于买方需求、供应商报价、验真状态和交付条件。成交订单完成交付和验收后，才按约定周期结算。</p>
          <ul>
            <li>未被订单占用且符合规则的原生容量，可以申请退出。</li>
            <li>订单占用和交付中的容量，不能退出或重复出售。</li>
            <li>行情等值变化不会自动改变订单价格或结算金额。</li>
          </ul>
        </section>
        <aside className={styles.policyBlock} aria-labelledby="account-actions-title">
          <h2 id="account-actions-title">管理真实业务</h2>
          <p>出售从具体资源与时间窗开始；采购从具体服务规格开始。</p>
          <div className={styles.actions}>
            <Link className={styles.primaryLink} href="/supply/new">登记可售容量</Link>
            <Link className={styles.secondaryLink} href="/member">返回交易工作台</Link>
          </div>
        </aside>
      </div>
    </div>
  );
}

function SnapshotHeader({ policyVersion, asOf, expiresAt }: { policyVersion: string; asOf: string; expiresAt: string }) {
  return (
    <div className={styles.statusBar}>
      <div className={styles.statusItem}><span>政策版本</span><strong>{policyVersion}</strong></div>
      <div className={styles.statusItem}><span>账户截至</span><strong>{formatKaiDateTime(asOf)}</strong></div>
      <div className={styles.statusItem}><span>有效至</span><strong>{formatKaiDateTime(expiresAt)}</strong></div>
    </div>
  );
}
