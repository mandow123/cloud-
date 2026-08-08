import type { Metadata } from "next";
import { KaiStandardAccount } from "@/components/kai-standard-account";
import styles from "@/components/kai-standard-pages.module.css";

export const metadata: Metadata = {
  title: "容量与 KAI 等值",
  description: "查看本组织原生容量、KAI 标准卡时市场等值、订单占用和人民币结算进度。",
};

export default function KaiHoursAccountPage() {
  return (
    <div className={styles.page}>
      <header className={styles.hero}>
        <div className={`${styles.shell} ${styles.heroInner}`}>
          <div>
            <p className={styles.kicker}>CAPACITY &amp; SETTLEMENT</p>
            <h1 className={styles.title}>KAI 卡时总览</h1>
            <p className={styles.lead}>查看已验真入库等值、当前可售等值、已完成服务等值和累计结算金额。原生容量负责交付，KAI-SCH 用于比较，人民币金额来自订单结算。</p>
          </div>
          <aside className={styles.heroNote}>
            <strong>账户数字来自服务端事实</strong>
            <span>没有有效验真、容量账、订单或结算投影时，页面显示不可用状态，不使用本地数字补齐。</span>
          </aside>
        </div>
      </header>
      <div className={`${styles.shell} ${styles.content}`}>
        <KaiStandardAccount />
      </div>
    </div>
  );
}
