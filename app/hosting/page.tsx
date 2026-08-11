import type { Metadata } from "next";
import Link from "next/link";
import { GpuHostingLab } from "@/components/gpu-cloud-lab";
import { HostingLegacyHashRedirect } from "@/components/hosting-legacy-hash-redirect";
import {
  HostingPublicShell,
  SectionHeader,
  hostingPublicStyles as styles,
} from "@/components/hosting-public-shell";
import { isHostingV2Enabled } from "@/lib/server/hosting-v2-feature";

export const metadata: Metadata = {
  title: "Hosting 算力上架",
  description: "个人 GPU、云服务器与数据中心统一上架、验真、交付与结算。",
};

export default function HostingPage() {
  if (!isHostingV2Enabled()) return <GpuHostingLab />;

  return (
    <HostingPublicShell
      activePath="/hosting"
      eyebrow="Hosting · Supply control plane"
      title="把一台真实机器，变成可验证、可交付、可再售的算力。"
      summary="KAI Hosting 把资源登记、设备验真、报价、租用、计量、结算与清理拆成可追踪状态。首期从单张 RTX 4090 与 H100 开始。"
    >
      <HostingLegacyHashRedirect />
      <div className={styles.statusStrip} aria-label="首期边界">
        {[
          ["首期硬件", "1× RTX 4090 / H100"],
          ["隔离方式", "单租户 OCI 容器"],
          ["计量规则", "按秒 · 最低 3 分钟"],
          ["结算单位", "KAI 标准卡时"],
        ].map(([label, value]) => (
          <div className={styles.statusCell} key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>

      <section className={styles.section}>
        <SectionHeader
          index="01 / ENTRY"
          title="每一种供给，都有自己的入口"
          lead="公共页面只解释接入要求和状态；登录后才进入资源、挂牌、订单和收益控制台。"
        />
        <div className={styles.cardGrid}>
          {[
            ["01", "个人 GPU", "从网络检查、Agent 安装到第一笔三分钟租单。", "/hosting/personal-gpu", "查看个人 GPU 要求"],
            ["02", "云资源接入", "用统一连接器接入云主机、IDC 或数据中心库存。", "/hosting/cloud", "查看连接器状态"],
            ["03", "收益与结算", "查看卡时计量、租金、平台费与推荐佣金口径。", "/hosting/earnings", "查看计价规则"],
            ["04", "供应商合作", "企业协议、权属审核、资源边界与接入进度。", "/hosting/partners", "查看企业流程"],
            ["05", "供应商控制台", "集中管理设备、报价、订单、异常和账本明细。", "/login?returnTo=%2Fsupply", "登录控制台"],
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
          index="02 / CLOSED LOOP"
          title="成交不是终点，清理后重新可售才是闭环"
          lead="订单只能按固定状态推进；规格变化、心跳超时或清理失败都会暂停资源。"
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
          <h2>先验证一台真实机器</h2>
          <p>首期采用邀请制。公开支付宝充值、卡时回购和未通过生产验收的资源连接器仍保持关闭。</p>
        </div>
        <div className={styles.actions}>
          <Link className={styles.actionPrimary} href="/login?returnTo=%2Fsupply%2Fonboarding">开始供应商审核</Link>
          <Link className={styles.actionSecondary} href="/guides#list-4090">阅读上架教程</Link>
        </div>
      </aside>
    </HostingPublicShell>
  );
}
