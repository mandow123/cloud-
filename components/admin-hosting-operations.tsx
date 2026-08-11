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
  if (["APPROVED", "ACTIVE", "POSTED"].includes(status)) return "success";
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
  const [grants, profiles, fee] = await Promise.all([
    adminGetRows({ path: "/api/v2/admin/card-hours/trial-grants" }),
    root ? adminGetRows({ path: "/api/v2/admin/supply/profiles" }) : Promise.resolve([]),
    root ? adminGetJson("/api/v2/admin/hosting/fees").then(feeFromPayload) : Promise.resolve(null),
  ]);
  return { session, grants, profiles, fee };
}

export function AdminHostingOperations() {
  const [session, setSession] = useState<Record<string, unknown> | null>(null);
  const [profiles, setProfiles] = useState<AdminRow[]>([]);
  const [grants, setGrants] = useState<AdminRow[]>([]);
  const [fee, setFee] = useState<FeeSchedule | null>(null);
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

  const roles = useMemo(() => rolesFromSession(session), [session]);
  const isRoot = roles.includes("ROOT");
  const isApprover = roles.includes("FINANCE_APPROVER") && !isRoot;
  const selectedProfile = profiles.find((profile) => profile.organizationId === reviewTarget);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await hostingOperationsBundle();
      setSession(result.session);
      setGrants(result.grants);
      setProfiles(result.profiles);
      setFee(result.fee);
      setReviewTarget((current) => current || String(result.profiles.find((profile) => profile.status === "SUBMITTED")?.organizationId ?? result.profiles[0]?.organizationId ?? ""));
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
        setReviewTarget(String(result.profiles.find((profile) => profile.status === "SUBMITTED")?.organizationId ?? result.profiles[0]?.organizationId ?? ""));
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

  if (error instanceof AdminApiError && [401, 403].includes(error.status) && !session) return <AdminLoginRequired forbidden={error.status === 403} />;

  return (
    <div className="admin-page">
      <AdminPageHeader
        actions={<button className="admin-button secondary" disabled={loading || Boolean(busy)} onClick={() => void load()} type="button">{loading ? "读取中…" : "刷新状态"}</button>}
        description="供应商准入、费率版本与试运营卡时采用真实服务端记录；卡时必须由 Root 发起、独立财务审批员复核后才会入账。"
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
