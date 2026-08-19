import Link from "next/link";
import type { ActivityCatalogItem } from "@/lib/activity-catalog";
import { ActivityMechanicAction } from "./activity-mechanic-action";
import styles from "./activity-detail.module.css";

export function ActivityDetail({ activity }: { activity: ActivityCatalogItem }) {
  const accepting = activity.status === "进行中" || activity.status === "长期活动";
  const actionHref = accepting ? `/?campaign=${encodeURIComponent(activity.id)}#submit-work` : `/?campaign=${encodeURIComponent(activity.id)}#community`;
  return <div className={`activity-experience ${styles.page}`}>
    <header className={styles.header}><Link className={styles.brand} href="/"><i>K</i><span>KAI CREATOR</span></Link><nav><Link href="/">挑战赛</Link><a href="#rules">规则</a><a href="#prizes">奖项</a><Link href="/#community">作品墙</Link></nav><Link className={styles.account} href="/login?returnTo=%2F">登录 / 账户</Link></header>
    <main>
      <section className={`${styles.hero} ${styles[activity.tone]}`}>
        <div className={styles.backdrop}><i /><i /><i /></div>
        <div className={styles.heroInner}><Link className={styles.back} href="/">← 返回活动广场</Link><div className={styles.badges}><span>● {activity.status}</span><span>{activity.category}</span><span>{activity.mechanic}</span></div><h1>{activity.title}</h1><p>{activity.subtitle}</p><div className={styles.heroBottom}><dl><div><dt>活动时间</dt><dd>{activity.date}</dd></div><div><dt>参与规模</dt><dd>{activity.participants}</dd></div><div><dt>奖励池</dt><dd>{activity.reward}</dd></div></dl><Link className={styles.cta} href={actionHref}>{accepting ? "立即投稿" : activity.status === "即将开始" ? "查看开赛时间" : "查看公开作品"}<b>↗</b></Link></div></div>
      </section>
      <section className={styles.brief}><span>01 / CHALLENGE BRIEF</span><div><h2>这次，要做什么？</h2><p>{activity.brief}</p></div></section>
      <ActivityMechanicAction activity={activity} />
      <section className={styles.steps} id="rules"><div><span>02 / HOW TO PLAY</span><h2>玩法不是一次上传，<br />而是一条完整创作路径。</h2></div><ol>{activity.steps.map((step,index)=><li key={step}><b>{String(index+1).padStart(2,"0")}</b><span>{step}</span></li>)}</ol></section>
      <section className={styles.infoGrid}><article id="prizes"><span>03 / PRIZE POOL</span><h2>奖项与回报</h2><ul>{activity.prizes.map((item)=><li key={item}>{item}</li>)}</ul></article><article><span>04 / SUBMISSION</span><h2>作品要求</h2><ul>{activity.requirements.map((item)=><li key={item}>{item}</li>)}</ul></article><article><span>05 / JUDGING</span><h2>资格与评审</h2><ul><li>{activity.eligibility}</li><li>{activity.judging}</li></ul></article><article><span>06 / RIGHTS</span><h2>版权与发奖</h2><ul><li>{activity.rights}</li><li>{activity.rewardDelivery}</li></ul></article></section>
      <section className={styles.final}><p>{activity.deadline}</p><h2>{accepting ? "你的作品，可以成为下一张活动封面。" : "看看同一个命题，被做成了多少种答案。"}</h2><Link href={actionHref}>{accepting ? "去提交作品" : "浏览作品墙"} <b>↗</b></Link></section>
    </main>
  </div>;
}
