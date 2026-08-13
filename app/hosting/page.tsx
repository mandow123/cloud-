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
      eyebrow="KAI HOSTING · VERIFIED COMPUTE NETWORK"
      title="让闲置算力，安全地开始工作。"
      titleEn="Put verified compute to work."
      summary="从一张 GPU 到一笔真实订单：平台完成验真、挂牌、交付、按秒计量、卡时结算与清理再售。"
    >
      <HostingLegacyHashRedirect />
      <HostingLaunchpad />

      <section className={styles.section}>
        <SectionHeader
          index="CONTRACT STATE MACHINE / 合同状态机"
          title="每一阶段都由前后端共同确认"
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
          <h2>首期只开放单张 RTX 4090 / H100</h2>
          <p>先完成一台机器、一份报价、一笔三分钟订单和一次彻底清理。公开充值、卡时回购和未验收连接器继续关闭。</p>
        </div>
        <div className={styles.actions}>
          <Link className={styles.actionPrimary} href="/login?returnTo=%2Fsupply%2Fonboarding">开始上架</Link>
          <Link className={styles.actionSecondary} href="/guides/host-agent">Host Agent 教程</Link>
        </div>
      </aside>
    </HostingPublicShell>
  );
}
