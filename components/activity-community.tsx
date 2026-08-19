"use client";

import Link from "next/link";
import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import type { ActivitySnapshot, ActivitySubmission } from "@/lib/activity-types";
import styles from "./activity-community.module.css";

type ErrorEnvelope = { error?: { message?: string } };

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const ALLOWED_UPLOAD_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

async function readJson<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({})) as T & ErrorEnvelope;
  if (!response.ok) throw new Error(body.error?.message?.trim() || "活动服务暂时不可用。");
  return body;
}

async function activityFetch(input: RequestInfo | URL, init?: RequestInit, timeoutMs = 20_000) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === "AbortError") throw new Error("请求超时，请检查网络后重试。");
    throw new Error("无法连接活动服务，请检查网络后重试。");
  } finally {
    window.clearTimeout(timer);
  }
}

function validSnapshot(value: ActivitySnapshot) {
  return value && Array.isArray(value.campaigns) && Array.isArray(value.submissions) && Array.isArray(value.leaderboard) && Array.isArray(value.mySubmissions);
}

function withVote(snapshot: ActivitySnapshot, id: string, voted: boolean): ActivitySnapshot {
  const update = (item: ActivitySubmission) => item.id === id
    ? { ...item, votedByViewer: voted, voteCount: Math.max(0, item.voteCount + (voted ? 1 : -1)) }
    : item;
  return {
    ...snapshot,
    submissions: snapshot.submissions.map(update),
    leaderboard: snapshot.leaderboard.map(update).sort((left, right) => right.voteCount - left.voteCount || left.createdAt.localeCompare(right.createdAt)),
  };
}

function SubmissionCard({ item, onVote, busy }: { item: ActivitySubmission; onVote: (id: string) => void; busy: boolean }) {
  const [imageFailed, setImageFailed] = useState(false);
  const voteLabel = busy ? (item.votedByViewer ? "正在取消…" : "正在投票…") : item.votedByViewer ? "取消能量" : "投一束能量";

  return <article className={styles.workCard}>
    {imageFailed
      ? <div className={styles.imageFallback} role="img" aria-label={`${item.title}的图片暂时无法显示`}>图片暂时无法显示</div>
      : /* eslint-disable-next-line @next/next/no-img-element */ <img alt={`${item.title}，${item.authorName} 的作品`} loading="lazy" onError={() => setImageFailed(true)} src={item.assetUrl} />}
    <div>
      <span>{item.campaignTitle}</span>
      <h3>{item.title}</h3>
      <p>{item.description}</p>
      <small>创作者：{item.authorName}</small>
      <button aria-label={`${voteLabel}：${item.title}，当前 ${item.voteCount} 束能量`} aria-pressed={item.votedByViewer} disabled={busy} onClick={() => onVote(item.id)} type="button">
        <b>{voteLabel}</b><em aria-hidden="true">✦ {item.voteCount}</em>
      </button>
    </div>
  </article>;
}

