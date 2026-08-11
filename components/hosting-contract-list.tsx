"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { MarketplaceApiError, marketplaceErrorMessage, marketplaceGet } from "@/lib/client/marketplace-client";
import type { BuyerHostingContract } from "@/lib/hosting-v2-client";
import { formatCardHours, formatHostingTime, hostingContractStatusLabel } from "@/lib/hosting-v2-client";
import styles from "./hosting-marketplace.module.css";

export function HostingContractList() {
  const [contracts, setContracts] = useState<BuyerHostingContract[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loginRequired, setLoginRequired] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void marketplaceGet<{ records: BuyerHostingContract[] }>("/api/v2/contracts")
      .then((result) => { if (!cancelled) setContracts(result.records); })
      .catch((cause) => {
        if (cancelled) return;
        setLoginRequired(cause instanceof MarketplaceApiError && cause.status === 401);
        setError(marketplaceErrorMessage(cause, "租赁记录暂时无法读取。"));
      });
    return () => { cancelled = true; };
  }, []);

  const records = useMemo(() => [...(contracts ?? [])].sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt)), [contracts]);

  return (
    <main className={styles.market}>
      <header className={styles.marketHeader}>
        <div><p className={styles.eyebrow}>BUYER CONTRACTS</p><h1>我的 GPU 租赁</h1><p>从卡时锁定到实例清理，每一步都由服务端状态和 Host Agent 凭证驱动。</p></div>
        <div className={styles.headerActions}><Link href="/gpu">返回 GPU 市场</Link></div>
      </header>

      {error ? <section className={styles.error} role="alert"><strong>无法读取租赁记录</strong><span>{error}</span>{loginRequired ? <Link href="/login?returnTo=%2Fgpu%2Fcontracts">登录或注册</Link> : null}</section> : null}
      {!contracts && !error ? <div className={styles.loading} role="status">正在读取租赁合同和实例状态…</div> : null}
      {contracts ? (
        <section className={styles.contractTable} aria-label="GPU 租赁合同">
          <div className={styles.contractHead}><span>合同与资源</span><span>状态</span><span>锁定 / 结算</span><span>最近更新</span><span>操作</span></div>
          {records.map((contract) => (
            <article className={styles.contractRow} key={contract.id}>
              <div><h2>{contract.snapshot.title}</h2><small>{contract.snapshot.gpuModel} · {contract.snapshot.region}</small><code>{contract.id}</code></div>
              <div><span className={styles.statusPill} data-status={contract.status}>{hostingContractStatusLabel(contract.status)}</span></div>
              <div><strong>{formatCardHours(contract.settledMicros ?? contract.heldMicros)}</strong><small>{contract.settledMicros === null ? "已锁定卡时" : "已结算卡时"}</small></div>
              <div><strong>{formatHostingTime(contract.updatedAt)}</strong><small>合同版本 v{contract.version}</small></div>
              <Link className={styles.rowAction} href={`/gpu/contracts/${encodeURIComponent(contract.id)}`}>进入工作台</Link>
            </article>
          ))}
          {!records.length ? <div className={styles.empty}>还没有 GPU 租赁。可以先从市场选择一条经过验真的报价。</div> : null}
        </section>
      ) : null}
    </main>
  );
}
