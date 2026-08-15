import type { Metadata } from "next";
import Link from "next/link";
import { HostingPublicShell, SectionHeader, hostingPublicStyles as styles } from "@/components/hosting-public-shell";

export const metadata: Metadata = {
  title: "Hosting 收益与结算",
  description: "KAI 标准卡时的计量、租金、平台费、佣金和账本规则。",
};

export default function HostingEarningsPage() {
  return (
    <HostingPublicShell
      activePath="/hosting/earnings"
      eyebrow="EARNINGS · IMMUTABLE LEDGER"
      title="每一笔收益，都能回到一段真实服务时间。"
      titleEn="Every earning traces back to real compute."
      summary="KAI 标准卡时是站内统一计量与结算单位。买家先锁定预估卡时，服务结束后按实际秒数扣减，多余部分释放，供应方租金和推荐佣金分别入账。"
    >
      <dl className={styles.metricGrid}>
        {[
          ["参考换算", "1 KAI = ¥1.002", "人民币仅作固定参考展示"],
          ["计量精度", "按秒", "最低租用三分钟"],
          ["页面精度", "0.01 KAI", "所有卡时金额统一显示两位"],
          ["扣减方式", "先锁定后结算", "余量释放或退款"],
        ].map(([term, value, note]) => <div className={styles.metric} key={term}><dt>{term}</dt><dd>{value}<small>{note}</small></dd></div>)}
      </dl>

      <section className={styles.section}>
        <SectionHeader index="01 / FORMULA" title="实际用量如何计算" lead="订单成交时冻结卡时单价和费率版本，供应方后来改价不影响既有合同。" />
        <div className={styles.formula}>
          <code>实际扣减 = 向上取整（每 GPU 小时卡时价 × GPU 数量 × 实际秒数 ÷ 3600）</code>
          <p>所有运算仍使用整数微卡时精确记账，页面统一四舍五入显示两位。网站价 ¥31.20 的 H100 订单按固定参考换算后显示为 31.14 KAI 标准卡时。</p>
        </div>
      </section>

      <section className={styles.section}>
        <SectionHeader index="02 / LEDGER" title="一笔订单如何进入账本" />
        <ol className={styles.process}>
          {[
            ["01", "预估锁定", "按报价和预订时长锁定买家卡时。", "HOLD"],
            ["02", "实际计量", "平台按服务时间确认最终使用量。", "METER"],
            ["03", "扣减与释放", "扣除实际金额，未使用的锁定余额返还。", "SETTLE"],
            ["04", "租金归属", "验收后按费率版本生成供应方租金。", "RENT"],
            ["05", "佣金归属", "有有效推荐关系时单独生成佣金明细。", "COMMISSION"],
          ].map(([number, title, description, status]) => <li key={number}><span className={styles.processNumber}>{number}</span><strong>{title}</strong><p>{description}</p><span className={styles.badge}>{status}</span></li>)}
        </ol>
      </section>

      <section className={styles.section}>
        <SectionHeader index="03 / REVENUE" title="租金、佣金与平台费分开显示" lead="比例不硬编码；每个订单引用成交时生效的费率版本，未配置有效费率时禁止成交。" />
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead><tr><th>账目</th><th>产生条件</th><th>归属时间</th><th>可见位置</th></tr></thead>
            <tbody>
              <tr><td>供应方租金</td><td>实例完成计量并通过验收</td><td>订单结算时</td><td>供应商控制台 / 收益</td></tr>
              <tr><td>推荐佣金</td><td>订单绑定有效推荐关系与规则版本</td><td>订单结算时</td><td>个人面板 / 佣金收益</td></tr>
              <tr><td>平台服务费</td><td>成交费率版本中已配置</td><td>订单结算时</td><td>管理员财务账本</td></tr>
              <tr><td>退款 / 释放</td><td>提前停止、开通失败或预估余额剩余</td><td>取消或结算时</td><td>买家卡时记录</td></tr>
            </tbody>
          </table>
        </div>
      </section>

      <aside className={styles.notice}>
        <div><h2>当前不承诺公开回购或随时变现</h2><p>回购只保留申请、锁定和审核结构。公开充值、出款、发票与资金存管完成专项验收前，生产按钮保持关闭。</p></div>
        <div className={styles.actions}><Link className={styles.actionPrimary} href="/login?returnTo=%2Fsupply%2Fearnings">查看我的收益</Link><Link className={styles.actionSecondary} href="/methodology">查看计价方法</Link></div>
      </aside>
    </HostingPublicShell>
  );
}
