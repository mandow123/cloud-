"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { createIdempotencyKey, MarketplaceApiError, marketplaceErrorMessage, marketplaceGet, marketplacePost } from "@/lib/client/marketplace-client";
import type { BuyerHostingContract } from "@/lib/hosting-v2-client";
import { formatCardHours, formatEvidenceDigest, formatHostingTime, hostingContractStatusLabel } from "@/lib/hosting-v2-client";
import styles from "./hosting-marketplace.module.css";

const POLLED_STATUSES = new Set(["PROVISIONING", "READY", "IN_SERVICE", "AWAITING_ACCEPTANCE", "SETTLED", "CLEANING", "DISPUTED", "FAILED"]);
const CANCELLABLE_STATUSES = new Set(["RESERVED", "CARD_HOURS_HELD", "PAID"]);
const WORKFLOW = ["CARD_HOURS_HELD", "PROVISIONING", "READY", "IN_SERVICE", "AWAITING_ACCEPTANCE", "CLEANING", "CLEANED"] as const;

function workflowIndex(status: BuyerHostingContract["status"]) {
  if (status === "SETTLED") return 5;
  return WORKFLOW.indexOf(status as (typeof WORKFLOW)[number]);
}

function acceptanceDeadline(contract: BuyerHostingContract) {
  if (!contract.stoppedAt) return null;
  const deadline = new Date(Date.parse(contract.stoppedAt) + contract.snapshot.acceptanceWindowSeconds * 1_000);
  return Number.isNaN(deadline.getTime()) ? null : deadline.toISOString();
}

