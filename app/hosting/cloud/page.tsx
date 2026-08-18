import type { Metadata } from "next";
import Link from "next/link";
import { HostingPublicShell, SectionHeader, hostingPublicStyles as styles } from "@/components/hosting-public-shell";

export const metadata: Metadata = {
  title: "云资源接入",
  description: "云主机、IDC 与数据中心算力的统一连接器和生产验收状态。",
};

export default function CloudHostingPage() {
  return (
    <HostingPublicShell
      activePath="/hosting/cloud"
      eyebrow="CLOUD INVENTORY · CONNECTOR CONTRACT"
      title="同一个市场，多种经过验收的交付方式。"
      titleEn="One market. Verified delivery paths."
      summary="云厂商、IDC 和自有集群通过统一连接器契约进入 KAI Cloud。只有完成真实预留、开通、计量、停止与清理演练的连接器才可成交。"
    >
      <section className={styles.section}>
        <SectionHeader index="01 / CONNECTORS" title="资源接入状态" lead="页面公开能力边界，不把尚未通过生产验收的接入方式伪装为可购买库存。" />
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead><tr><th>资源来源</th><th>接入方式</th><th>首期能力</th><th>成交状态</th></tr></thead>
            <tbody>
              <tr><td>个人 / 自有 GPU</td><td>KAI Host Agent</td><td>单卡 RTX 4090、H100</td><td><span className={styles.badge}>邀请制验收</span></td></tr>
              <tr><td>IDC 裸金属</td><td>Host Agent + 供应商 API</td><td>整机与固定端口池</td><td><span className={`${styles.badge} ${styles.badgeMuted}`}>接入申请</span></td></tr>
              <tr><td>公有云 GPU</td><td>云厂商连接器</td><td>预留、开通、计量、回收</td><td><span className={`${styles.badge} ${styles.badgeMuted}`}>未开放成交</span></td></tr>
              <tr><td>数据中心集群</td><td>库存与调度连接器</td><td>批量容量、SLA、维护窗口</td><td><span className={`${styles.badge} ${styles.badgeMuted}`}>方案审核</span></td></tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className={styles.section}>
        <SectionHeader index="02 / CONTRACT" title="每个连接器必须实现六个动作" />
        <div className={styles.cardGrid}>
          {[
            ["01", "Verify", "验证库存、规格、网络和供应主体授权。"],
            ["02", "Reserve", "原子预留资源，拒绝同一库存重复成交。"],
            ["03", "Provision", "创建实例、注入临时权限并返回受控端点。"],
            ["04", "Meter", "持续提交可验证的实际使用量。"],
            ["05", "Stop", "停止服务并冻结最终计量区间。"],
            ["06", "Cleanup", "撤权、删除工作区并提交清理证据。"],
          ].map(([code, title, description]) => (
            <article className={styles.card} key={code}><span className={styles.cardCode}>{code}</span><h3>{title}</h3><p>{description}</p></article>
          ))}
        </div>
      </section>

      <section className={styles.section}>
        <SectionHeader index="03 / ACCEPTANCE" title="生产开放门槛" lead="连接器失败时必须停在可恢复状态，不能跨级把订单标记成已交付或已结算。" />
        <div className={styles.twoColumn}>
          <div className={styles.column}><h3>必须通过</h3><ul className={styles.checkList}><li>真实库存争抢与重复回调演练</li><li>开通失败、连接失败和提前停止</li><li>准确计量、退款与账本幂等</li><li>清理失败进入 DRAINING</li></ul></div>
          <div className={styles.column}><h3>保持关闭</h3><ul className={styles.checkList}><li>只有名称目录、没有真实 API 的供应商</li><li>无法锁定规格与报价版本的库存</li><li>无法撤销买家权限的交付方式</li><li>未完成支付与法律评估的公开充值</li></ul></div>
        </div>
      </section>

      <aside className={styles.notice}>
        <div><h2>提交一个真实库存连接器</h2><p>企业接入先确认资源边界与技术接口，再安排沙箱和真实订单验收。</p></div>
        <div className={styles.actions}>
          <Link className={styles.actionPrimary} href="/hosting/partners">查看企业接入</Link>
          <Link className={styles.actionSecondary} href="/login?returnTo=%2Fsupply%2Fonboarding">进入供应商审核</Link>
        </div>
      </aside>
    </HostingPublicShell>
  );
}
