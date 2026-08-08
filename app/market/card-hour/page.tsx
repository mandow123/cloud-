import type { Metadata } from "next";
import { KaiStandardMarket } from "@/components/kai-standard-market";
import styles from "@/components/kai-standard-pages.module.css";

export const metadata: Metadata = {
  title: "KAI 标准卡时行情",
  description: "按政策版本查看原生算力单位的 KAI 标准卡时市场等值、人民币参考区间和快照有效期。",
};

export default function KaiStandardCardHourPage() {
  return (
    <div className={styles.page}>
      <header className={styles.hero}>
        <div className={`${styles.shell} ${styles.heroInner}`}>
          <div>
            <p className={styles.kicker}>KAI STANDARD CARD HOUR</p>
            <h1 className={styles.title}>KAI 标准卡时行情</h1>
            <p className={styles.lead}>统一计价，按原生资源交付。查看不同资源在当前政策和市场快照下的 KAI-SCH 等值，订单仍按具体型号、地区和时间窗成交。</p>
          </div>
          <aside className={styles.heroNote}>
            <strong>先看原生单位，再看 KAI 等值</strong>
            <span>服务器时、核时、模型实例时、Token 容量时、NAS TiB时和机柜容量不会物理变成 GPU。跨品类数字只在标明时间和政策版本后用于价格比较。</span>
          </aside>
        </div>
      </header>
      <div className={`${styles.shell} ${styles.content}`}>
        <KaiStandardMarket />
      </div>
    </div>
  );
}
