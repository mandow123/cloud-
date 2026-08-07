"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { marketplaceErrorMessage } from "@/lib/client/marketplace-client";
import {
  getSupplyDashboard,
  supplyApiUnavailable,
  type SupplyPool,
  type SupplyVerificationJob,
} from "@/components/supply-api-client";
import { SupplyOffersList } from "@/components/supply-offers-list";

function poolKind(pool: SupplyPool) {
  return pool.assetKind;
}

function poolKindLabel(pool: SupplyPool) {
  const kind = poolKind(pool);
  if (kind === "H100_8X_NODE") return "8×H100 SXM5 80GB";
  if (kind === "MAC_MINI") return "Mac mini 资产池";
  return kind;
}

function memberCount(pool: SupplyPool) {
  return pool.memberCount;
}

function statusTone(status: string) {
  const value = status.toUpperCase();
  if (["VERIFIED", "READY", "PASSED", "COMPLETED"].includes(value)) return "border-[var(--success)] bg-[var(--success-bg)]";
  if (["FAILED", "REJECTED", "SUSPENDED"].includes(value)) return "border-[var(--error)] bg-[var(--error-bg)]";
  return "border-[var(--warning)] bg-[var(--warning-bg)]";
}

export function SupplyAssetsDashboard() {
  const [pools, setPools] = useState<SupplyPool[]>([]);
  const [jobs, setJobs] = useState<SupplyVerificationJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError("");
    setLoading(true);
    try {
      const dashboard = await getSupplyDashboard();
      setPools(dashboard.pools);
      setJobs(dashboard.verificationJobs);
      setUpdatedAt(dashboard.updatedAt ?? new Date().toISOString());
    } catch (loadError) {
      setError(supplyApiUnavailable(loadError)
        ? "资源资产 API 尚未就绪；本页没有回退到静态样本或本地假数据。"
        : marketplaceErrorMessage(loadError, "暂时无法读取供应资源资产。"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void getSupplyDashboard()
      .then((dashboard) => {
        if (cancelled) return;
        setPools(dashboard.pools);
        setJobs(dashboard.verificationJobs);
        setUpdatedAt(dashboard.updatedAt ?? new Date().toISOString());
      })
      .catch((loadError: unknown) => {
        if (cancelled) return;
        setError(supplyApiUnavailable(loadError)
          ? "资源资产 API 尚未就绪；本页没有回退到静态样本或本地假数据。"
          : marketplaceErrorMessage(loadError, "暂时无法读取供应资源资产。"));
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const latestJobByPool = useMemo(() => {
    const map = new Map<string, SupplyVerificationJob>();
    for (const job of jobs) {
      const current = map.get(job.poolId);
      if (!current || Date.parse(job.completedAt ?? job.createdAt) > Date.parse(current.completedAt ?? current.createdAt)) map.set(job.poolId, job);
    }
    return map;
  }, [jobs]);

  const verifiedCount = pools.filter((pool) => pool.memberCount > 0 && pool.verifiedCount === pool.memberCount).length;
  const macCount = pools.filter((pool) => poolKind(pool) === "MAC_MINI").reduce((sum, pool) => sum + memberCount(pool), 0);

  return (
    <div className="shell py-10 sm:py-14">
      <SupplyOffersList />
      <section className="mt-12" aria-labelledby="assets-title">
        <div className="flex flex-wrap items-end justify-between gap-5">
          <div>
            <p className="kicker">Server-backed inventory</p>
            <h2 className="section-heading" id="assets-title">资源资产</h2>
            <p className="section-lead text-base">这里是 KAI 自有 H100 / Mac 快捷预设形成的资源池，只展示服务端数据，不把浏览器预览当作已入库。</p>
          </div>
          <button className="button button-secondary" disabled={loading} onClick={() => void load()} type="button">{loading ? "正在刷新…" : "刷新状态"}</button>
        </div>

        {error ? <div className="mt-6 border-l-4 border-[var(--error)] bg-[var(--error-bg)] p-5 text-[var(--error)]" role="alert">{error}</div> : null}

        <dl className="mt-7 grid gap-px bg-[var(--border)] sm:grid-cols-2 lg:grid-cols-4">
          <div className="bg-[var(--surface)] p-5"><dt className="text-xs text-[var(--muted)]">资源池</dt><dd className="m-0 mt-1 text-3xl font-semibold text-[var(--ink)]">{pools.length}</dd></div>
          <div className="bg-[var(--surface)] p-5"><dt className="text-xs text-[var(--muted)]">已验真资源池</dt><dd className="m-0 mt-1 text-3xl font-semibold text-[var(--ink)]">{verifiedCount}</dd></div>
          <div className="bg-[var(--surface)] p-5"><dt className="text-xs text-[var(--muted)]">Mac mini 已入库</dt><dd className="m-0 mt-1 text-3xl font-semibold text-[var(--ink)]">{macCount}</dd></div>
          <div className="bg-[var(--surface)] p-5"><dt className="text-xs text-[var(--muted)]">数据更新时间</dt><dd className="m-0 mt-2 text-sm font-semibold text-[var(--ink)]">{updatedAt ? new Date(updatedAt).toLocaleString("zh-CN") : "—"}</dd></div>
        </dl>

        {loading && pools.length === 0 ? <p className="mt-6 border-l-2 border-[var(--accent)] pl-4" role="status">正在读取资源池和验真任务…</p> : null}

        {!loading && !error && pools.length === 0 ? (
          <div className="mt-7 border-y border-[var(--border)] bg-[var(--surface)] px-6 py-14 text-center">
            <h3 className="m-0 text-2xl">尚无 KAI 自有资产池</h3>
            <p className="mx-auto mt-2 max-w-xl text-sm text-[var(--text)]">通用供应方请使用上方资源上架；这里仅保留 KAI 自有 H100 与 Mac 快捷预设。</p>
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <Link className="button button-primary" href="/supply/h100/new">申报 H100</Link>
              <Link className="button button-secondary" href="/supply/mac/import">导入 Mac</Link>
            </div>
          </div>
        ) : null}

        {pools.length > 0 ? (
          <div className="mt-7 overflow-x-auto border border-[var(--border)]">
            <table className="data-table min-w-[920px]">
              <caption className="sr-only">供应资源池与最新验真状态</caption>
              <thead><tr><th scope="col">资源池</th><th scope="col">类型 / 地区</th><th className="num" scope="col">成员</th><th scope="col">资源状态</th><th scope="col">最新验真</th><th scope="col">发布资格</th></tr></thead>
              <tbody>
                {pools.map((pool) => {
                  const job = latestJobByPool.get(pool.id);
                  const mac = poolKind(pool) === "MAC_MINI";
                  const verified = pool.memberCount > 0 && pool.verifiedCount === pool.memberCount;
                  return (
                    <tr key={pool.id}>
                      <th scope="row"><strong className="block text-[var(--ink)]">{pool.name}</strong><span className="font-mono text-xs text-[var(--muted)]">{pool.id}</span></th>
                      <td>{poolKindLabel(pool)}<span className="mt-1 block text-xs text-[var(--muted)]">{pool.region}</span></td>
                      <td className="num">{memberCount(pool)}</td>
                      <td><span className={`inline-flex border-l-2 px-3 py-2 text-xs font-semibold ${statusTone(pool.status)}`}>{pool.status}</span></td>
                      <td>{job ? <><strong className="block text-[var(--ink)]">{job.status}</strong><span className="font-mono text-xs text-[var(--muted)]">{job.id}</span></> : verified ? "全部成员已验真" : pool.verifiedCount > 0 ? `${pool.verifiedCount} / ${pool.memberCount} 已验真` : "等待验真"}</td>
                      <td>{mac ? <span className="font-semibold text-[var(--warning)]">首期永久禁止成交</span> : verified ? <span className="font-semibold text-[var(--warning)]">待支付宝 LIVE</span> : <span>等待验真通过</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
    </div>
  );
}
