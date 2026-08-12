"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  AdminApiError,
  adminErrorMessage,
  adminGetJson,
  adminGetRows,
  adminGetSession,
  adminPostAction,
  type AdminRow,
} from "@/components/admin-api-client";
import { AdminPageHeader } from "@/components/admin-page-header";
import { AdminEmpty, AdminError, AdminLoading, AdminLoginRequired } from "@/components/admin-states";

type FeeSchedule = Readonly<{
  id: string;
  platformFeeBps: number;
  referralRewardBps: number;
  status: string;
  effectiveFrom: string;
}>;

type GoldenLoopAudit = Readonly<{
  contractId: string;
  verdict: "PASS" | "FAIL";
  checkedAt: string;
  passedChecks: number;
  totalChecks: number;
  facts: Readonly<Record<string, unknown>>;
  checks: readonly Readonly<{ key: string; label: string; status: "PASS" | "FAIL"; detail: string }>[];
}>;

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function rolesFromSession(session: Record<string, unknown> | null) {
  const admin = object(session?.admin);
  const principal = object(admin?.principal);
  return Array.isArray(principal?.roles) ? principal.roles.filter((role): role is string => typeof role === "string") : [];
}

function feeFromPayload(payload: Record<string, unknown>): FeeSchedule | null {
  const record = object(payload.record);
  if (!record || typeof record.id !== "string") return null;
  return {
    id: record.id,
    platformFeeBps: Number(record.platformFeeBps),
    referralRewardBps: Number(record.referralRewardBps),
    status: String(record.status ?? "UNKNOWN"),
    effectiveFrom: String(record.effectiveFrom ?? ""),
  };
}

function text(row: AdminRow, key: string) {
  const value = row[key];
  return typeof value === "string" ? value : "—";
}

function integer(row: AdminRow, key: string) {
  const value = Number(row[key]);
  return Number.isSafeInteger(value) ? value : 0;
}

function datetime(value: unknown) {
  if (typeof value !== "string") return "—";
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? value : new Date(parsed).toLocaleString("zh-CN");
}

function cardHours(micros: unknown) {
  const value = Number(micros);
  return Number.isSafeInteger(value) ? (value / 1_000_000).toLocaleString("zh-CN", { maximumFractionDigits: 6 }) : "—";
}

function tone(status: string) {
  if (["APPROVED", "ACTIVE", "POSTED", "APPLIED", "CLEANED", "REFUNDED"].includes(status)) return "success";
  if (["REJECTED", "SUSPENDED"].includes(status)) return "danger";
  if (["SUBMITTED", "REQUESTED", "DRAFT"].includes(status)) return "warning";
  return "";
}

async function hostingOperationsBundle() {
  const session = await adminGetSession();
  const roles = rolesFromSession(session);
  const root = roles.includes("ROOT");
  const approver = roles.includes("FINANCE_APPROVER");
  if (!root && !approver) throw new AdminApiError("当前账号没有 Hosting 试运营权限。", 403, "ADMIN_ACCESS_FORBIDDEN");
  const [grants, profiles, fee, cleanupIncidents, stopIncidents, disputes] = await Promise.all([
    adminGetRows({ path: "/api/v2/admin/card-hours/trial-grants" }),
    root ? adminGetRows({ path: "/api/v2/admin/supply/profiles" }) : Promise.resolve([]),
    root ? adminGetJson("/api/v2/admin/hosting/fees").then(feeFromPayload) : Promise.resolve(null),
    root ? adminGetRows({ path: "/api/v2/admin/hosting/cleanup-incidents" }) : Promise.resolve([]),
    root ? adminGetRows({ path: "/api/v2/admin/hosting/stop-incidents" }) : Promise.resolve([]),
    adminGetRows({ path: "/api/v2/admin/hosting/disputes" }),
  ]);
  return { session, grants, profiles, fee, cleanupIncidents, stopIncidents, disputes };
}