export function ActivityCommunity() {
  const [snapshot, setSnapshot] = useState<ActivitySnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busyId, setBusyId] = useState("");
  const [uploading, setUploading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [selectedCampaignId, setSelectedCampaignId] = useState(() => typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("campaign") ?? "");

  const load = useCallback(async (showLoading = false) => {
    if (showLoading) setLoading(true);
    try {
      const next = await readJson<ActivitySnapshot>(await activityFetch("/api/activity", { credentials: "same-origin", cache: "no-store" }));
      if (!validSnapshot(next)) throw new Error("活动服务返回了无法识别的数据，请稍后重试。");
      setSnapshot(next);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "活动服务暂时不可用。");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(true), 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    setError("");
    setSelectedFile(null);
    setPreviewUrl("");
    if (!file) return;
    if (!ALLOWED_UPLOAD_TYPES.has(file.type)) {
      event.target.value = "";
      setError("请选择 JPG、PNG、WebP 或 AVIF 图片。");
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      event.target.value = "";
      setError("图片超过 10MB，请压缩后再上传。");
      return;
    }
    setSelectedFile(file);
    setPreviewUrl(URL.createObjectURL(file));
  }

  async function vote(id: string) {
    if (!snapshot?.viewer) {
      window.location.assign(`/login?returnTo=${encodeURIComponent("/activity#community")}`);
      return;
    }
    const item = snapshot.submissions.find((entry) => entry.id === id);
    if (!item || busyId) return;
    const nextVoted = !item.votedByViewer;
    setBusyId(id);
    setError("");
    setNotice("");
    setSnapshot((current) => current ? withVote(current, id, nextVoted) : current);
    try {
      await readJson(await activityFetch(`/api/activity/submissions/${encodeURIComponent(id)}/vote`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ voted: nextVoted }),
      }));
      setNotice(nextVoted ? `已为《${item.title}》投出一束能量。` : `已取消对《${item.title}》的能量。`);
    } catch (cause) {
      setSnapshot((current) => current ? withVote(current, id, !nextVoted) : current);
      setError(cause instanceof Error ? cause.message : "投票失败。");
    } finally {
      setBusyId("");
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedFile) {
      setError("请先选择一张符合要求的作品图片。");
      return;
    }
    setUploading(true);
    setError("");
    setNotice("");
    const form = event.currentTarget;
    try {
      await readJson(await activityFetch("/api/activity/submissions", {
        method: "POST",
        credentials: "same-origin",
        headers: { "idempotency-key": `kai-submission-${crypto.randomUUID()}` },
        body: new FormData(form),
      }, 60_000));
      form.reset();
      setSelectedFile(null);
      setPreviewUrl("");
      setNotice("作品已安全上传，审核通过后会出现在公开作品墙；可在下方“我的投稿”查看状态。");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "作品上传失败。");
    } finally {
      setUploading(false);
    }
  }

  const activeCampaigns = snapshot?.campaigns.filter((item) => item.status === "ACTIVE" || item.status === "EVERGREEN") ?? [];
  const selectedCampaign = activeCampaigns.some((item) => item.id === selectedCampaignId) ? selectedCampaignId : activeCampaigns[0]?.id ?? "";
  const accountType = snapshot?.viewer?.source === "chatgpt" ? "ChatGPT 账户" : "KAI Cloud 账户";
  const fileSummary = useMemo(() => selectedFile ? `${selectedFile.name} · ${(selectedFile.size / 1024 / 1024).toFixed(2)}MB` : "尚未选择图片", [selectedFile]);

  return <section className={styles.community} id="community" aria-busy={loading || uploading} aria-labelledby="community-title">
    <div className={styles.heading}>
      <div><span>04 / COMMUNITY ENERGY</span><h2 id="community-title">作品墙与实时榜单</h2></div>
      {!snapshot
        ? <div className={styles.account}><span>账户状态</span><strong>{loading ? "正在确认账户…" : "暂时无法确认"}</strong><small>{loading ? "请稍候" : "重新加载后再投稿或投票"}</small></div>
        : snapshot.viewer
          ? <div className={styles.account}><span>已登录 · {accountType}</span><strong>{snapshot.viewer.displayName}</strong>{snapshot.viewer.email ? <small>{snapshot.viewer.email}</small> : null}<small>奖励余额 {snapshot.rewardBalance} KAI 时</small><Link href={snapshot.viewer.source === "chatgpt" ? "/signout-with-chatgpt?return_to=/activity" : "/member"}>{snapshot.viewer.source === "chatgpt" ? "退出当前账户" : "进入账户中心"} →</Link></div>
          : <div className={styles.login}><strong>登录后投稿与投票</strong><small>登录会保存作品归属、投票和奖励记录。</small><div><Link href="/login?returnTo=/activity%23community">邮箱登录</Link><a href="/signin-with-chatgpt?return_to=/activity%23community">ChatGPT 登录</a></div></div>}
    </div>

    {error ? <div className={styles.error} role="alert"><span>{error}</span><button onClick={() => void load(true)} type="button">重新加载</button></div> : null}
    {notice ? <div className={styles.notice} role="status" aria-live="polite">{notice}</div> : null}

    <div className={styles.layout}>
      <div>
        <div className={styles.subheading}><h3>最新公开作品</h3><span>{snapshot?.submissions.length ?? 0} 件</span></div>
        {loading
          ? <div className={styles.empty} role="status"><strong>正在读取作品</strong><span>作品墙和榜单会在数据返回后显示。</span></div>
          : snapshot?.submissions.length
            ? <div className={styles.workGrid}>{snapshot.submissions.map((item) => <SubmissionCard busy={busyId === item.id} item={item} key={item.id} onVote={vote} />)}</div>
            : <div className={styles.empty}><strong>作品墙正在等待第一件作品</strong><span>提交后会先经过安全审核，不会自动公开。</span></div>}
      </div>
      <aside className={styles.ranking} id="leaderboard" aria-labelledby="ranking-title">
        <div className={styles.subheading}><h3 id="ranking-title">能量榜 TOP 10</h3><span>实时</span></div>
        {!loading && snapshot?.leaderboard.length ? <ol>{snapshot.leaderboard.slice(0, 10).map((item, index) => <li key={item.id}><b>{String(index + 1).padStart(2, "0")}</b><span><strong>{item.title}</strong><small>{item.authorName}</small></span><em>✦ {item.voteCount}</em></li>)}</ol> : null}
        {!loading && !snapshot?.leaderboard.length ? <div className={styles.empty}>榜单尚未产生</div> : null}
        {loading ? <div className={styles.empty}>正在计算榜单…</div> : null}
      </aside>
    </div>

    <div className={styles.creatorArea}>
      <div><span>05 / SUBMIT YOUR WORK</span><h2>把你的作品放进能量池</h2><p>支持 JPG、PNG、WebP，最大 10MB。图片存入独立对象存储，审核前仅作者和管理员可见。每个账户每天最多提交 10 件作品。</p></div>
      {!snapshot?.viewer
        ? <div className={styles.authGate}><strong>需要先完成身份验证</strong><p>登录用于作品归属、限制重复投票和接收奖励。</p><Link href="/login?returnTo=/activity%23community">登录后投稿 →</Link></div>
        : activeCampaigns.length === 0
          ? <div className={styles.authGate} role="status"><strong>当前没有开放投稿的活动</strong><p>已登录为 {snapshot.viewer.displayName}。活动开放后可在这里直接提交。</p><button onClick={() => void load(true)} type="button">刷新活动状态</button></div>
          : <form className={styles.uploadForm} onSubmit={submit}>
            <label><span>选择活动</span><select name="campaignId" required disabled={uploading} onChange={(event) => setSelectedCampaignId(event.target.value)} value={selectedCampaign}>{activeCampaigns.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
            <label><span>作品标题</span><input aria-describedby="activity-title-help" maxLength={80} minLength={2} name="title" required disabled={uploading} /><small id="activity-title-help">2–80 字</small></label>
            <label><span>作品说明</span><textarea aria-describedby="activity-description-help" maxLength={500} minLength={10} name="description" required rows={3} disabled={uploading} /><small id="activity-description-help">说明创作主题，10–500 字</small></label>
            <label><span>关键提示词 / 创作过程</span><textarea aria-describedby="activity-prompt-help" maxLength={500} minLength={3} name="promptExcerpt" required rows={3} disabled={uploading} /><small id="activity-prompt-help">公开后会随作品展示，请勿填写密钥或隐私信息</small></label>
            <label className={styles.file}><span>作品图片</span><input accept="image/jpeg,image/png,image/webp" aria-describedby="activity-file-help" name="file" onChange={chooseFile} required type="file" disabled={uploading} /><small id="activity-file-help">{fileSummary}</small></label>
            {previewUrl ? <div className={styles.filePreview}>{/* eslint-disable-next-line @next/next/no-img-element */}<img alt="待上传作品预览" src={previewUrl} /><span>仅本机预览，点击提交后才会上传</span></div> : null}
            <button disabled={uploading || !selectedFile} type="submit">{uploading ? "正在安全上传，请勿关闭页面…" : "提交作品等待审核 ↗"}</button>
          </form>}
    </div>

    {snapshot?.viewer ? <div className={styles.mine}>
      <div className={styles.subheading}><h3>我的投稿</h3><span>{snapshot.mySubmissions.length} 件</span></div>
      {snapshot.mySubmissions.length
        ? <div>{snapshot.mySubmissions.map((item) => <article key={item.id}><strong>{item.title}</strong><span className={styles[item.status.toLowerCase()]}>{item.status === "PENDING" ? "待审核" : item.status === "PUBLISHED" ? "已公开" : "未通过"}</span><small>✦ {item.voteCount} · 奖励 {item.rewardUnits} KAI 时</small></article>)}</div>
        : <div className={styles.empty}><strong>还没有投稿记录</strong><span>成功提交后，审核状态会显示在这里。</span></div>}
    </div> : null}
  </section>;
}
