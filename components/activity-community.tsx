"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";
import type { ActivitySnapshot, ActivitySubmission } from "@/lib/activity-types";
import styles from "./activity-community.module.css";

type ErrorEnvelope = { error?: { message?: string } };

async function readJson<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({})) as T & ErrorEnvelope;
  if (!response.ok) throw new Error(body.error?.message || "活动服务暂时不可用。 ");
  return body;
}

function SubmissionCard({ item, onVote, busy }: { item: ActivitySubmission; onVote: (id: string) => void; busy: boolean }) {
  return <article className={styles.workCard}>
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img alt={item.title} loading="lazy" src={item.assetUrl} />
    <div><span>{item.campaignTitle}</span><h3>{item.title}</h3><p>{item.description}</p><small>by {item.authorName}</small><button aria-pressed={item.votedByViewer} disabled={busy} onClick={() => onVote(item.id)} type="button"><b>{item.votedByViewer ? "已投能量" : "投一束能量"}</b><em>✦ {item.voteCount}</em></button></div>
  </article>;
}

export function ActivityCommunity() {
  const [snapshot, setSnapshot] = useState<ActivitySnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busyId, setBusyId] = useState("");
  const [uploading, setUploading] = useState(false);

  const load = useCallback(async () => {
    try { setSnapshot(await readJson<ActivitySnapshot>(await fetch("/api/activity", { credentials: "same-origin", cache: "no-store" }))); setError(""); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "活动服务暂时不可用。 "); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => {
    let cancelled = false;
    void fetch("/api/activity", { credentials: "same-origin", cache: "no-store" })
      .then((response) => readJson<ActivitySnapshot>(response))
      .then((next) => { if (!cancelled) setSnapshot(next); })
      .catch((cause: unknown) => { if (!cancelled) setError(cause instanceof Error ? cause.message : "活动服务暂时不可用。 "); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  async function vote(id: string) {
    if (!snapshot?.viewer) { window.location.assign(`/login?returnTo=${encodeURIComponent("/activity#community")}`); return; }
    setBusyId(id); setError("");
    const item = snapshot.submissions.find((entry) => entry.id === id);
    try { await readJson(await fetch(`/api/activity/submissions/${encodeURIComponent(id)}/vote`, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ voted: !item?.votedByViewer }) })); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "投票失败。 "); }
    finally { setBusyId(""); }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setUploading(true); setError(""); setNotice("");
    const form = event.currentTarget;
    try {
      await readJson(await fetch("/api/activity/submissions", { method: "POST", credentials: "same-origin", body: new FormData(form) }));
      form.reset(); setNotice("作品已安全上传，审核通过后会出现在公开作品墙。 "); await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "作品上传失败。 "); }
    finally { setUploading(false); }
  }

  const activeCampaigns = snapshot?.campaigns.filter((item) => item.status === "ACTIVE" || item.status === "EVERGREEN") ?? [];
  return <section className={styles.community} id="community" aria-labelledby="community-title">
    <div className={styles.heading}><div><span>04 / COMMUNITY ENERGY</span><h2 id="community-title">作品墙与实时榜单</h2></div>{snapshot?.viewer ? <div className={styles.account}><span>当前账户</span><strong>{snapshot.viewer.displayName}</strong><small>奖励余额 {snapshot.rewardBalance} KAI 时</small><Link href={snapshot.viewer.source === "chatgpt" ? "/signout-with-chatgpt?return_to=/activity" : "/member"}>{snapshot.viewer.source === "chatgpt" ? "退出" : "账户中心"} →</Link></div> : <div className={styles.login}><strong>登录后投稿与投票</strong><div><Link href="/login?returnTo=/activity%23community">邮箱登录</Link><a href="/signin-with-chatgpt?return_to=/activity%23community">ChatGPT 登录</a></div></div>}</div>
    {error ? <div className={styles.error} role="alert">{error}</div> : null}{notice ? <div className={styles.notice} role="status">{notice}</div> : null}
    <div className={styles.layout}>
      <div>
        <div className={styles.subheading}><h3>最新公开作品</h3><span>{snapshot?.submissions.length ?? 0} 件</span></div>
        {loading ? <div className={styles.empty}>正在读取作品…</div> : snapshot?.submissions.length ? <div className={styles.workGrid}>{snapshot.submissions.map((item) => <SubmissionCard busy={busyId === item.id} item={item} key={item.id} onVote={vote} />)}</div> : <div className={styles.empty}><strong>作品墙正在等待第一件作品</strong><span>提交后会先经过安全审核，不会自动公开。</span></div>}
      </div>
      <aside className={styles.ranking}><div className={styles.subheading}><h3>能量榜 TOP 10</h3><span>实时</span></div><ol>{snapshot?.leaderboard.slice(0, 10).map((item, index) => <li key={item.id}><b>{String(index + 1).padStart(2, "0")}</b><span><strong>{item.title}</strong><small>{item.authorName}</small></span><em>✦ {item.voteCount}</em></li>)}</ol>{!snapshot?.leaderboard.length ? <div className={styles.empty}>榜单尚未产生</div> : null}</aside>
    </div>
    <div className={styles.creatorArea}>
      <div><span>05 / SUBMIT YOUR WORK</span><h2>把你的作品放进能量池</h2><p>支持 JPG、PNG、WebP、AVIF，最大 10MB。图片存入独立对象存储，审核前仅作者和管理员可见。</p></div>
      {!snapshot?.viewer ? <div className={styles.authGate}><strong>需要先完成身份验证</strong><p>登录用于作品归属、限制重复投票和接收奖励。</p><Link href="/login?returnTo=/activity%23community">登录后投稿 →</Link></div> : <form className={styles.uploadForm} onSubmit={submit}><label><span>选择活动</span><select name="campaignId" required>{activeCampaigns.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label><label><span>作品标题</span><input maxLength={80} minLength={2} name="title" required /></label><label><span>作品说明</span><textarea maxLength={500} minLength={10} name="description" required rows={3} /></label><label><span>关键提示词 / 创作过程</span><textarea maxLength={500} minLength={3} name="promptExcerpt" required rows={3} /></label><label className={styles.file}><span>作品图片</span><input accept="image/jpeg,image/png,image/webp,image/avif" name="file" required type="file" /></label><button disabled={uploading || activeCampaigns.length === 0} type="submit">{uploading ? "正在安全上传…" : "提交作品等待审核 ↗"}</button></form>}
    </div>
    {snapshot?.viewer && snapshot.mySubmissions.length ? <div className={styles.mine}><div className={styles.subheading}><h3>我的投稿</h3><span>{snapshot.mySubmissions.length} 件</span></div><div>{snapshot.mySubmissions.map((item) => <article key={item.id}><strong>{item.title}</strong><span className={styles[item.status.toLowerCase()]}>{item.status === "PENDING" ? "待审核" : item.status === "PUBLISHED" ? "已公开" : "未通过"}</span><small>✦ {item.voteCount} · 奖励 {item.rewardUnits} KAI 时</small></article>)}</div></div> : null}
  </section>;
}
