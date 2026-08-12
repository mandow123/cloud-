import type { Metadata } from "next";
import Link from "next/link";
import { HostingLegacyHashRedirect } from "@/components/hosting-legacy-hash-redirect";
import { HostingLaunchpad } from "@/components/hosting-launchpad";
import {
  HostingPublicShell,
  SectionHeader,
  hostingPublicStyles as styles,
} from "@/components/hosting-public-shell";

export const metadata: Metadata = {
  title: "Hosting 算力上架",
  description: "个人 GPU、云服务器与数据中心统一上架、验真、交付与结算。",
};

export default function HostingPage() {
  return (
    <HostingPublicShell
      activePath="/hosting"
      eyebrow="KAI Hosting · Real compute network"
      title="让算力抵达需要它的时刻。"
      summary="Rent verified compute. Host real machines. Settle every second in KAI 标准卡时。"
    >
      <HostingLegacyHashRedirect />
      <HostingLaunchpad />

      <section className={styles.section}>
        <SectionHeader
          index="01 / WORKSPACES"
          title="每一步都有独立工作面"
          lead="不是页内锚点，也不是静态介绍。每个入口都连接到对应状态和下一步操作。"
        />
        <div className={styles.cardGrid}>
          {[
            ["01", "个人 GPU", "网络预检、Agent 安装、验真与第一笔订单。", "/hosting/personal-gpu", "打开接入页"],
            ["02", "云资源接入", "云主机、IDC 与集群库存连接器及开放状态。", "/hosting/cloud", "打开连接器页"],
            ["03", "收益与结算", "卡时计量、租金、佣金和不可变账本口径。", "/hosting/earnings", "打开收益页"],
            ["04", "供应商合作", "企业协议、权属审核和邀请制接入进度。", "/hosting/partners", "打开合作页"],
            ["05", "供应控制台", "资源、挂牌、订单、异常和收益的操作中心。", "/login?returnTo=%2Fsupply", "进入控制台"],
            ["06", "Host Agent 教程", "从预检到配对、连接验证与安全清理。", "/guides/host-agent", "打开操作手册"],
          ].map(([code, title, description, href, linkLabel]) => (
            <article className={styles.card} key={code}>
              <span className={styles.cardCode}>{code}</span>
              <h3>{title}</h3>
              <p>{description}</p>
              <Link href={href}>{linkLabel} →</Link>
            </article>
          ))}
        </div>
      </section>

      <section className={styles.section}>
        <SectionHeader
          index="02 / STATE MACHINE"
          title="一条订单，只能按证据向前走"
          lead="成交时冻结规格与费率；交付、计量、验收和清理都由后端状态机约束。"
        />
        <ol className={styles.process}>
          {[
            ["01", "登记资源", "提交设备、网络、权属与可用时间。", "供应方"],
            ["02", "平台验真", "Agent 签名上报硬件证据并运行受控负载。", "自动 + 人审"],
            ["03", "发布报价", "冻结规格、卡时单价、最低时长与费率版本。", "供应方"],
            ["04", "锁定卡时", "买家余额先锁定，避免库存和余额并发超卖。", "平台账本"],
            ["05", "实例交付", "创建独立容器、注入临时 SSH 密钥并确认可连接。", "Host Agent"],
            ["06", "计量结算", "按实际秒数扣减，释放余量并生成租金与佣金。", "平台账本"],
            ["07", "撤权清理", "撤销密钥、删除工作区；证据完整后恢复可售。", "Host Agent"],
          ].map(([number, title, description, owner]) => (
            <li key={number}>
              <span className={styles.processNumber}>{number}</span>
              <strong>{title}</strong>
              <p>{description}</p>
              <span className={styles.badge}>{owner}</span>
            </li>
          ))}
        </ol>
      </section>

      <aside className={styles.notice}>
        <div>
          <h2>从一台真实机器开始</h2>
          <p>首期只接受单张 RTX 4090 / H100。公开充值、卡时回购和未经生产验收的连接器继续保持关闭。</p>
        </div>
        <div className={styles.actions}>
          <Link className={styles.actionPrimary} href="/login?returnTo=%2Fsupply%2Fonboarding">开始供应商审核</Link>
          <Link className={styles.actionSecondary} href="/guides/host-agent">阅读上架教程</Link>
        </div>
      </aside>
    </HostingPublicShell>
  );
}