export function AdminHostingOperations() {
  const [session, setSession] = useState<Record<string, unknown> | null>(null);
  const [profiles, setProfiles] = useState<AdminRow[]>([]);
  const [grants, setGrants] = useState<AdminRow[]>([]);
  const [fee, setFee] = useState<FeeSchedule | null>(null);
  const [cleanupIncidents, setCleanupIncidents] = useState<AdminRow[]>([]);
  const [stopIncidents, setStopIncidents] = useState<AdminRow[]>([]);
  const [disputes, setDisputes] = useState<AdminRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const [reviewTarget, setReviewTarget] = useState("");
  const [reviewDecision, setReviewDecision] = useState("APPROVE");
  const [reviewNote, setReviewNote] = useState("");
  const [evidenceDigest, setEvidenceDigest] = useState("");
  const [platformFeeBps, setPlatformFeeBps] = useState("1000");
  const [referralRewardBps, setReferralRewardBps] = useState("300");
  const [grantOrganizationId, setGrantOrganizationId] = useState("");
  const [grantCardHours, setGrantCardHours] = useState("100");
  const [grantReason, setGrantReason] = useState("");
  const [cleanupTarget, setCleanupTarget] = useState("");
  const [cleanupReason, setCleanupReason] = useState("");
  const [stopTarget, setStopTarget] = useState("");
  const [stopReason, setStopReason] = useState("");
  const [disputeTarget, setDisputeTarget] = useState("");
  const [disputeResolution, setDisputeResolution] = useState<"REFUND" | "SETTLE">("REFUND");
  const [disputeRequestReason, setDisputeRequestReason] = useState("");
  const [disputeEvidenceDigest, setDisputeEvidenceDigest] = useState("");
  const [disputeDecisionReason, setDisputeDecisionReason] = useState("");
  const [goldenContractId, setGoldenContractId] = useState("");
  const [goldenAudit, setGoldenAudit] = useState<GoldenLoopAudit | null>(null);
  const [goldenError, setGoldenError] = useState<unknown>(null);

  const roles = useMemo(() => rolesFromSession(session), [session]);
  const isRoot = roles.includes("ROOT");
  const isApprover = roles.includes("FINANCE_APPROVER") && !isRoot;
  const selectedProfile = profiles.find((profile) => profile.organizationId === reviewTarget);
  const selectedCleanup = cleanupIncidents.find((incident) => incident.contractId === cleanupTarget);
  const selectedStop = stopIncidents.find((incident) => incident.contractId === stopTarget);
  const selectedDispute = disputes.find((dispute) => dispute.contractId === disputeTarget);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await hostingOperationsBundle();
      setSession(result.session);
      setGrants(result.grants);
      setProfiles(result.profiles);
      setFee(result.fee);
      setCleanupIncidents(result.cleanupIncidents);
      setStopIncidents(result.stopIncidents);
      setDisputes(result.disputes);
      setReviewTarget((current) => current || String(result.profiles.find((profile) => profile.status === "SUBMITTED")?.organizationId ?? result.profiles[0]?.organizationId ?? ""));
      setCleanupTarget((current) => result.cleanupIncidents.some((incident) => incident.contractId === current) ? current : String(result.cleanupIncidents.find((incident) => incident.cleanupCommandStatus === "FAILED")?.contractId ?? ""));
      setStopTarget((current) => result.stopIncidents.some((incident) => incident.contractId === current) ? current : String(result.stopIncidents.find((incident) => incident.failureStatus === "EXHAUSTED")?.contractId ?? ""));
      setDisputeTarget((current) => result.disputes.some((dispute) => dispute.contractId === current) ? current : String(result.disputes.find((dispute) => dispute.contractStatus === "DISPUTED" && !["REQUESTED", "APPROVED"].includes(String(dispute.proposalStatus ?? "")))?.contractId ?? ""));
    } catch (loadError) {
      setError(loadError);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void hostingOperationsBundle()
      .then((result) => {
        if (cancelled) return;
        setSession(result.session);
        setGrants(result.grants);
        setProfiles(result.profiles);
        setFee(result.fee);
        setCleanupIncidents(result.cleanupIncidents);
        setStopIncidents(result.stopIncidents);
        setDisputes(result.disputes);
        setReviewTarget(String(result.profiles.find((profile) => profile.status === "SUBMITTED")?.organizationId ?? result.profiles[0]?.organizationId ?? ""));
        setCleanupTarget(String(result.cleanupIncidents.find((incident) => incident.cleanupCommandStatus === "FAILED")?.contractId ?? ""));
        setStopTarget(String(result.stopIncidents.find((incident) => incident.failureStatus === "EXHAUSTED")?.contractId ?? ""));
        setDisputeTarget(String(result.disputes.find((dispute) => dispute.contractStatus === "DISPUTED" && !["REQUESTED", "APPROVED"].includes(String(dispute.proposalStatus ?? "")))?.contractId ?? ""));
      })
      .catch((loadError: unknown) => { if (!cancelled) setError(loadError); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  async function run(key: string, action: () => Promise<unknown>, success: string) {
    setBusy(key);
    setError(null);
    setNotice("");
    try {
      await action();
      setNotice(success);
      await load();
    } catch (actionError) {
      setError(actionError);
    } finally {
      setBusy("");
    }
  }

  function submitReview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedProfile) return;
    void run("review", () => adminPostAction(`/api/v2/admin/supply/profiles/${encodeURIComponent(text(selectedProfile, "organizationId"))}/review`, {
      decision: reviewDecision,
      expectedVersion: integer(selectedProfile, "version"),
      reviewNote: reviewNote.trim(),
      evidenceDigest: evidenceDigest.trim() || null,
    }), "供应主体审核结果已由服务端保存。");
  }

  function submitFee(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void run("fee", () => adminPostAction("/api/v2/admin/hosting/fees", {
      platformFeeBps: Number(platformFeeBps),
      referralRewardBps: Number(referralRewardBps),
      activate: true,
      effectiveFrom: new Date().toISOString(),
    }), "新费率版本已激活，既有合同快照不受影响。");
  }

  function submitGrant(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void run("grant", () => adminPostAction("/api/v2/admin/card-hours/trial-grants", {
      organizationId: grantOrganizationId.trim(),
      cardHours: Number(grantCardHours),
      reason: grantReason.trim(),
    }), "卡时申请已登记，尚未入账；请退出 Root 后由独立财务审批账号复核。 ");
  }

  function decideGrant(grant: AdminRow, decision: "APPROVE" | "REJECT") {
    const id = text(grant, "id");
    void run(`grant-${id}`, () => adminPostAction(`/api/v2/admin/card-hours/trial-grants/${encodeURIComponent(id)}/decision`, { decision }), decision === "APPROVE" ? "审批已完成，卡时已通过不可变账本入账。" : "申请已拒绝，未产生卡时入账。 ");
  }

  function submitCleanupRetry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedCleanup || selectedCleanup.cleanupCommandStatus !== "FAILED") return;
    const contractId = text(selectedCleanup, "contractId");
    void run("cleanup", () => adminPostAction(`/api/v2/admin/hosting/cleanup-incidents/${encodeURIComponent(contractId)}/retry`, {
      expectedContractVersion: integer(selectedCleanup, "contractVersion"),
      expectedDeviceVersion: integer(selectedCleanup, "deviceVersion"),
      reason: cleanupReason.trim(),
    }), "新的受限清理任务已排队；设备继续保持 DRAINING，只有 Agent 返回完整清理证据后才会恢复可售。 ");
  }

  function submitStopRetry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedStop || selectedStop.failureStatus !== "EXHAUSTED") return;
    const contractId = text(selectedStop, "contractId");
    void run("stop-recovery", () => adminPostAction(`/api/v2/admin/hosting/stop-incidents/${encodeURIComponent(contractId)}/retry`, {
      expectedContractVersion: integer(selectedStop, "contractVersion"),
      expectedDeviceVersion: integer(selectedStop, "deviceVersion"),
      reason: stopReason.trim(),
    }), "新的受控停机任务已排队；合同、设备、卡时与挂牌继续保持冻结，直到返回可信停机证据。 ");
  }

  function submitDisputeProposal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedDispute) return;
    const contractId = text(selectedDispute, "contractId");
    void run("dispute-proposal", () => adminPostAction(`/api/v2/admin/hosting/disputes/${encodeURIComponent(contractId)}/proposals`, {
      resolution: disputeResolution,
      expectedContractVersion: integer(selectedDispute, "contractVersion"),
      requestReason: disputeRequestReason.trim(),
      evidenceDigest: disputeEvidenceDigest.trim() || null,
    }), "争议裁决方案已登记，尚未移动卡时；请由独立财务审批账号复核。 ");
  }

  function decideDispute(dispute: AdminRow, decision: "APPROVE" | "REJECT") {
    const proposalId = text(dispute, "proposalId");
    const decisionReason = disputeDecisionReason.trim() || text(dispute, "decisionReason");
    void run(`dispute-${proposalId}`, () => adminPostAction(`/api/v2/admin/hosting/disputes/proposals/${encodeURIComponent(proposalId)}/decision`, {
      decision,
      decisionReason,
    }), decision === "APPROVE" ? "裁决已执行：卡时账本已更新，受限清理任务已排队。" : "裁决方案已拒绝，卡时与隔离状态均未变化。 ");
  }

  async function submitGoldenAudit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const contractId = goldenContractId.trim();
    setBusy("golden-audit");
    setGoldenError(null);
    setGoldenAudit(null);
    try {
      const payload = await adminGetJson(`/api/v2/admin/hosting/golden-loop/${encodeURIComponent(contractId)}`);
      const record = object(payload.record);
      if (!record || !Array.isArray(record.checks) || (record.verdict !== "PASS" && record.verdict !== "FAIL")) throw new AdminApiError("黄金订单验收接口未返回完整证据。", 200, "INVALID_RESPONSE");
      setGoldenAudit(record as GoldenLoopAudit);
    } catch (auditError) {
      setGoldenError(auditError);
    } finally {
      setBusy("");
    }
  }

  if (error instanceof AdminApiError && [401, 403].includes(error.status) && !session) return <AdminLoginRequired forbidden={error.status === 403} />;

  return (
    <div className="admin-page">
      <AdminPageHeader
        actions={<button className="admin-button secondary" disabled={loading || Boolean(busy)} onClick={() => void load()} type="button">{loading ? "读取中…" : "刷新状态"}</button>}
        description="供应商准入、费率、试运营卡时与争议裁决均采用真实服务端记录；资金变动必须由 Root 发起、独立财务复核。"
        kicker="Hosting trial controls"
        title="Hosting 试运营"
      />

      {notice ? <div className="admin-inline-success admin-hosting-notice" role="status"><strong>操作完成</strong><span>{notice}</span></div> : null}
      {error && session ? <AdminError message={adminErrorMessage(error, "Hosting 管理操作未完成。") } onRetry={() => void load()} /> : null}
      {loading && !session ? <AdminLoading label="正在读取 Hosting 试运营状态…" /> : null}

      {session ? <div className="admin-hosting-summary" aria-label="当前审批职责">
        <div><span>当前职责</span><strong>{isRoot ? "Root · 发起与配置" : "Finance Approver · 独立复核"}</strong></div>
        <div><span>卡时发放</span><strong>{isRoot ? "只能提交申请" : "只能批准或拒绝"}</strong></div>
        <div><span>公开支付</span><strong>关闭</strong></div>
        <div><span>当前费率</span><strong>{fee ? `${fee.platformFeeBps / 100}% / 推荐 ${fee.referralRewardBps / 100}%` : isRoot ? "未配置" : "职责外不可见"}</strong></div>
      </div> : null}

      {session ? <section className="admin-panel admin-hosting-panel admin-hosting-golden" aria-labelledby="golden-loop-title">
        <div className="admin-panel-head"><div><p className="admin-kicker">Real machine acceptance</p><h2 id="golden-loop-title">真实 GPU 黄金订单验收</h2></div>{goldenAudit ? <span className={`admin-status ${goldenAudit.verdict === "PASS" ? "success" : "danger"}`}>{goldenAudit.verdict === "PASS" ? "闭环通过" : `${goldenAudit.passedChecks}/${goldenAudit.totalChecks} 项通过`}</span> : <span className="admin-status warning">只读核验</span>}</div>
        <p className="admin-panel-copy">输入真实合同号，服务端交叉核对设备签名、控制面回连、实例身份、三分钟以上计量、卡时账本、租金佣金、撤权清理与恢复可售。它不会修改订单，也不会把测试数据包装成通过。</p>
        <form className="admin-hosting-form admin-hosting-golden-form" onSubmit={submitGoldenAudit}>
          <label><span>GPU 租赁合同编号</span><input autoComplete="off" onChange={(event) => setGoldenContractId(event.target.value)} pattern="hctr_[a-f0-9]{32}" placeholder="hctr_…" required value={goldenContractId} /></label>
          <button className="admin-button primary" disabled={busy === "golden-audit" || !/^hctr_[a-f0-9]{32}$/u.test(goldenContractId.trim())} type="submit">{busy === "golden-audit" ? "正在核验…" : "核验真实闭环"}</button>
        </form>
        {goldenError ? <AdminError message={adminErrorMessage(goldenError, "黄金订单证据核验未完成。")}/>: null}
        {goldenAudit ? <>
          <div className="admin-hosting-golden-facts" aria-label="黄金订单关键事实">
            <div><span>GPU</span><strong>{String(goldenAudit.facts.gpuModel ?? "—")}</strong></div>
            <div><span>真实计量</span><strong>{integer(goldenAudit.facts as AdminRow, "measuredSeconds")} 秒</strong></div>
            <div><span>实际扣减</span><strong>{cardHours(goldenAudit.facts.settledMicros)} KAI</strong></div>
            <div><span>Agent</span><strong>{String(goldenAudit.facts.agentVersion ?? "—")}</strong></div>
          </div>
          <div className="admin-hosting-golden-checks">{goldenAudit.checks.map((check) => <article className={check.status === "PASS" ? "pass" : "fail"} key={check.key}><span className={`admin-status ${check.status === "PASS" ? "success" : "danger"}`}>{check.status === "PASS" ? "通过" : "未通过"}</span><div><strong>{check.label}</strong><p>{check.detail}</p></div></article>)}</div>
          <p className="admin-hosting-audit-time">合同 <span className="admin-mono">{goldenAudit.contractId}</span> · 服务端核验时间 {datetime(goldenAudit.checkedAt)}</p>
        </> : null}
      </section> : null}

      {session ? <section className="admin-panel admin-hosting-panel admin-hosting-grants" aria-labelledby="dispute-resolution-title">
        <div className="admin-panel-head"><div><p className="admin-kicker">Dual-control disputes</p><h2 id="dispute-resolution-title">GPU 租赁争议裁决</h2></div><span className={`admin-status ${disputes.some((item) => item.contractStatus === "DISPUTED") ? "danger" : "success"}`}>{disputes.filter((item) => item.contractStatus === "DISPUTED").length} 个处理中</span></div>
        {disputes.length ? <>
          <div className="admin-table-wrap"><table className="admin-table"><caption>争议事实与最新裁决方案</caption><thead><tr><th>合同/设备</th><th>争议原因</th><th>计量/锁定</th><th>方案</th><th>申请人/复核人</th><th>状态</th><th>时间</th>{isApprover ? <th>独立复核</th> : null}</tr></thead><tbody>{disputes.map((item) => {
            const proposalId = text(item, "proposalId");
            const pending = item.proposalStatus === "REQUESTED";
            const recoverable = ["APPROVED", "APPLIED"].includes(text(item, "proposalStatus")) && ["DISPUTED", "SETTLED", "REFUNDED"].includes(text(item, "contractStatus"));
            const hasDecisionReason = disputeDecisionReason.trim().length >= 8 || text(item, "decisionReason").length >= 8;
            const rowBusy = busy === `dispute-${proposalId}`;
            return <tr key={text(item, "contractId")}><td><strong>{text(item, "offerTitle")}</strong><br/><span className="admin-mono">{text(item, "contractId")}</span><br/><span className="admin-mono">{text(item, "deviceId")}</span></td><td>{text(item, "reason")}<br/><small>{text(item, "requestReason")}</small></td><td>{integer(item, "measuredSeconds")} 秒<br/>{cardHours(item.heldMicros)} KAI</td><td>{item.proposedResolution === "REFUND" ? "全额退回锁定卡时" : item.proposedResolution === "SETTLE" ? "按冻结计量结算" : "尚未提案"}<br/><span className="admin-mono">{text(item, "evidenceDigest")}</span></td><td><span className="admin-mono">{text(item, "requestedBy")}</span><br/><span className="admin-mono">{text(item, "decidedBy")}</span></td><td><span className={`admin-status ${tone(text(item, "proposalStatus"))}`}>{text(item, "proposalStatus")}</span><br/><small>{text(item, "contractStatus")}</small></td><td>{datetime(item.requestedAt ?? item.openedAt)}<br/>{datetime(item.decidedAt)}</td>{isApprover ? <td><div className="admin-row-actions">{recoverable ? <button className="admin-button primary" disabled={rowBusy || !hasDecisionReason} onClick={() => decideDispute(item, "APPROVE")} type="button">继续执行</button> : <><button className="admin-button primary" disabled={!pending || rowBusy || disputeDecisionReason.trim().length < 8} onClick={() => decideDispute(item, "APPROVE")} type="button">批准并执行</button><button className="admin-button secondary" disabled={!pending || rowBusy || disputeDecisionReason.trim().length < 8} onClick={() => decideDispute(item, "REJECT")} type="button">拒绝</button></>}</div></td> : null}</tr>;
          })}</tbody></table></div>
          {isApprover && disputes.some((item) => item.proposalStatus === "REQUESTED") ? <label className="admin-hosting-decision-note"><span>本次独立复核说明</span><textarea maxLength={500} minLength={8} onChange={(event) => setDisputeDecisionReason(event.target.value)} placeholder="说明核对的 Agent、控制面、连接和计量证据，以及批准或拒绝依据" required rows={3} value={disputeDecisionReason} /></label> : null}
          {isRoot ? <form className="admin-hosting-form admin-hosting-grant-form" onSubmit={submitDisputeProposal}>
            <label><span>待裁决合同</span><select onChange={(event) => setDisputeTarget(event.target.value)} value={disputeTarget}><option value="">选择尚无待复核方案的争议合同</option>{disputes.filter((item) => item.contractStatus === "DISPUTED" && !["REQUESTED", "APPROVED"].includes(String(item.proposalStatus ?? ""))).map((item) => <option key={text(item, "contractId")} value={text(item, "contractId")}>{text(item, "contractId")} · {text(item, "offerTitle")}</option>)}</select></label>
            <label><span>裁决方案</span><select onChange={(event) => setDisputeResolution(event.target.value as "REFUND" | "SETTLE")} value={disputeResolution}><option value="REFUND">全额退回锁定卡时</option><option value="SETTLE">按冻结计量与费率结算</option></select></label>
            <label className="wide"><span>提案依据</span><textarea maxLength={500} minLength={8} onChange={(event) => setDisputeRequestReason(event.target.value)} placeholder="说明连接、运行、计量和合同证据如何支持该方案" required rows={3} value={disputeRequestReason} /></label>
            <label><span>证据 SHA-256</span><input maxLength={64} minLength={64} onChange={(event) => setDisputeEvidenceDigest(event.target.value)} pattern="[a-fA-F0-9]{64}" placeholder="只保存证据摘要" value={disputeEvidenceDigest} /></label>
            <button className="admin-button danger" disabled={busy === "dispute-proposal" || !selectedDispute} type="submit">{busy === "dispute-proposal" ? "正在登记…" : "提交裁决方案"}</button>
          </form> : null}
          <p className="admin-hosting-warning">管理员不能输入退款金额、供应方收益或佣金。全额退回释放全部锁定卡时；按计量结算只使用冻结合同费率与 Agent 计量凭证。批准后仍须完成容器、公钥和工作目录清理才允许复售。</p>
        </> : <AdminEmpty description="买家尚未发起 GPU 租赁争议。" title="当前没有争议案件" />}
      </section> : null}

      {isRoot ? <div className="admin-hosting-grid">
        <section className="admin-panel admin-hosting-panel" aria-labelledby="supplier-review-title">
          <div className="admin-panel-head"><div><p className="admin-kicker">Supplier admission</p><h2 id="supplier-review-title">供应主体审核</h2></div><span>{profiles.length} 条</span></div>
          {profiles.length ? <form className="admin-hosting-form" onSubmit={submitReview}>
            <label><span>供应主体</span><select onChange={(event) => setReviewTarget(event.target.value)} value={reviewTarget}>{profiles.map((profile) => <option key={text(profile, "organizationId")} value={text(profile, "organizationId")}>{text(profile, "legalDisplayName")} · {text(profile, "status")}</option>)}</select></label>
            <div className="admin-hosting-facts"><span>组织 ID <b>{selectedProfile ? text(selectedProfile, "organizationId") : "—"}</b></span><span>类型 <b>{selectedProfile ? text(selectedProfile, "supplierType") : "—"}</b></span><span>版本 <b>{selectedProfile ? integer(selectedProfile, "version") : "—"}</b></span></div>
            <label><span>审核决定</span><select onChange={(event) => setReviewDecision(event.target.value)} value={reviewDecision}><option value="APPROVE">批准</option><option value="REJECT">拒绝</option><option value="SUSPEND">暂停</option></select></label>
            <label><span>审核说明</span><textarea maxLength={500} minLength={4} onChange={(event) => setReviewNote(event.target.value)} placeholder="说明材料依据、权限边界和结论" required rows={3} value={reviewNote} /></label>
            <label><span>证据 SHA-256（可选）</span><input maxLength={64} minLength={64} onChange={(event) => setEvidenceDigest(event.target.value)} pattern="[a-fA-F0-9]{64}" placeholder="仅保存摘要，不上传敏感材料" value={evidenceDigest} /></label>
            <button className="admin-button primary" disabled={busy === "review" || !selectedProfile} type="submit">{busy === "review" ? "正在提交…" : "保存审核结果"}</button>
          </form> : <AdminEmpty description="尚无供应方提交准入申请。" title="没有待审核供应主体" />}
        </section>

        <section className="admin-panel admin-hosting-panel" aria-labelledby="fee-schedule-title">
          <div className="admin-panel-head"><div><p className="admin-kicker">Versioned fee</p><h2 id="fee-schedule-title">成交费率版本</h2></div>{fee ? <span className={`admin-status ${tone(fee.status)}`}>{fee.status}</span> : null}</div>
          {fee ? <div className="admin-hosting-current"><span>当前版本 <b>{fee.id}</b></span><span>平台服务费 <b>{fee.platformFeeBps} BP</b></span><span>推荐奖励 <b>{fee.referralRewardBps} BP</b></span><span>生效时间 <b>{datetime(fee.effectiveFrom)}</b></span></div> : <p className="admin-hosting-copy">未配置有效费率时，生产挂牌必须保持关闭。</p>}
          <form className="admin-hosting-form compact" onSubmit={submitFee}>
            <label><span>平台服务费（BP）</span><input max={5000} min={0} onChange={(event) => setPlatformFeeBps(event.target.value)} required type="number" value={platformFeeBps} /></label>
            <label><span>推荐奖励（BP）</span><input max={Number(platformFeeBps) || 0} min={0} onChange={(event) => setReferralRewardBps(event.target.value)} required type="number" value={referralRewardBps} /></label>
            <button className="admin-button primary" disabled={busy === "fee"} type="submit">{busy === "fee" ? "正在激活…" : "创建并激活新版本"}</button>
          </form>
        </section>

        <section className="admin-panel admin-hosting-panel admin-panel-wide-column" aria-labelledby="grant-request-title">
          <div className="admin-panel-head"><div><p className="admin-kicker">Dual-control issuance</p><h2 id="grant-request-title">申请试运营卡时</h2></div><span className="admin-status warning">仅申请，不入账</span></div>
          <form className="admin-hosting-form admin-hosting-grant-form" onSubmit={submitGrant}>
            <label><span>目标组织 ID</span><input maxLength={200} minLength={3} onChange={(event) => setGrantOrganizationId(event.target.value)} placeholder="从用户/组织记录复制服务端组织 ID" required value={grantOrganizationId} /></label>
            <label><span>整数卡时</span><input max={1_000_000} min={1} onChange={(event) => setGrantCardHours(event.target.value)} required type="number" value={grantCardHours} /></label>
            <label className="wide"><span>试运营用途</span><textarea maxLength={500} minLength={8} onChange={(event) => setGrantReason(event.target.value)} placeholder="说明机器、测试订单、预计时长和责任人" required rows={3} value={grantReason} /></label>
            <button className="admin-button primary" disabled={busy === "grant"} type="submit">{busy === "grant" ? "正在登记…" : "提交卡时申请"}</button>
          </form>
          <p className="admin-hosting-warning">提交后请退出 Root 账号，由另一位操作人员使用独立财务审批账号登录本页复核。Root 无法批准自己发起的申请。</p>
        </section>

        <section className="admin-panel admin-hosting-panel admin-panel-wide-column" aria-labelledby="cleanup-recovery-title">
          <div className="admin-panel-head"><div><p className="admin-kicker">Fail-closed recovery</p><h2 id="cleanup-recovery-title">清理失败恢复</h2></div><span className={`admin-status ${cleanupIncidents.length ? "danger" : "success"}`}>{cleanupIncidents.length ? `${cleanupIncidents.length} 个隔离事件` : "无阻塞"}</span></div>
          {cleanupIncidents.length ? <>
            <div className="admin-table-wrap"><table className="admin-table"><caption>清理失败与恢复任务</caption><thead><tr><th>合同</th><th>设备</th><th>Agent 最后在线</th><th>清理任务</th><th>状态</th><th>错误</th><th>证据摘要</th><th>失败/更新时间</th></tr></thead><tbody>{cleanupIncidents.map((incident) => <tr key={text(incident, "contractId")}><td className="admin-mono">{text(incident, "contractId")}</td><td><strong>{text(incident, "deviceDisplayName")}</strong><br/><span className="admin-mono">{text(incident, "deviceId")}</span></td><td>{datetime(incident.deviceLastSeenAt)}</td><td className="admin-mono">{text(incident, "cleanupCommandId")}<br/>投递 {integer(incident, "cleanupAttempt")} 次</td><td><span className={`admin-status ${text(incident, "cleanupCommandStatus") === "FAILED" ? "danger" : "warning"}`}>{text(incident, "cleanupCommandStatus")}</span></td><td className="admin-mono">{text(incident, "errorCode")}</td><td className="admin-mono">{text(incident, "evidenceDigest")}</td><td>{datetime(incident.failedAt ?? incident.updatedAt)}</td></tr>)}</tbody></table></div>
            <form className="admin-hosting-form admin-hosting-recovery-form" onSubmit={submitCleanupRetry}>
              <label><span>失败合同</span><select onChange={(event) => setCleanupTarget(event.target.value)} value={cleanupTarget}><option value="">选择可重试的失败合同</option>{cleanupIncidents.filter((incident) => incident.cleanupCommandStatus === "FAILED").map((incident) => <option key={text(incident, "contractId")} value={text(incident, "contractId")}>{text(incident, "contractId")} · {text(incident, "errorCode")}</option>)}</select></label>
              <label><span>恢复理由</span><textarea maxLength={500} minLength={8} onChange={(event) => setCleanupReason(event.target.value)} placeholder="说明故障已排除的依据、Agent 状态和本次重试责任人" required rows={3} value={cleanupReason} /></label>
              <button className="admin-button danger" disabled={busy === "cleanup" || !selectedCleanup || selectedCleanup.cleanupCommandStatus !== "FAILED"} type="submit">{busy === "cleanup" ? "正在排队…" : "重新下发受限清理"}</button>
            </form>
            <p className="admin-hosting-warning">此操作不会改写合同、设备或挂牌状态。设备保持隔离；严禁用管理员按钮跳过容器、临时密钥和工作目录清理证明。</p>
          </> : <AdminEmpty description="没有处于 DRAINING 的设备或未完成的清理合同。" title="当前没有清理阻塞" />}
        </section>

        <section className="admin-panel admin-hosting-panel admin-panel-wide-column" aria-labelledby="stop-recovery-title">
          <div className="admin-panel-head"><div><p className="admin-kicker">Runtime stop recovery</p><h2 id="stop-recovery-title">停机失败现场处置</h2></div><span className={`admin-status ${stopIncidents.length ? "danger" : "success"}`}>{stopIncidents.length ? `${stopIncidents.length} 个隔离事件` : "无阻塞"}</span></div>
          {stopIncidents.length ? <>
            <div className="admin-table-wrap"><table className="admin-table"><caption>运行实例停机失败与恢复证据</caption><thead><tr><th>合同</th><th>设备</th><th>Agent 最后在线</th><th>失败命令</th><th>轮次</th><th>状态</th><th>错误</th><th>证据摘要</th><th>失败时间</th></tr></thead><tbody>{stopIncidents.map((incident) => <tr key={text(incident, "contractId")}><td className="admin-mono">{text(incident, "contractId")}</td><td><strong>{text(incident, "deviceDisplayName")}</strong><br/><span className="admin-mono">{text(incident, "deviceId")}</span></td><td>{datetime(incident.deviceLastSeenAt)}</td><td className="admin-mono">{text(incident, "failedCommandId")}<br/>{text(incident, "recoveryCommandId")}</td><td>{integer(incident, "retrySequence")}</td><td><span className={`admin-status ${text(incident, "failureStatus") === "EXHAUSTED" ? "danger" : "warning"}`}>{text(incident, "failureStatus")}</span></td><td className="admin-mono">{text(incident, "errorCode")}</td><td className="admin-mono">{text(incident, "evidenceDigest")}</td><td>{datetime(incident.failedAt)}</td></tr>)}</tbody></table></div>
            <form className="admin-hosting-form admin-hosting-recovery-form" onSubmit={submitStopRetry}>
              <label><span>耗尽自动恢复的合同</span><select onChange={(event) => setStopTarget(event.target.value)} value={stopTarget}><option value="">选择需要现场处置的合同</option>{stopIncidents.filter((incident) => incident.failureStatus === "EXHAUSTED").map((incident) => <option key={text(incident, "contractId")} value={text(incident, "contractId")}>{text(incident, "contractId")} · {text(incident, "errorCode")}</option>)}</select></label>
              <label><span>现场处置依据</span><textarea maxLength={500} minLength={8} onChange={(event) => setStopReason(event.target.value)} placeholder="说明容器运行状态、Actuator/Agent 故障已经排除的证据和本次责任人" required rows={3} value={stopReason} /></label>
              <button className="admin-button danger" disabled={busy === "stop-recovery" || !selectedStop || selectedStop.failureStatus !== "EXHAUSTED" || stopReason.trim().length < 8} type="submit">{busy === "stop-recovery" ? "正在排队…" : "重新下发受控停机"}</button>
            </form>
            <p className="admin-hosting-warning">此入口不能直接填写计量、停止时间、退款或结算金额。它只会重发一条签名绑定合同的 STOP；平台仍要求 Host Agent 返回容器身份和停止证据，随后才进入验收、结算与清理。</p>
          </> : <AdminEmpty description="没有自动停机恢复耗尽或正在恢复的运行实例。" title="当前没有停机阻塞" />}
        </section>
      </div> : null}

      {session ? <section className="admin-panel admin-hosting-panel admin-hosting-grants" aria-labelledby="grant-list-title">
        <div className="admin-panel-head"><div><p className="admin-kicker">Immutable issuance ledger</p><h2 id="grant-list-title">试运营卡时申请记录</h2></div><span>{grants.length} 条</span></div>
        {grants.length ? <div className="admin-table-wrap"><table className="admin-table"><caption>试运营卡时申请</caption><thead><tr><th>申请编号</th><th>目标组织</th><th>卡时</th><th>用途</th><th>申请人</th><th>审批人</th><th>状态</th><th>更新时间</th>{isApprover ? <th>独立复核</th> : null}</tr></thead><tbody>{grants.map((grant) => {
          const pending = grant.status === "REQUESTED";
          const rowBusy = busy === `grant-${text(grant, "id")}`;
          return <tr key={text(grant, "id")}><td className="admin-mono">{text(grant, "id")}</td><td className="admin-mono">{text(grant, "organizationId")}</td><td className="admin-number">{cardHours(grant.amountMicros)}</td><td>{text(grant, "reason")}</td><td className="admin-mono">{text(grant, "requestedBy")}</td><td className="admin-mono">{text(grant, "approvedBy")}</td><td><span className={`admin-status ${tone(text(grant, "status"))}`}>{text(grant, "status")}</span></td><td>{datetime(grant.updatedAt)}</td>{isApprover ? <td><div className="admin-row-actions"><button className="admin-button primary" disabled={!pending || rowBusy} onClick={() => decideGrant(grant, "APPROVE")} type="button">批准</button><button className="admin-button secondary" disabled={!pending || rowBusy} onClick={() => decideGrant(grant, "REJECT")} type="button">拒绝</button></div></td> : null}</tr>;
        })}</tbody></table></div> : <AdminEmpty description={isApprover ? "Root 尚未提交待复核的卡时申请。" : "尚未提交试运营卡时申请。"} title="没有卡时申请" />}
      </section> : null}
    </div>
  );
}
