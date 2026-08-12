import type { Metadata } from "next";
import Link from "next/link";
import { HostingPublicShell, SectionHeader, hostingPublicStyles as styles } from "@/components/hosting-public-shell";

export const metadata: Metadata = {
  title: "Hosting 供应商合作",
  description: "企业供应商协议、审核、连接器验收与资源发布流程。",
};

export default function HostingPartnersPage() {
  return (
    <HostingPublicShell
      activePath="/hosting/partners"
      eyebrow="Partners · Governed onboarding"
      title="供应商不是一个名字，而是一组可审核、可履约的能力。"
      summary="企业供应商需要完成主体、权属、合同和技术能力审核。通过后按资源模板登记真实库存，并在生产连接器验收后开放成交。"
    >
      <div className={styles.statusStrip} aria-label="合作流程">
        {[["申请", "创建供应主体"], ["审核", "主体与权属"], ["验收", "连接器与订单"], ["运营", "库存、履约、结算"]].map(([label, value]) => <div className={styles.statusCell} key={label}><span>{label}</span><strong>{value}</strong></div>)}
      </div>

      <section className={styles.section}>
        <SectionHeader index="01 / REVIEW" title="审核内容和状态都在控制台留痕" lead="敏感文件进入私有加密存储；前端和日志只保留摘要、审核结果与短时查看凭证。" />
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead><tr><th>审核组</th><th>需要确认</th><th>通过后的权限</th></tr></thead>
            <tbody>
              <tr><td>主体</td><td>企业身份、成员关系、负责人</td><td>创建供应主体和邀请成员</td></tr>
              <tr><td>权属</td><td>设备、云账户或库存运营授权</td><td>登记对应资源类型</td></tr>
              <tr><td>协议</td><td><Link href="/hosting/partners/terms/KAI_HOSTING_TERMS_2026_08">供应协议、服务边界、争议处理</Link></td><td>安装 Agent 和提交验真</td></tr>
              <tr><td>技术</td><td>连接器、网络、计量、撤权与清理</td><td>发布通过验收的库存</td></tr>
              <tr><td>财务</td><td>费率版本、结算主体、账单信息</td><td>查看租金与账本明细</td></tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className={styles.section}>
        <SectionHeader index="02 / ONBOARDING" title="从申请到第一笔真实订单" />
        <ol className={styles.process}>
          {[
            ["01", "创建供应主体", "选择个人或企业类型，填写最少必要资料。", "DRAFT"],
            ["02", "签署并审核", "协议、主体和权属由管理员复核。", "REVIEW"],
            ["03", "接入真实资源", "按 GPU、服务器或连接器模板登记。", "INTEGRATE"],
            ["04", "沙箱验收", "运行预留、开通、计量、停止和清理故障演练。", "VERIFY"],
            ["05", "邀请制成交", "用真实卡时完成订单、退款和清理。", "PILOT"],
            ["06", "逐步开放", "持续满足心跳、履约与风险阈值后扩大库存。", "OPERATE"],
          ].map(([number, title, description, status]) => <li key={number}><span className={styles.processNumber}>{number}</span><strong>{title}</strong><p>{description}</p><span className={styles.badge}>{status}</span></li>)}
        </ol>
      </section>

      <section className={styles.section}>
        <SectionHeader index="03 / BOUNDARIES" title="平台首期明确不做的事" />
        <div className={styles.twoColumn}>
          <div className={styles.column}><h3>可以进入试运营</h3><ul className={styles.checkList}><li>真实可控的单卡 4090 或 H100</li><li>能够完成清理证据的自有 GPU 服务器</li><li>有明确库存和技术负责人的企业接入</li><li>使用管理员审批发放的试运营卡时</li></ul></div>
          <div className={styles.column}><h3>继续保持关闭</h3><ul className={styles.checkList}><li>只有公开名录、没有真实库存的供应商</li><li>不能持续验真或无法撤权的资源</li><li>尚未完成连接器生产验收的资源品类</li><li>支付宝、自助回购和公开现金兑付</li></ul></div>
        </div>
      </section>

      <aside className={styles.notice}>
        <div><h2>创建供应商接入申请</h2><p>登录后可保存草稿；只有审核通过的供应主体才能安装生产 Agent、验真和发布资源。</p></div>
        <div className={styles.actions}><Link className={styles.actionPrimary} href="/login?returnTo=%2Fsupply%2Fonboarding">开始申请</Link><Link className={styles.actionSecondary} href="/hosting/cloud">查看技术接入</Link></div>
      </aside>
    </HostingPublicShell>
  );
}
