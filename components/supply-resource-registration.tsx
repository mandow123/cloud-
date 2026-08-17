"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { HostingAgentChallenge, HostingDevice } from "@/lib/hosting-v2";
import type { SupplierHostingDashboard, SupplierHostingPolicy } from "@/lib/hosting-v2-client";
import { createIdempotencyKey, marketplaceErrorMessage, marketplaceGet, marketplacePost } from "@/lib/client/marketplace-client";
import styles from "./supply-console.module.css";

const HOST_AGENT_VERSION = "1.11.0";
const HOST_AGENT_ARCHIVE = `kai-host-agent-${HOST_AGENT_VERSION}.tgz`;

function agentRegistrationEndpoint() {
  if (typeof window === "undefined") return "/api/v2/agent/register";
  const origin = new URL(window.location.origin);
  if (origin.protocol === "http:" && ["127.0.0.1", "localhost"].includes(origin.hostname)) {
    origin.hostname = "supplier.localhost";
  }
  origin.pathname = "/api/v2/agent/register";
  return origin.toString();
}

type PairingDevice = Pick<HostingDevice, "id" | "displayName" | "agentVersion" | "status" | "verificationStatus" | "lastSequence" | "lastSeenAt"> & Readonly<{ gpuModel: HostingDevice["inventory"]["gpuModel"] }>;
type PairingStatus = Readonly<{ challengeId: string; expiresAt: string; consumedAt: string | null; revokedAt: string | null; device: PairingDevice | null }>;

const templates = [
  { id: "personal-gpu", code: "01", title: "个人 GPU", description: "单台 Ubuntu 主机，首期支持 1× RTX 4090 或 H100。", enabled: true },
  { id: "gpu-server", code: "02", title: "GPU 服务器", description: "企业或 IDC 整机资源；首期仍按单卡非切片验收。", enabled: true },
  { id: "connector", code: "03", title: "云资源连接器", description: "需单独完成 reserve / provision / cleanup 生产验收。", enabled: false },
] as const;

