"use client";

import { useState } from "react";
import type { ActivityCatalogItem } from "@/lib/activity-catalog";
import styles from "./activity-detail.module.css";

const assignments: Record<ActivityCatalogItem["tone"], readonly string[]> = {
  city: ["坐标 31°14′N · 一座会迁徙的火车站", "坐标 39°54′N · 被植物接管的环形广场", "坐标 23°08′N · 只在雨天出现的高塔"],
  sound: ["声音 A17 · 金属回声 / 72 BPM / 远处人声", "声音 C04 · 海风 / 短促脉冲 / 木质摩擦", "声音 F21 · 低频心跳 / 雨棚 / 反向钟声"],
  miniature: ["物件：旧钥匙 · 情绪：期待 · 限制：只能使用两种颜色", "物件：回形针 · 情绪：孤独 · 限制：场景必须悬浮", "物件：咖啡杯 · 情绪：庆祝 · 限制：不得出现人物"],
  material: ["本周材质：液态陶瓷 · 支线：在逆光下展示裂纹", "本周材质：液态陶瓷 · 支线：应用到可穿戴物", "本周材质：液态陶瓷 · 支线：同时表现柔软与锋利"],
  relay: ["接力链 048 · 待补：角色的秘密空间", "接力链 126 · 待补：一段 15 秒配乐", "接力链 209 · 待补：反派视角海报"],
  memory: ["年度记忆奖作品集", "最佳修复作品集", "公众共鸣奖作品集"],
};

export function ActivityMechanicAction({ activity }: { activity: ActivityCatalogItem }) {
  const [result, setResult] = useState("");
  const labels: Record<ActivityCatalogItem["tone"], string> = { city: "领取城市坐标", sound: "领取声音题目", miniature: "抽取三张主题卡", material: "领取本周支线", relay: "随机查看接力链", memory: "打开获奖作品集" };
  function reveal() {
    const options = assignments[activity.tone];
    const next = options[Math.floor(Math.random() * options.length)];
    setResult(next);
    try { window.localStorage.setItem(`kai-activity-assignment:${activity.id}`, next); } catch { /* device-local convenience only */ }
  }
  return <div className={styles.mechanic}><div><span>本场互动玩法</span><strong>{activity.mechanic}</strong><small>领取结果仅保存在当前浏览器；正式投稿和奖励会进入登录账户。</small></div><button onClick={reveal} type="button">{labels[activity.tone]} <b>↗</b></button>{result ? <p role="status"><span>你的本场任务</span><strong>{result}</strong></p> : null}</div>;
}
