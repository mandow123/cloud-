"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import styles from "./activity-hub.module.css";
import { ActivityCommunity } from "./activity-community";

type Filter = "全部" | "进行中" | "即将开始" | "长期活动";

const activities = [
  { id: "neon-city", eyebrow: "主线挑战 · 进行中", title: "霓虹城市重构计划", copy: "用模型重画你熟悉的一条街，让真实地标与未来想象在同一张图里相遇。", date: "08.12 — 09.08", prize: "120,000 KAI 时", tag: "进行中", tone: "violet", progress: 68, people: "3,842" },
  { id: "sound-shape", eyebrow: "跨模态实验 · 进行中", title: "把声音变成一座岛", copy: "上传一段 30 秒声音，以波形、节奏或情绪生成可漫游的视觉岛屿。", date: "08.19 — 09.18", prize: "80,000 KAI 时", tag: "进行中", tone: "cyan", progress: 41, people: "1,260" },
  { id: "tiny-world", eyebrow: "新手友好 · 即将开始", title: "掌心里的小世界", copy: "围绕一个日常物件创作微缩场景。提交提示词过程，比最终作品更重要。", date: "09.01 开启", prize: "创作工具包 × 500", tag: "即将开始", tone: "orange", progress: 0, people: "928" },
  { id: "open-lab", eyebrow: "开放实验室 · 长期活动", title: "一百种不可能材质", copy: "每周解锁一种材质词：云朵玻璃、液态陶瓷、会呼吸的金属……", date: "每周五更新", prize: "周榜算力加成", tag: "长期活动", tone: "lime", progress: 82, people: "6,419" },
];

const squads = [
  { name: "造梦局", icon: "✦", copy: "叙事、角色与世界观", count: "12.8k" },
  { name: "异材所", icon: "◈", copy: "材质、光影与实验", count: "9.4k" },
  { name: "动势组", icon: "↗", copy: "镜头、节奏与动态", count: "7.1k" },
];

