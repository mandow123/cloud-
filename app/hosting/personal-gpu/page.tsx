import type { Metadata } from "next";
import Link from "next/link";
import {
  HostingPublicShell,
  SectionHeader,
  hostingPublicStyles as styles,
} from "@/components/hosting-public-shell";

export const metadata: Metadata = {
  title: "个人 GPU 上架",
  description: "了解 RTX 4090 与 H100 的验真、挂牌、交付和清理要求。",
};

export default function PersonalGpuHostingPage() {
  return (
    <HostingPublicShell
      activePath="/hosting/personal-gpu"
      eyebrow="Personal GPU · First production profile"
      title="从一张 4090 开始，完整走完一笔真实租单。"
      summary="不是填写一张表就算上架。设备必须持续在线、规格可验证、端口可连接，并在订单结束后完成撤权与清理。"
    >
      <dl className={styles.metricGrid}>
        {[
          ["支持型号", "RTX 4090 / H100", "首期仅单卡、非 MIG"],
          ["宿主系统", "Ubuntu", "NVIDIA Container Toolkit"],
          ["网络", "公网端口可达", "运营商 NAT 阻断时不可发布"],
          ["最短订单", "3 分钟", "GPU 使用时长按秒计量"],
        ].map(([term, value, note]) => (
          <div className={styles.metric} key={term}>
            <dt>{term}</dt>
            <dd>{value}<small>{note}</small></dd>
          </div>
        ))}
      </dl>

      <section className={styles.section}>
        <SectionHeader
          index="01 / BEFORE INSTALL"
          title="发布前必须满足的条件"
          lead="不满足任意关键项可以保存草稿，但不能安装生产 Agent、验真或发布报价。"
        />
        <div className={styles.twoColumn}>
          <div className={styles.column}>
            <h3>主体与权属</h3>
            <ul className={styles.checkList}>
              <li>完成 KAI Identity 登录与邮箱验证</li>
              <li>签署供应协议并通过个人或企业审核</li>
              <li>证明设备归属或获得合法运营授权</li>
              <li>明确可用时段、维护窗口与所在地</li>
            </ul>
          </div>
          <div className={styles.column}>
            <h3>机器与网络</h3>
            <ul className={styles.checkList}>
              <li>独立 Ubuntu 主机和受支持的 NVIDIA 驱动</li>
              <li>GPU UUID、显存与运行规格保持稳定</li>
              <li>供应方配置的公网 SSH 端口可达</li>
              <li>允许 Agent 主动通过 HTTPS 领取受限命令</li>
            </ul>
          </div>
        </div>
      </section>

      <section className={styles.section}>
        <SectionHeader
          index="02 / VERIFY"
          title="Agent 会验证什么"
          lead="证据带设备签名、一次性挑战和递增序列；过期、重放或规格变化会立即暂停挂牌。"
        />
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead><tr><th>检查组</th><th>证据</th><th>失败后的处理</th></tr></thead>
            <tbody>
              {[
                ["GPU", "UUID、型号、显存、驱动、CUDA、受控负载", "设备保持草稿或暂停"],
                ["主机", "CPU、内存、存储、容器运行时", "禁止创建报价"],
                ["网络", "公网主机、端口可达性、延迟", "禁止发布"],
                ["持续在线", "签名心跳、序列号、规格摘要", "心跳超时自动下架"],
                ["订单清理", "密钥撤销、容器删除、工作区清理", "进入 DRAINING，不自动再售"],
              ].map((row) => <tr key={row[0]}>{row.map((cell) => <td key={cell}>{cell}</td>)}</tr>)}
            </tbody>
          </table>
        </div>
      </section>

      <section className={styles.section}>
        <SectionHeader index="03 / FIRST ORDER" title="第一笔订单的六个可见状态" />
        <ol className={styles.process}>
          {[
            ["01", "已验证", "硬件证据有效，设备在线。", "READY"],
            ["02", "已挂牌", "报价版本和库存窗口已发布。", "LISTED"],
            ["03", "开通中", "卡时锁定后创建受控容器。", "PROVISIONING"],
            ["04", "可连接", "买家 SSH 公钥已注入并通过探测。", "CONNECTABLE"],
            ["05", "计量中", "服务开始时间由平台确认并持续计量。", "RUNNING"],
            ["06", "已清理", "实际扣减完成，临时权限全部撤销。", "CLEAN"],
          ].map(([number, title, description, status]) => (
            <li key={number}>
              <span className={styles.processNumber}>{number}</span><strong>{title}</strong><p>{description}</p><span className={styles.badge}>{status}</span>
            </li>
          ))}
        </ol>
      </section>

      <aside className={styles.notice}>
        <div><h2>准备验证你的第一台机器</h2><p>审核通过后，控制台才会生成一次性安装凭证；不要从聊天或第三方脚本安装 Agent。</p></div>
        <div className={styles.actions}>
          <Link className={styles.actionPrimary} href="/login?returnTo=%2Fsupply%2Fonboarding">开始审核</Link>
          <Link className={styles.actionSecondary} href="/guides/host-agent">下载 Agent 与查看教程</Link>
        </div>
      </aside>
    </HostingPublicShell>
  );
}
