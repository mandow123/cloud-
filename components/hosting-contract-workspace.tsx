"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { createIdempotencyKey, MarketplaceApiError, marketplaceErrorMessage, marketplaceGet, marketplacePost } from "@/lib/client/marketplace-client";
import type { BuyerHostingContract } from "@/lib/hosting-v2-client";
import { formatCardHours, formatHostingTime, hostingContractStatusLabel } from "@/lib/hosting-v2-client";
import styles from "./hosting-marketplace.module.css";

const POLLED_STATUSES = new Set(["PROVISIONING", "READY", "IN_SERVICE", "SETTLED", "CLEANING"]);
const CANCELLABLE_STATUSES = new Set(["RESERVED", "CARD_HOURS_HELD", "PAID", "PROVISIONING", "READY"]);
const WORKFLOW = ["CARD_HOURS_HELD", "PROVISIONING", "READY", "IN_SERVICE", "AWAITING_ACCEPTANCE", "CLEANING", "CLEANED"] as const;

function workflowIndex(status: BuyerHostingContract["status"]) {
  if (status === "SETTLED") return 5;
  return WORKFLOW.indexOf(status as (typeof WORKFLOW)[number]);
}

export function HostingContractWorkspace({ contractId }: { contractId: string }) {
  const [contract, setContract] = useState<BuyerHostingContract | null>(null);
  const [publicKey, setPublicKey] = useState("");
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [queuedAction, setQueuedAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loginRequired, setLoginRequired] = useState(false);
  const requestKeys = useRef<Record<string, string>>({});

  const load = useCallback(async (quiet = false) => {
    try {
      const result = await marketplaceGet<{ record: BuyerHostingContract }>(`/api/v2/contracts/${encodeURIComponent(contractId)}`);
      setContract(result.record);
      setError(null);
      setLoginRequired(false);
    } catch (cause) {
      setLoginRequired(cause instanceof MarketplaceApiError && cause.status === 401);
      if (!quiet || cause instanceof MarketplaceApiError && cause.status !== 0) setError(marketplaceErrorMessage(cause, "合同状态暂时无法读取。"));
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [contractId]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  useEffect(() => {
    if (!contract || !POLLED_STATUSES.has(contract.status)) return;
    const timer = window.setInterval(() => { void load(true); }, 5_000);
    return () => window.clearInterval(timer);
  }, [contract, load]);

  async function mutate(action: string, path: string, payload: unknown) {
    if (busyAction) return;
    setBusyAction(action); setError(null);
    try {
      requestKeys.current[action] ??= createIdempotencyKey(`hosting-${action}`);
      const result = await marketplacePost<BuyerHostingContract>(path, payload, requestKeys.current[action], 20_000);
      delete requestKeys.current[action];
      setContract(result.record);
      if (action === "start" || action === "stop" || action === "ssh-key" || action === "accept") setQueuedAction(action);
      window.setTimeout(() => { setQueuedAction(null); void load(true); }, 1_500);
    } catch (cause) {
      setLoginRequired(cause instanceof MarketplaceApiError && cause.status === 401);
      setError(marketplaceErrorMessage(cause, "操作没有完成，请核对当前状态后重试。"));
    } finally { setBusyAction(null); }
  }

  if (loading) return <main className={styles.market}><div className={styles.loading}>正在读取合同、实例和计量状态…</div></main>;
  if (!contract) return <main className={styles.market}><section className={styles.error} role="alert"><strong>无法打开租赁工作台</strong><span>{error}</span>{loginRequired ? <Link href={`/login?returnTo=${encodeURIComponent(`/gpu/contracts/${contractId}`)}`}>登录或注册</Link> : <Link href="/gpu/contracts">返回我的租赁</Link>}</section></main>;

  const currentStep = workflowIndex(contract.status);
  const endpoint = contract.endpointDisplay;
  return (
    <main className={styles.market}>
      <header className={styles.detailHeader}>
        <div><Link href="/gpu/contracts">← 我的租赁</Link><p className={styles.eyebrow}>INSTANCE DELIVERY WORKSPACE</p><h1>{contract.snapshot.title}</h1><p>{contract.snapshot.gpuModel} · {contract.snapshot.region} · 合同 {contract.id}</p></div>
        <span className={styles.statusPill} data-status={contract.status}>{hostingContractStatusLabel(contract.status)}</span>
      </header>

      <ol className={styles.workflow} aria-label="租赁交付进度">
        {WORKFLOW.map((status, index) => <li className={index <= currentStep ? styles.workflowDone : undefined} key={status}><span>{String(index + 1).padStart(2, "0")}</span><strong>{hostingContractStatusLabel(status)}</strong></li>)}
      </ol>

      <div className={styles.workspaceGrid}>
        <section className={styles.workspacePanel}>
          <div className={styles.panelHeading}><div><p className={styles.eyebrow}>NEXT ACTION</p><h2>当前操作</h2></div>{queuedAction ? <span className={styles.queued}>命令已进入安全队列</span> : null}</div>

          {contract.status === "CARD_HOURS_HELD" ? <div className={styles.actionBlock}><h3>提交本机 SSH 公钥</h3><p>平台只保存指纹；临时公钥由 Host Agent 写入本次独立工作区，清理时自动撤销。</p><label><span>OpenSSH 公钥</span><textarea rows={5} value={publicKey} onChange={(event) => { setPublicKey(event.target.value); delete requestKeys.current["ssh-key"]; }} placeholder="ssh-ed25519 AAAA… your-device" /></label><button className={styles.primary} disabled={Boolean(busyAction) || publicKey.trim().length < 40} onClick={() => void mutate("ssh-key", `/api/v2/contracts/${encodeURIComponent(contract.id)}/ssh-key`, { publicKey: publicKey.trim() })} type="button">{busyAction === "ssh-key" ? "正在提交开通任务…" : "提交公钥并开始开通"}</button></div> : null}
          {contract.status === "PROVISIONING" || contract.status === "PAID" ? <div className={styles.actionBlock}><h3>Host Agent 正在开通实例</h3><p>正在创建受限容器、注入临时公钥并验证 SSH 连接；页面每 5 秒读取一次服务端状态。</p><span className={styles.progressLine} /></div> : null}
          {contract.status === "READY" ? <div className={styles.actionBlock}><h3>实例已就绪</h3><p>SSH 入口已经由 Agent 验证。启动后才进入服务计量。</p><code className={styles.endpoint}>{endpoint ?? "入口等待确认"}</code><button className={styles.primary} disabled={Boolean(busyAction)} onClick={() => void mutate("start", `/api/v2/contracts/${encodeURIComponent(contract.id)}/start`, {})} type="button">{busyAction === "start" ? "正在发送启动命令…" : "启动实例并开始计量"}</button></div> : null}
          {contract.status === "IN_SERVICE" ? <div className={styles.actionBlock}><h3>实例服务中</h3><p>计量由 Host Agent 和服务端完成，浏览器不能提交运行时长或金额。</p><code className={styles.endpoint}>{endpoint ?? "SSH 入口受保护"}</code><button className={styles.dangerButton} disabled={Boolean(busyAction)} onClick={() => void mutate("stop", `/api/v2/contracts/${encodeURIComponent(contract.id)}/stop`, {})} type="button">{busyAction === "stop" ? "正在发送停止命令…" : "停止实例并结束计量"}</button></div> : null}
          {contract.status === "AWAITING_ACCEPTANCE" ? <div className={styles.actionBlock}><h3>服务已停止，等待验收</h3><p>确认后按服务端实际计量扣减，剩余锁定卡时释放，并生成供应方租金收益。</p><button className={styles.primary} disabled={Boolean(busyAction)} onClick={() => void mutate("accept", `/api/v2/contracts/${encodeURIComponent(contract.id)}/accept`, {})} type="button">{busyAction === "accept" ? "正在结算并安排清理…" : "确认验收并结算"}</button></div> : null}
          {contract.status === "SETTLED" || contract.status === "CLEANING" ? <div className={styles.actionBlock}><h3>正在撤权和清理</h3><p>Agent 正在删除本次容器、公钥和工作目录。清理凭证通过后资源才会重新挂牌。</p><span className={styles.progressLine} /></div> : null}
          {contract.status === "CLEANED" ? <div className={styles.successBlock}><h3>租赁闭环已完成</h3><p>计量、结算、撤权和清理均已完成，临时访问权限已经失效。</p><Link className={styles.primary} href="/gpu">继续选择 GPU</Link></div> : null}
          {["CANCELLED", "FAILED", "DISPUTED", "REFUNDED"].includes(contract.status) ? <div className={styles.error} role="status"><strong>{hostingContractStatusLabel(contract.status)}</strong><span>该合同已退出正常交付流程，平台保留状态和审计记录。</span></div> : null}

          {CANCELLABLE_STATUSES.has(contract.status) ? <div className={styles.cancelBar}><span>实例开始服务前可释放本次预留。</span><button disabled={Boolean(busyAction)} onClick={() => void mutate("cancel", `/api/v2/contracts/${encodeURIComponent(contract.id)}/cancel`, { reason: "采购方在开通前主动取消预留" })} type="button">取消并释放卡时</button></div> : null}
          {error ? <p className={styles.inlineError} role="alert">{error}</p> : null}
        </section>

        <aside className={styles.auditPanel}>
          <p className={styles.eyebrow}>CONTRACT SNAPSHOT</p><h2>冻结合同</h2>
          <dl className={styles.detailList}>
            <div><dt>锁定卡时</dt><dd>{formatCardHours(contract.heldMicros)}</dd></div><div><dt>结算卡时</dt><dd>{formatCardHours(contract.settledMicros ?? 0)}</dd></div>
            <div><dt>预留时长</dt><dd>{Math.ceil(contract.reservedSeconds / 60)} 分钟</dd></div><div><dt>实际计量</dt><dd>{contract.measuredSeconds === null ? "等待 Agent" : `${contract.measuredSeconds} 秒`}</dd></div>
            <div><dt>网站价</dt><dd>{formatCardHours(contract.snapshot.cardHourMicrosPerGpuHour)} / GPU 小时</dd></div><div><dt>镜像</dt><dd>{contract.snapshot.approvedImage}</dd></div>
            <div><dt>SSH 指纹</dt><dd>{contract.sshPublicKeyFingerprint ?? "尚未提交"}</dd></div><div><dt>条款</dt><dd>{contract.snapshot.termsVersion}</dd></div>
            <div><dt>开始</dt><dd>{formatHostingTime(contract.startedAt)}</dd></div><div><dt>停止</dt><dd>{formatHostingTime(contract.stoppedAt)}</dd></div>
          </dl>
          <small>状态版本 v{contract.version} · 更新于 {formatHostingTime(contract.updatedAt)}</small>
        </aside>
      </div>
    </main>
  );
}
