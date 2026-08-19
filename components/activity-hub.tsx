"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { activityCatalog, type ActivityCatalogStatus } from "@/lib/activity-catalog";
import styles from "./activity-hub.module.css";
import { ActivityCommunity } from "./activity-community";

type StatusFilter = "全部" | ActivityCatalogStatus;
type CategoryFilter = "全部类型" | "图像" | "视频" | "3D" | "声音" | "共创";

const statusFilters: readonly StatusFilter[] = ["全部", "进行中", "即将开始", "评审中", "已颁奖", "长期活动"];
const categoryFilters: readonly CategoryFilter[] = ["全部类型", "图像", "视频", "3D", "声音", "共创"];
const railLinks = [
  { href: "/", icon: "⌂", label: "活动广场" },
  { href: "#community", icon: "▦", label: "作品墙" },
  { href: "#leaderboard", icon: "♛", label: "排行榜" },
  { href: "#how-it-works", icon: "?", label: "玩法说明" },
];

function statusClass(status: ActivityCatalogStatus) {
  if (status === "进行中" || status === "长期活动") return styles.active;
  if (status === "即将开始") return styles.upcoming;
  if (status === "评审中") return styles.reviewing;
  return styles.awarded;
}

export function ActivityHub() {
  const [status, setStatus] = useState<StatusFilter>("全部");
  const [category, setCategory] = useState<CategoryFilter>("全部类型");
  const [query, setQuery] = useState("");
  const visible = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("zh-CN");
    return activityCatalog.filter((item) => {
      const statusMatch = status === "全部" || item.status === status;
      const categoryMatch = category === "全部类型" || item.category === category;
      const queryMatch = !normalized || `${item.title}${item.subtitle}${item.mechanic}`.toLocaleLowerCase("zh-CN").includes(normalized);
      return statusMatch && categoryMatch && queryMatch;
    });
  }, [category, query, status]);

  return <div className={`activity-experience ${styles.page}`}>
    <div className={styles.promo}><span>✦ KAI 夏日创作季</span><strong>六大主题赛道正在展出 · 三场开放投稿</strong><a href="#campaigns">马上参赛</a></div>
    <header className={styles.topbar}>
      <Link className={styles.brand} href="/" aria-label="KAI 创作挑战首页"><i>K</i><span>KAI CREATOR</span></Link>
      <nav aria-label="活动主导航"><Link href="/" aria-current="page">挑战赛</Link><a href="#community">作品广场</a><a href="#leaderboard">排行榜</a><Link href="/market">算力行情</Link></nav>
      <div className={styles.topActions}><a className={styles.points} href="#leaderboard">✦ 我的能量</a><a className={styles.submitTop} href="#submit-work">发布作品</a><Link className={styles.account} href="/login?returnTo=%2F%23community" aria-label="登录或打开个人账户">人</Link></div>
    </header>
    <aside className={styles.rail} aria-label="活动快捷导航"><Link className={styles.railBrand} href="/" aria-label="KAI">K</Link><nav>{railLinks.map((item, index) => <a aria-current={index === 0 ? "page" : undefined} href={item.href} key={item.label}><span>{item.icon}</span><small>{item.label}</small></a>)}</nav></aside>

    <main className={styles.main}>
      <section className={styles.catalogHead} aria-labelledby="activity-title">
        <div><p><span>DISCOVER</span> / 发现下一次创作</p><h1 id="activity-title">创作挑战</h1><p className={styles.intro}>选择一个命题，把作品、过程和灵感放进社区。这里不只评最终结果，也奖励真实过程与共创贡献。</p></div>
        <dl><div><dt>开放投稿</dt><dd>3</dd></div><div><dt>KAI 时奖励</dt><dd>12万+</dd></div><div><dt>参赛作品</dt><dd>1.6万+</dd></div></dl>
      </section>
      <section className={styles.toolbar} aria-label="筛选活动">
        <div className={styles.statusFilters}>{statusFilters.map((item) => <button aria-pressed={status === item} key={item} onClick={() => setStatus(item)} type="button">{item}</button>)}</div>
        <div className={styles.secondaryFilters}><label><span className="sr-only">活动类型</span><select onChange={(event) => setCategory(event.target.value as CategoryFilter)} value={category}>{categoryFilters.map((item) => <option key={item}>{item}</option>)}</select></label><label className={styles.search}><span aria-hidden="true">⌕</span><input onChange={(event) => setQuery(event.target.value)} placeholder="搜索活动" value={query} /></label></div>
      </section>
      <section className={styles.catalog} id="campaigns" aria-live="polite">
        <div className={styles.catalogMeta}><strong>{status === "全部" ? "全部挑战" : status}</strong><span>{visible.length} 个活动</span></div>
        {visible.length ? <div className={styles.grid}>{visible.map((item, index) => <Link className={`${styles.card} ${styles[item.tone]}`} href={`/activity/${item.slug}`} key={item.id}>
          <div className={styles.poster}><span className={`${styles.status} ${statusClass(item.status)}`}>● {item.status}</span><span className={styles.category}>{item.category}</span><div className={styles.art} aria-hidden="true"><i /><i /><i /><b>{String(index + 1).padStart(2, "0")}</b></div><div className={styles.posterCopy}><small>{item.mechanic}</small><strong>{item.subtitle}</strong></div><div className={styles.reward}>♕ <span>{item.reward}</span></div><div className={styles.cardHover}><span>查看详情</span><b>↗</b></div></div>
          <div className={styles.cardBody}><div><h2>{item.title}</h2><p>{item.date} · {item.deadline}</p></div><span>{item.participants}</span></div>
        </Link>)}</div> : <div className={styles.empty}><strong>暂时没有匹配的活动</strong><button onClick={() => { setStatus("全部"); setCategory("全部类型"); setQuery(""); }} type="button">清除筛选</button></div>}
      </section>
      <section className={styles.how} id="how-it-works" aria-labelledby="how-title"><div><span>HOW IT WORKS</span><h2 id="how-title">不只比一张成片，<br />也看创作是怎么发生的。</h2></div><ol><li><b>01</b><strong>选活动</strong><span>查看命题、规格和奖励，领取可选支线任务。</span></li><li><b>02</b><strong>交作品</strong><span>上传作品并公开关键过程，审核后进入作品墙。</span></li><li><b>03</b><strong>攒能量</strong><span>社区投票、专业评审与共创贡献形成多维榜单。</span></li></ol></section>
      <div id="submit-work"><ActivityCommunity /></div>
    </main>
    <nav className={styles.mobileNav} aria-label="移动端活动导航"><Link href="/" aria-current="page"><span>⌂</span>活动</Link><a href="#community"><span>▦</span>作品</a><a href="#leaderboard"><span>♛</span>榜单</a><a className={styles.mobileSubmit} href="#submit-work"><span>＋</span>投稿</a></nav>
  </div>;
}