export function ActivityHub() {
  const [filter, setFilter] = useState<Filter>("全部");
  const [joined, setJoined] = useState<string[]>([]);
  const [squad, setSquad] = useState("造梦局");
  const [choiceNotice, setChoiceNotice] = useState("");
  const filtered = useMemo(() => filter === "全部" ? activities : activities.filter((item) => item.tag === filter), [filter]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const savedSquad = window.localStorage.getItem("kai-activity-squad");
        const savedJoined = JSON.parse(window.localStorage.getItem("kai-activity-joined") ?? "[]") as unknown;
        if (squads.some((item) => item.name === savedSquad)) setSquad(savedSquad!);
        if (Array.isArray(savedJoined)) setJoined(savedJoined.filter((item): item is string => typeof item === "string" && activities.some((activity) => activity.id === item)));
      } catch {
        // Browser storage is optional. Account-backed activity flows remain usable without it.
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  function toggleJoin(id: string) {
    setJoined((current) => {
      const joining = !current.includes(id);
      const next = joining ? [...current, id] : current.filter((item) => item !== id);
      try { window.localStorage.setItem("kai-activity-joined", JSON.stringify(next)); } catch { /* optional preference storage */ }
      const activity = activities.find((item) => item.id === id);
      setChoiceNotice(`${activity?.title ?? "活动"}${joining ? "已加入当前浏览器的任务清单" : "已从当前浏览器的任务清单移除"}。`);
      return next;
    });
  }

  function chooseSquad(name: string) {
    setSquad(name);
    setChoiceNotice(`已选择${name}，阵营偏好保存在当前浏览器。`);
    try { window.localStorage.setItem("kai-activity-squad", name); } catch { /* optional preference storage */ }
  }

  return (
    <div className={styles.page}>
      <section className={styles.hero}>
        <div className={styles.orbOne} /><div className={styles.orbTwo} />
        <div className={styles.heroGrid}>
          <div className={styles.heroCopy}>
            <span className={styles.livePill}><i /> AUG · 创作季正在发生</span>
            <h1>把一个念头<br />变成<span>共同事件</span></h1>
            <p>这里没有标准答案。加入一个创作阵营，领取每周灵感任务，用作品为阵营积攒能量，赢取算力与展示席位。</p>
            <div className={styles.heroActions}>
              <a href="#events" className={styles.primaryAction}>探索本期活动 <b>↘</b></a>
              <a href="#rules" className={styles.textAction}>玩法说明 <span>02 min</span></a>
            </div>
          </div>
          <div className={styles.heroVisual} aria-label="本季阵营能量概览" role="img">
            <div className={styles.ring}><span>SEASON<br /><strong>02</strong></span></div>
            <div className={styles.floatCard}><small>本季共同创作</small><strong>21,406</strong><span>件作品已进入能量池</span></div>
            <div className={styles.spark}>✦</div>
          </div>
        </div>
        <div className={styles.marquee}><span>CREATE TOGETHER</span><i>✦</i><span>NO SINGLE ANSWER</span><i>✦</i><span>IDEAS BECOME WORLDS</span></div>
      </section>

      <section className={styles.squadSection} aria-labelledby="squad-title">
        <div className={styles.sectionIntro}>
          <div><span className={styles.index}>01 / CHOOSE A SIDE</span><h2 id="squad-title">先选一个创作阵营</h2></div>
          <p>阵营不限制你的创作方式，只决定你本周收到的隐藏任务。随时可以切换。</p>
        </div>
        <div className={styles.squadGrid}>
          {squads.map((item, index) => <button aria-pressed={squad === item.name} key={item.name} className={`${styles.squadCard} ${squad === item.name ? styles.selected : ""}`} onClick={() => chooseSquad(item.name)} type="button">
            <span className={styles.squadNo}>0{index + 1}</span><b className={styles.squadIcon}>{item.icon}</b><strong>{item.name}</strong><em>{item.copy}</em><small>{item.count} 位创作者</small><i>{squad === item.name ? "已加入" : "加入 →"}</i>
          </button>)}
        </div>
        <p className={styles.preferenceNote}>阵营和任务清单保存在当前浏览器；投稿、投票与奖励会安全保存到登录账户。</p>
        <p className={styles.liveNotice} aria-live="polite">{choiceNotice}</p>
      </section>

      <section className={styles.events} id="events" aria-labelledby="events-title">
        <div className={styles.sectionIntro}>
          <div><span className={styles.index}>02 / OPEN CALLS</span><h2 id="events-title">正在发生的创作</h2></div>
          <div className={styles.filters} aria-label="按活动状态筛选">{(["全部", "进行中", "即将开始", "长期活动"] as Filter[]).map((item) => <button aria-pressed={filter === item} key={item} onClick={() => setFilter(item)} type="button">{item}</button>)}</div>
        </div>
        <div className={styles.eventGrid}>
          {filtered.map((item, index) => <article className={`${styles.eventCard} ${styles[item.tone]}`} key={item.id}>
            <div className={styles.poster}>
              <span className={styles.posterIndex}>{String(index + 1).padStart(2, "0")}</span>
              <div className={styles.posterArt}><i /><i /><i /></div>
              <span className={styles.posterWord}>{item.id.replace("-", " ")}</span>
            </div>
            <div className={styles.eventBody}>
              <span className={styles.eyebrow}>{item.eyebrow}</span><h3>{item.title}</h3><p>{item.copy}</p>
              <dl><div><dt>活动时间</dt><dd>{item.date}</dd></div><div><dt>能量奖池</dt><dd>{item.prize}</dd></div></dl>
              {item.progress > 0 && <div className={styles.progress}><span><i style={{ width: `${item.progress}%` }} /></span><small>{item.people} 人已参与</small></div>}
              <button aria-pressed={joined.includes(item.id)} className={styles.joinButton} onClick={() => toggleJoin(item.id)} type="button">{joined.includes(item.id) ? (item.tag === "即将开始" ? "已加入提醒清单 ✓" : "已加入任务清单 ✓") : item.tag === "即将开始" ? "加入提醒清单" : "加入任务清单"}<span aria-hidden="true">↗</span></button>
            </div>
          </article>)}
        </div>
      </section>

      <section className={styles.rules} id="rules" aria-labelledby="rules-title">
        <div><span className={styles.index}>03 / HOW IT WORKS</span><h2 id="rules-title">三步，让灵感产生回声</h2></div>
        <ol><li><b>01</b><strong>领取变量</strong><span>每个阵营拿到不同的隐藏限制词。</span></li><li><b>02</b><strong>公开过程</strong><span>作品与关键提示词一起提交，鼓励再创作。</span></li><li><b>03</b><strong>积攒能量</strong><span>投票不淘汰作品，而是解锁全阵营奖励。</span></li></ol>
      </section>

      <ActivityCommunity />

      <section className={styles.cta}>
        <span>YOUR IDEA IS THE NEXT EVENT</span><h2>下一场活动，也可以由你发起。</h2><p>提交主题、参考图和玩法草案。入选提案将获得策展支持与独立算力池。</p><Link href="/request?mode=activity" className={styles.primaryAction}>提交活动提案 <b>↗</b></Link>
      </section>
    </div>
  );
}