export function HostingContractWorkspace({ contractId }: { contractId: string }) {
  const [contract, setContract] = useState<BuyerHostingContract | null>(null);
  const [publicKey, setPublicKey] = useState("");
  const [disputeReason, setDisputeReason] = useState("");
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
  const acceptanceDeadlineAt = acceptanceDeadline(contract);
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
          {contract.status === "AWAITING_ACCEPTANCE" ? <div className={styles.actionBlock}><h3>服务已停止，等待验收</h3><p>请在 {formatHostingTime(acceptanceDeadlineAt)} 前核对计量。确认后按实际计量扣减并释放剩余卡时；逾期且未发起争议，平台将按冻结合同和计量凭证自动验收、结算并清理。</p><button className={styles.primary} disabled={Boolean(busyAction)} onClick={() => void mutate("accept", `/api/v2/contracts/${encodeURIComponent(contract.id)}/accept`, {})} type="button">{busyAction === "accept" ? "正在结算并安排清理…" : "确认验收并结算"}</button><label><span>发现交付或计量问题</span><textarea rows={3} value={disputeReason} onChange={(event) => { setDisputeReason(event.target.value); delete requestKeys.current.dispute; }} placeholder="请具体描述连接、运行或计量问题（至少 8 个字符）" /></label><button className={styles.dangerButton} disabled={Boolean(busyAction) || disputeReason.trim().length < 8} onClick={() => void mutate("dispute", `/api/v2/contracts/${encodeURIComponent(contract.id)}/dispute`, { reason: disputeReason.trim() })} type="button">{busyAction === "dispute" ? "正在冻结订单…" : "发起争议并冻结结算"}</button></div> : null}
          {contract.status === "SETTLED" || contract.status === "CLEANING" ? <div className={styles.actionBlock}><h3>{contract.evidence?.deliveryFailure ? "开通未成功，正在退款并安全清理" : "正在撤权和清理"}</h3><p>{contract.evidence?.deliveryFailure ? "本单锁定卡时已全额退回；Agent 正在停止并删除可能残留的容器、公钥和工作目录。清理凭证通过后资源才会恢复可售。" : "Agent 正在删除本次容器、公钥和工作目录。清理凭证通过后资源才会重新挂牌。"}</p><span className={styles.progressLine} /></div> : null}
          {contract.status === "CLEANED" ? <div className={styles.successBlock}><h3>租赁闭环已完成</h3><p>计量、结算、撤权和清理均已完成，临时访问权限已经失效。</p><Link className={styles.primary} href="/gpu">继续选择 GPU</Link></div> : null}
          {contract.status === "DISPUTED" ? <div className={styles.error} role="status"><strong>争议处理中，卡时继续冻结</strong><span>平台管理员将依据连接、计量与合同证据提出方案，并由独立财务复核。裁决完成前不会向供应方结算，也不会重新挂牌机器。</span></div> : null}
          {contract.status === "REFUNDED" ? <div className={styles.successBlock} role="status"><h3>{contract.evidence?.deliveryFailure ? "开通失败已全额退回并完成清理" : "争议已裁决并全额退回"}</h3><p>本单锁定卡时已返还可用余额；Host Agent 已完成撤权清理，原连接权限失效。</p><Link className={styles.primary} href="/gpu">继续选择 GPU</Link></div> : null}
          {contract.status === "FAILED" ? <div className={styles.error} role="status"><strong>开通或连接未成功，系统正在补偿</strong><span>不会产生用量或供应方收益；平台正在全额释放锁定卡时并隔离机器，完成安全清理前不会重新挂牌。</span></div> : null}
          {contract.status === "CANCELLED" ? <div className={styles.error} role="status"><strong>{hostingContractStatusLabel(contract.status)}</strong><span>该合同已退出正常交付流程，平台保留状态和审计记录。</span></div> : null}

          {CANCELLABLE_STATUSES.has(contract.status) ? <div className={styles.cancelBar}><span>尚未下发开通任务，可安全释放本次预留。</span><button disabled={Boolean(busyAction)} onClick={() => void mutate("cancel", `/api/v2/contracts/${encodeURIComponent(contract.id)}/cancel`, { reason: "采购方在开通任务下发前主动取消预留" })} type="button">取消并释放卡时</button></div> : null}
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
            <div><dt>验收截止</dt><dd>{formatHostingTime(acceptanceDeadlineAt)}</dd></div><div><dt>验收方式</dt><dd>{contract.evidence?.acceptance?.mode === "TIMEOUT" ? "到期自动验收" : contract.evidence?.acceptance?.mode === "BUYER" ? "买家确认" : "等待决定"}</dd></div>
            {contract.evidence?.dispute ? <><div><dt>争议原因</dt><dd>{contract.evidence.dispute.reason}</dd></div><div><dt>裁决进度</dt><dd>{contract.evidence.dispute.proposalStatus ?? "等待平台提案"}</dd></div></> : null}
            {contract.evidence?.deliveryFailure ? <><div><dt>失败阶段</dt><dd>{contract.evidence.deliveryFailure.stage}</dd></div><div><dt>诊断码</dt><dd>{contract.evidence.deliveryFailure.errorCode}</dd></div></> : null}
          </dl>
          {contract.evidence?.instance ? <><p className={styles.eyebrow}>DELIVERY EVIDENCE</p><h2>交付凭证</h2><dl className={styles.detailList}>
            <div><dt>实例状态</dt><dd>{contract.evidence.instance.status}</dd></div><div><dt>容器身份</dt><dd title={contract.evidence.instance.containerDigest}>{formatEvidenceDigest(contract.evidence.instance.containerDigest)}</dd></div>
            <div><dt>开通凭证</dt><dd title={contract.evidence.instance.provisionEvidenceDigest}>{formatEvidenceDigest(contract.evidence.instance.provisionEvidenceDigest)}</dd></div><div><dt>停止凭证</dt><dd title={contract.evidence.instance.stopEvidenceDigest ?? undefined}>{formatEvidenceDigest(contract.evidence.instance.stopEvidenceDigest)}</dd></div>
            <div><dt>Agent 计量</dt><dd>{contract.evidence.metering ? `${contract.evidence.metering.agentRuntimeSeconds} 秒` : "—"}</dd></div><div><dt>平台计费</dt><dd>{contract.evidence.metering ? `${contract.evidence.metering.serverMeasuredSeconds} 秒` : "—"}</dd></div>
            <div><dt>容器清理</dt><dd>{contract.evidence.cleanup?.containerRemoved ? "已验证" : "等待清理"}</dd></div><div><dt>公钥撤销</dt><dd>{contract.evidence.cleanup?.authorizedKeyRemoved ? "已验证" : "等待清理"}</dd></div>
          </dl></> : null}
          <small>状态版本 v{contract.version} · 更新于 {formatHostingTime(contract.updatedAt)}</small>
        </aside>
      </div>
    </main>
  );
}
