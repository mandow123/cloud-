"use client";

import Link from "next/link";
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import type { HostingSupplierProfile, HostingSupplierType } from "@/lib/hosting-v2";
import {
  createIdempotencyKey,
  marketplaceErrorMessage,
  marketplaceGet,
  marketplacePost,
  marketplacePut,
} from "@/lib/client/marketplace-client";
import styles from "./supply-console.module.css";

const supplierTypes: Array<{ value: HostingSupplierType; label: string; description: string }> = [
  { value: "INDIVIDUAL", label: "个人供应方", description: "个人持有或获授权运营的单台 GPU 主机" },
  { value: "COMPANY", label: "企业供应商", description: "公司持有或运营的 GPU 与服务器资源" },
  { value: "IDC", label: "IDC / 数据中心", description: "具备机房、网络和批量资源履约能力" },
  { value: "CLOUD_VENDOR", label: "云资源供应商", description: "通过生产连接器交付云主机库存" },
];

const statusLabels: Record<HostingSupplierProfile["status"], string> = {
  DRAFT: "资料草稿",
  SUBMITTED: "等待人工审核",
  APPROVED: "审核通过",
  REJECTED: "审核退回",
  SUSPENDED: "资格暂停",
};

export function SupplierOnboardingForm() {
  const [profile, setProfile] = useState<HostingSupplierProfile | null>(null);
  const [supplierType, setSupplierType] = useState<HostingSupplierType>("INDIVIDUAL");
  const [legalDisplayName, setLegalDisplayName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [agreementAccepted, setAgreementAccepted] = useState(false);
  const [agreementVersion, setAgreementVersion] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"save" | "submit" | null>(null);
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const saveKey = useRef<string | null>(null);
  const submitKey = useRef<string | null>(null);

  const applyProfile = useCallback((record: HostingSupplierProfile | null) => {
    setProfile(record);
    if (!record) return;
    setSupplierType(record.supplierType);
    setLegalDisplayName(record.legalDisplayName);
    setContactEmail(record.contactEmail);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    try {
      const [profileResult, policyResult] = await Promise.all([
        marketplaceGet<{ record: HostingSupplierProfile | null }>("/api/v2/supply/profile"),
        marketplaceGet<{ policy: { termsVersion: string } }>("/api/v2/supply/policy"),
      ]);
      applyProfile(profileResult.record);
      setAgreementVersion(policyResult.policy.termsVersion);
    } catch (cause) {
      setMessage({ kind: "error", text: marketplaceErrorMessage(cause, "供应商审核资料暂时无法读取。") });
    } finally {
      setLoading(false);
    }
  }, [applyProfile]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => { void load(); });
    return () => window.cancelAnimationFrame(frame);
  }, [load]);

  const editable = !profile || profile.status === "DRAFT" || profile.status === "REJECTED";
  const canSubmit = profile?.status === "DRAFT" && agreementAccepted && busy === null;

  function markDraftChanged() {
    saveKey.current = null;
    setMessage(null);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editable) return;
    setBusy("save");
    setMessage(null);
    try {
      saveKey.current ??= createIdempotencyKey("hosting-profile-save");
      const result = await marketplacePut<HostingSupplierProfile>("/api/v2/supply/profile", {
        supplierType,
        legalDisplayName,
        contactEmail,
        expectedVersion: profile?.version ?? 0,
      }, saveKey.current);
      saveKey.current = null;
      applyProfile(result.record);
      setAgreementAccepted(false);
      setMessage({ kind: "success", text: "资料草稿已保存。确认内容和供应协议后再提交审核。" });
    } catch (cause) {
      setMessage({ kind: "error", text: marketplaceErrorMessage(cause, "资料保存失败。") });
    } finally {
      setBusy(null);
    }
  }

  async function submit() {
    if (!canSubmit || !profile) return;
    setBusy("submit");
    setMessage(null);
    try {
      submitKey.current ??= createIdempotencyKey("hosting-profile-submit");
      const result = await marketplacePost<HostingSupplierProfile>("/api/v2/supply/profile/submit", {
        expectedVersion: profile.version,
        agreementAccepted: true,
      }, submitKey.current);
      submitKey.current = null;
      applyProfile(result.record);
      setAgreementAccepted(false);
      setMessage({ kind: "success", text: "审核申请已提交。审核期间资料保持只读，结果会显示在本页面。" });
    } catch (cause) {
      setMessage({ kind: "error", text: marketplaceErrorMessage(cause, "审核申请提交失败。") });
    } finally {
      setBusy(null);
    }
  }

  if (loading) return <div className={styles.loading} role="status">正在读取当前供应主体和审核状态…</div>;

  return (
    <>
      <div className={styles.pageHeading}>
        <div><h1>供应商审核</h1><p>可以先保存草稿。提交审核后，管理员只依据服务端当前主体和本次资料版本处理申请。</p></div>
        <span className={`${styles.statusBadge} ${profile?.status === "REJECTED" || profile?.status === "SUSPENDED" ? styles.statusError : profile?.status === "DRAFT" || profile?.status === "SUBMITTED" ? styles.statusWarning : ""}`}>
          {profile ? statusLabels[profile.status] : "尚未创建"}
        </span>
      </div>

      {message ? <div className={`${styles.message} ${message.kind === "error" ? styles.messageError : ""}`} role={message.kind === "error" ? "alert" : "status"}>{message.text}</div> : null}
      {profile?.reviewNote ? <div className={`${styles.message} ${profile.status === "REJECTED" || profile.status === "SUSPENDED" ? styles.messageError : ""}`}><strong>审核说明：</strong> {profile.reviewNote}</div> : null}

      <div className={styles.formLayout}>
        <form className={styles.formPanel} onSubmit={save}>
          <div className={styles.fieldGrid}>
            <label className={styles.field} htmlFor="supplier-type">
              供应方类型
              <select disabled={!editable || busy !== null} id="supplier-type" onChange={(event) => { markDraftChanged(); setSupplierType(event.target.value as HostingSupplierType); }} value={supplierType}>
                {supplierTypes.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
              <small>{supplierTypes.find((item) => item.value === supplierType)?.description}</small>
            </label>
            <label className={styles.field} htmlFor="supplier-email">
              联系邮箱
              <input autoComplete="email" disabled={!editable || busy !== null} id="supplier-email" maxLength={254} onChange={(event) => { markDraftChanged(); setContactEmail(event.target.value); }} placeholder="name@example.com" required type="email" value={contactEmail} />
              <small>用于审核状态和履约异常通知，不公开展示。</small>
            </label>
            <label className={`${styles.field} ${styles.fieldFull}`} htmlFor="supplier-name">
              {supplierType === "INDIVIDUAL" ? "供应方显示名称" : "企业或机构名称"}
              <input disabled={!editable || busy !== null} id="supplier-name" maxLength={120} minLength={2} onChange={(event) => { markDraftChanged(); setLegalDisplayName(event.target.value); }} placeholder={supplierType === "INDIVIDUAL" ? "例如：Kai 的 4090 主机" : "填写合同主体名称"} required value={legalDisplayName} />
              <small>个人类型可使用受审核的显示名称；企业、IDC 和云供应商应与后续主体材料一致。</small>
            </label>
          </div>

          {profile?.status === "DRAFT" ? (
            <label className={styles.agreement}>
              <input checked={agreementAccepted} disabled={busy !== null} onChange={(event) => setAgreementAccepted(event.target.checked)} type="checkbox" />
              <span>我确认资料真实，并同意 <Link href={agreementVersion ? `/hosting/partners/terms/${agreementVersion}` : "/hosting/partners"} target="_blank">《KAI Hosting 算力供应协议》版本 <strong>{agreementVersion || "读取中"}</strong></Link>。设备权属、网络许可和交付能力仍需进一步审核。</span>
            </label>
          ) : null}

          <div className={styles.formActions}>
            <button className={styles.saveButton} disabled={!editable || busy !== null || legalDisplayName.trim().length < 2 || contactEmail.trim().length < 5} type="submit">
              {busy === "save" ? "正在保存…" : profile ? "保存资料草稿" : "创建资料草稿"}
            </button>
            <button className={styles.submitButton} disabled={!canSubmit} onClick={() => void submit()} type="button">
              {busy === "submit" ? "正在提交…" : "同意协议并提交审核"}
            </button>
          </div>
        </form>

        <aside className={styles.sidePanel}>
          <section><h2>审核后的权限</h2><p>审核通过后，才能生成一次性 Agent 安装凭证、提交设备验真和发布报价。</p></section>
          <section><h3>敏感材料</h3><p>本页只保存主体类型、名称和联系邮箱。身份证明、合同和权属文件不会放进普通前端缓存或日志。</p></section>
          <section><h3>状态流程</h3><ul><li>草稿：可以修改，不具备供应权限</li><li>审核中：资料只读，等待人工处理</li><li>通过：可以进入设备登记</li><li>退回：按审核说明修改后重新提交</li><li>暂停：停止新增验真和发布</li></ul></section>
          <section><Link className={styles.secondaryAction} href="/hosting/partners">查看完整合作规则</Link></section>
        </aside>
      </div>
    </>
  );
}
