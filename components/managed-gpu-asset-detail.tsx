"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createIdempotencyKey, marketplaceErrorMessage, marketplacePost } from "@/lib/client/marketplace-client";
import { managedGpuStatusLabel, readManagedGpuJson, type ManagedGpuMemberSummary } from "@/lib/managed-gpu-client";
import styles from "./managed-gpu.module.css";

type ServiceRequest = Readonly<{ id: string; requestType: string; status: string }>;

export function ManagedGpuAssetDetail({ assetId }: { assetId: string }) {
  const [summary, setSummary] = useState<ManagedGpuMemberSummary | null>(null);
  const [mode, setMode] = useState<"EXIT" | "SHIP" | null>(null);
  const [reason, setReason] = useState("");
  const [country, setCountry] = useState("");
  const [addressReference, setAddressReference] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState<ServiceRequest | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    readManagedGpuJson<ManagedGpuMemberSummary>("/api/v1/member/managed-gpu/summary", controller.signal).then(setSummary).catch((reason: unknown) => {
      if (reason instanceof DOMException && reason.name === "AbortError") return;
      setError(reason instanceof Error ? reason.message : "GPU 资产暂时无法读取。");
    });
    return () => controller.abort();
  }, []);

  const asset = summary?.assets.find((record) => record.id === assetId) ?? null;
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!mode || !asset) return;
    setBusy(true); setError("");
    try {
      const endpoint = mode === "EXIT" ? "exit" : "shipping";
      const response = await marketplacePost<ServiceRequest>(`/api/v1/member/managed-gpu/assets/${encodeURIComponent(asset.id)}/${endpoint}`, mode === "EXIT" ? { reason: reason.trim() } : { destinationCountryCode: country.trim().toUpperCase(), addressReference: addressReference.trim(), reason: reason.trim() }, createIdempotencyKey(`managed-gpu-${endpoint}`));
      setCreated(response.record);
    } catch (reason) { setError(marketplaceErrorMessage(reason, "服务申请提交失败，请核对后重试。")); }
    finally { setBusy(false); }
  }

  if (error && !summary) return <section className={styles.state} role="alert"><h2>资产读取失败</h2><p>{error}</p></section>;
  if (!summary) return <section className={styles.state} role="status">正在读取当前组织的 GPU 资产…</section>;
  if (!asset) return <section className={styles.state}><h2>当前组织没有该 GPU 资产</h2><p>资产不存在，或不属于当前登录组织。</p><Link className={styles.secondaryAction} href="/member/gpu-assets">返回我的 GPU</Link></section>;

  return <div>
    <header className={styles.memberHead}><div><p className={styles.eyebrow}>PHYSICAL GPU ASSET</p><h1>{asset.productVersionId}</h1><p>序列号摘要 {asset.serialFingerprint}</p></div><span className={styles.badge}>{managedGpuStatusLabel(asset.status)}</span></header>
    <section className={styles.dashboardGrid}>
      <article className={styles.panel}><h2>设备归属</h2><p>归属组织：{summary.organizationName ?? summary.organizationId}</p><p>资产编号：{asset.id}</p><p>实体卡仅整卡确权，不拆分、不转让。</p></article>
      <article className={styles.panel}><h2>托管与 Agent</h2><p>机房：{asset.facilityId ?? "待确定"}</p><p>Agent：{asset.agentBindingId ? "已绑定并记录" : "尚未绑定"}</p><p>状态更新时间：{new Date(asset.updatedAt).toLocaleString("zh-CN")}</p></article>
    </section>
    <section className={styles.panel}><h2>退出与全球寄送</h2><p>退出托管需提前 30 天申请。平台停止接受新订单，完成已接受订单、结算和拆机审批后才能寄送；本页面不会自动拆机或发货。</p><div className={styles.formActions}><button className={styles.secondaryAction} onClick={() => { setMode("EXIT"); setCreated(null); }} type="button">申请退出托管</button><button className={styles.secondaryAction} onClick={() => { setMode("SHIP"); setCreated(null); }} type="button">申请全球寄送</button></div></section>
    {mode ? <form className={styles.quoteForm} onSubmit={submit}><h2>{mode === "EXIT" ? "退出托管申请" : "全球寄送申请"}</h2>{mode === "SHIP" ? <div className={styles.formGrid}><label><span>目的国家/地区代码</span><input maxLength={2} minLength={2} pattern="[A-Za-z]{2}" required value={country} onChange={(event) => setCountry(event.target.value)} /></label><label><span>加密地址资料引用</span><input minLength={16} maxLength={200} required value={addressReference} onChange={(event) => setAddressReference(event.target.value)} /><small>只填写地址资料在受控系统中的引用编号，不在此处填写明文地址。</small></label></div> : null}<label><span>申请原因</span><textarea minLength={4} maxLength={500} required value={reason} onChange={(event) => setReason(event.target.value)} /></label>{error ? <p className={styles.formError} role="alert">{error}</p> : null}{created ? <div className={styles.notice} role="status"><strong>申请已提交</strong><span>编号 {created.id} · {created.status}</span></div> : null}<div className={styles.formActions}><button className={styles.secondaryAction} onClick={() => setMode(null)} type="button">取消</button><button className={styles.primaryAction} disabled={busy || reason.trim().length < 4} type="submit">{busy ? "正在提交…" : "提交人工审核"}</button></div></form> : null}
  </div>;
}