export function SupplyResourceRegistration() {
  const [dashboard, setDashboard] = useState<SupplierHostingDashboard | null>(null);
  const [policy, setPolicy] = useState<SupplierHostingPolicy | null>(null);
  const [selected, setSelected] = useState<(typeof templates)[number]["id"]>("personal-gpu");
  const [challenge, setChallenge] = useState<HostingAgentChallenge | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [pairedDevice, setPairedDevice] = useState<PairingDevice | null>(null);
  const [pairingExpired, setPairingExpired] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const issueKey = useRef<string | null>(null);
  const revokeKey = useRef<string | null>(null);
  const connectionVerified = Boolean(pairedDevice && pairedDevice.lastSequence > 0);
  const agentOnline = Boolean(connectionVerified && pairedDevice && ["ONLINE", "VERIFIED"].includes(pairedDevice.status));

  const load = useCallback(async () => {
    try {
      const [dashboardResult, policyResult] = await Promise.all([
        marketplaceGet<{ dashboard: SupplierHostingDashboard }>("/api/v2/supply/dashboard"),
        marketplaceGet<{ policy: SupplierHostingPolicy }>("/api/v2/supply/policy"),
      ]);
      setDashboard(dashboardResult.dashboard);
      setPolicy(policyResult.policy);
    } catch (cause) {
      setError(marketplaceErrorMessage(cause, "供应主体状态暂时无法读取。"));
    }
  }, []);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => { void load(); });
    return () => window.cancelAnimationFrame(frame);
  }, [load]);

  useEffect(() => {
    if (!challenge || agentOnline || pairingExpired) return;
    let cancelled = false;
    const check = async () => {
      try {
        const result = await marketplaceGet<{ record: PairingStatus }>(`/api/v2/supply/agent-challenges/${encodeURIComponent(challenge.id)}`);
        if (!cancelled && result.record.revokedAt) {
          setChallenge(null);
          setPairedDevice(null);
          setPairingExpired(false);
          revokeKey.current = null;
          setNotice("这份配对凭证已在服务器废弃，不能再用于登记设备。");
        } else if (!cancelled && result.record.device) {
          setPairedDevice(result.record.device);
          setError(null);
        } else if (!cancelled && Date.parse(result.record.expiresAt) <= Date.now()) {
          setPairingExpired(true);
        }
      } catch (cause) {
        if (!cancelled) setError(marketplaceErrorMessage(cause, "设备连接状态暂时无法确认。"));
      }
    };
    void check();
    const interval = window.setInterval(() => { void check(); }, 3_000);
    return () => { cancelled = true; window.clearInterval(interval); };
  }, [agentOnline, challenge, pairingExpired]);

  const pairingBundle = useMemo(() => challenge ? JSON.stringify({
    version: 1,
    registerEndpoint: agentRegistrationEndpoint(),
    challengeId: challenge.id,
    nonce: challenge.nonce,
    minimumAgentVersion: challenge.minimumAgentVersion,
    expiresAt: challenge.expiresAt,
  }, null, 2) : "", [challenge]);

  async function issueChallenge() {
    setBusy(true); setError(null); setNotice(null); setCopied(false); setPairedDevice(null); setPairingExpired(false);
    try {
      issueKey.current ??= createIdempotencyKey("agent-pairing");
      const result = await marketplacePost<HostingAgentChallenge>("/api/v2/supply/agent-challenges", {}, issueKey.current);
      issueKey.current = null;
      setChallenge(result.record);
    } catch (cause) {
      setError(marketplaceErrorMessage(cause, "一次性配对凭证签发失败。"));
    } finally {
      setBusy(false);
    }
  }

  async function revokeChallenge() {
    if (!challenge) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      revokeKey.current ??= createIdempotencyKey("agent-pairing-revoke");
      await marketplacePost<HostingAgentChallenge>(
        `/api/v2/supply/agent-challenges/${encodeURIComponent(challenge.id)}/revoke`,
        {},
        revokeKey.current,
      );
      setChallenge(null);
      setPairedDevice(null);
      setPairingExpired(false);
      setCopied(false);
      issueKey.current = null;
      revokeKey.current = null;
      setNotice("配对凭证已在服务器废弃，旧文件不能再登记设备。");
    } catch (cause) {
      setError(marketplaceErrorMessage(cause, "配对凭证废弃失败，请不要继续分发这份文件。"));
    } finally {
      setBusy(false);
    }
  }

  async function copyBundle() {
    try {
      await navigator.clipboard.writeText(pairingBundle);
      setCopied(true);
    } catch {
      setError("浏览器未允许复制。请手动选择配对内容并复制到主机。 ");
    }
  }

  function downloadBundle() {
    if (!challenge || !pairingBundle) return;
    const blob = new Blob([`${pairingBundle}\n`], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `kai-host-pairing-${challenge.id}.json`;
    anchor.rel = "noopener";
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  if (!dashboard && !error) return <div className={styles.loading} role="status">正在确认供应主体是否具备设备登记权限…</div>;
  const approved = dashboard?.readiness.supplierApproved === true;

  return (
    <>
      <div className={styles.pageHeading}>
        <div><h1>连接托管设备</h1><p>先选择设备模板并检查主机，再签发 5 分钟有效的一次性 Agent 配对凭证。</p></div>
        <Link className={styles.secondaryAction} href="/supply/devices">返回托管设备</Link>
      </div>

      {error ? <div className={`${styles.message} ${styles.messageError}`} role="alert">{error}</div> : null}
      {notice ? <div className={styles.message} role="status">{notice}</div> : null}
      {!approved ? <div className={styles.warningBox}>只有审核通过的供应主体才能签发配对凭证。请先完成供应商审核。</div> : null}

      <div className={styles.resourceCards} aria-label="资源接入模板">
        {templates.map((template) => (
          <article className={`${styles.resourceCard} ${selected === template.id ? styles.resourceCardSelected : ""}`} key={template.id}>
            <button aria-pressed={selected === template.id} disabled={!template.enabled || Boolean(challenge && !pairedDevice)} onClick={() => { setSelected(template.id); setChallenge(null); setPairedDevice(null); setPairingExpired(false); issueKey.current = null; revokeKey.current = null; }} type="button">
              <span>{template.code}</span><h2>{template.title}</h2><p>{template.description}</p>
            </button>
          </article>
        ))}
      </div>

      <section className={styles.pairingPanel} aria-labelledby="pairing-title">
        <header className={styles.panelHeader}><h2 id="pairing-title">Host Agent 配对</h2><span>{selected === "personal-gpu" ? "个人 GPU" : "GPU 服务器"}</span></header>
        <div className={styles.pairingBody}>
          <div className={styles.actionRow}>
            <a className={styles.secondaryAction} download href={`/downloads/${HOST_AGENT_ARCHIVE}`}>下载 Host Agent {HOST_AGENT_VERSION}</a>
            <Link className={styles.secondaryAction} href="/guides/host-agent">打开安装与校验教程</Link>
          </div>
          <div className={styles.warningBox}>配对凭证包含一次性随机数，只能交给你控制的主机。不要发送到聊天群、工单或公开日志；过期或使用后必须重新签发。</div>
          <ul className={styles.readinessList}>
            <li><span>Ubuntu 与 NVIDIA 驱动已就绪</span><strong className={styles.ready}>REQUIRED</strong></li>
            <li><span>NVIDIA Container Toolkit 可运行</span><strong className={styles.ready}>REQUIRED</strong></li>
            <li><span>公网端口范围可达</span><strong className={styles.ready}>REQUIRED</strong></li>
            <li><span>Agent 仅能主动通过 HTTPS 领取受限命令</span><strong className={styles.ready}>ENFORCED</strong></li>
          </ul>
          <div className={styles.approvedImages}>
            <div><strong>平台批准的不可变工作负载镜像</strong><p>验真和正式订单只允许下列完整 RepoDigest；请在启动服务前拉取并配置到 `/etc/kai-host-actuator.env`。</p></div>
            {policy?.approvedImages.length ? policy.approvedImages.map((image) => <code key={image}>{image}</code>) : <span>正在读取平台镜像策略…</span>}
          </div>

          {!challenge ? (
            <div className={styles.actionRow}>
              <button className={styles.actionButton} disabled={!approved || busy} onClick={() => void issueChallenge()} type="button">{busy ? "正在签发…" : "签发一次性配对凭证"}</button>
              {!approved ? <Link className={styles.secondaryAction} href="/supply/onboarding">查看审核状态</Link> : null}
            </div>
          ) : (
            <>
              <dl className={styles.pairingFacts}>
                <div><dt>挑战编号</dt><dd>{challenge.id}</dd></div>
                <div><dt>最低 Agent 版本</dt><dd>{challenge.minimumAgentVersion}</dd></div>
                <div><dt>失效时间</dt><dd>{new Date(challenge.expiresAt).toLocaleString("zh-CN")}</dd></div>
              </dl>
              <pre className={styles.credentialBlock} tabIndex={0}>{pairingBundle}</pre>
              <div className={styles.actionRow}>
                <button className={styles.actionButton} onClick={downloadBundle} type="button">下载私有配对文件</button>
                <button className={styles.actionButton} onClick={() => void copyBundle()} type="button">{copied ? "已复制" : "复制配对内容"}</button>
                {!pairedDevice ? <button className={styles.secondaryAction} disabled={busy} onClick={() => void revokeChallenge()} type="button">{busy ? "正在废弃…" : "废弃这份凭证"}</button> : null}
              </div>
              {agentOnline && pairedDevice ? (
                <div className={styles.connectionSuccess} role="status">
                  <div><span>HOST ONLINE</span><strong>{pairedDevice.displayName}</strong><p>{pairedDevice.gpuModel.replace("_", " ")} · Agent {pairedDevice.agentVersion} · 服务端已收到第 {pairedDevice.lastSequence} 次签名心跳</p></div>
                  <Link className={styles.actionButton} href={`/supply/devices/${encodeURIComponent(pairedDevice.id)}`}>进入设备验真</Link>
                </div>
              ) : connectionVerified && pairedDevice ? (
                <div className={styles.connectionWaiting} role="status"><span aria-hidden="true" /><div><strong>{pairedDevice.displayName} 的签名连接已验证</strong><p>请完成批准镜像配置并启动 Host Agent 服务；收到在线心跳后会自动开放验真入口。</p></div></div>
              ) : pairedDevice ? (
                <div className={styles.connectionWaiting} role="status"><span aria-hidden="true" /><div><strong>{pairedDevice.displayName} 已完成签名注册</strong><p>请按安装教程运行一次 `kai-host-agent check-connection`；Cloud 接受签名连接检查后会自动更新此状态。</p></div></div>
              ) : pairingExpired ? (
                <div className={styles.connectionExpired} role="alert"><div><strong>这份一次性凭证已过期</strong><p>主机尚未完成注册。请废弃旧内容并重新签发，不要继续使用已过期凭证。</p></div><button className={styles.secondaryAction} onClick={() => { setChallenge(null); setPairingExpired(false); issueKey.current = null; }} type="button">重新签发</button></div>
              ) : (
                <div className={styles.connectionWaiting} role="status"><span aria-hidden="true" /><div><strong>正在等待这台主机完成配对</strong><p>主机成功注册后，本页面会自动显示设备名称并开放验真入口。</p></div></div>
              )}
              <p className="m-0 text-xs text-[var(--muted)]">下载文件只在当前浏览器内临时生成，不会写入浏览器存储。请把文件设为 `0600` 并仅交给目标主机；配对完成后立即安全删除。刷新后无法恢复，凭证会在服务端到期，或被一台成功注册的 Agent 消费。</p>
            </>
          )}
        </div>
      </section>
    </>
  );
}
