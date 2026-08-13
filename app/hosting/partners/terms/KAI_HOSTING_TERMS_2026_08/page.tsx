import type { Metadata } from "next";
import Link from "next/link";
import { HostingPublicShell, SectionHeader, hostingPublicStyles as styles } from "@/components/hosting-public-shell";

export const metadata: Metadata = {
  title: "KAI Hosting 算力供应协议 · 2026.08",
  description: "KAI Hosting 邀请制试运营的供应方权属、交付、计量、结算和清理规则。",
};

const version = "KAI_HOSTING_TERMS_2026_08";

export default function HostingTerms202608Page() {
  return (
    <HostingPublicShell
      activePath="/hosting/partners"
      eyebrow="IMMUTABLE SUPPLIER TERMS · 2026.08"
      title="KAI Hosting 算力供应协议"
      titleEn="Supplier Terms · Version 2026.08"
      summary="本页是邀请制试运营的固定协议版本。供应主体提交审核时，服务端会把此版本写入不可变审核记录；后续修订不会覆盖本页。"
    >
      <div className={styles.statusStrip} aria-label="协议版本信息">
        <div className={styles.statusCell}><span>版本</span><strong>{version}</strong></div>
        <div className={styles.statusCell}><span>发布日期</span><strong>2026-08-12</strong></div>
        <div className={styles.statusCell}><span>适用范围</span><strong>邀请制 GPU 试运营</strong></div>
        <div className={styles.statusCell}><span>公开现金支付</span><strong>未开放</strong></div>
      </div>

      <section className={styles.section}>
        <SectionHeader index="01 / SCOPE" title="主体、资源和授权" lead="供应方只能登记自己合法持有或获明确授权运营的资源，并持续具备交付、撤权和清理能力。" />
        <div className={styles.twoColumn}>
          <div className={styles.column}><h3>供应方承诺</h3><ul className={styles.checkList}><li>提交的主体、联系人和设备信息真实、完整、可核验</li><li>对设备、网络、公网端口及运行环境具有合法使用和出租授权</li><li>不会登记受盗用、抵押限制、合同禁止或权属争议影响的资源</li><li>资源规格变化、权属变化或网络限制出现后立即暂停挂牌</li></ul></div>
          <div className={styles.column}><h3>平台边界</h3><ul className={styles.checkList}><li>平台提供资源登记、验真、挂牌、合同、计量和卡时账本能力</li><li>审核通过不代表平台为设备权属、收益或持续成交提供担保</li><li>平台可因安全、合规、心跳、清理或证据异常暂停资源</li><li>未完成生产验收的连接器和资源品类不能进入成交</li></ul></div>
        </div>
      </section>

      <section className={styles.section}>
        <SectionHeader index="02 / AGENT" title="Host Agent 与最小权限" lead="供应方授权经过审核的 KAI Host Agent 在登记设备上执行固定动作，但不授予平台任意宿主机 Shell。" />
        <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>动作</th><th>允许范围</th><th>失败处理</th></tr></thead><tbody>
          <tr><td>采集与验真</td><td>GPU、驱动、CUDA、CPU、内存、存储、网络和端口的必要证据</td><td>证据过期或规格变化时自动暂停挂牌</td></tr>
          <tr><td>实例交付</td><td>仅使用平台批准的不可变 OCI 镜像、单合同容器和临时 SSH 公钥</td><td>镜像、端口或资源限制不符时拒绝开通</td></tr>
          <tr><td>计量与停止</td><td>依据受控容器的服务开始和停止时间生成签名证据</td><td>证据不完整时禁止结算</td></tr>
          <tr><td>撤权与清理</td><td>移除容器、临时密钥和合同工作目录并提交清理证明</td><td>清理失败时设备进入 DRAINING，不得重新挂牌</td></tr>
        </tbody></table></div>
      </section>

      <section className={styles.section}>
        <SectionHeader index="03 / DELIVERY" title="可用性、网络与履约" />
        <ol className={styles.process}>
          <li><span className={styles.processNumber}>01</span><strong>持续在线</strong><p>供应方按挂牌窗口保证主机、Agent、网络和预留端口可用，并及时处理异常告警。</p><span className={styles.badge}>HEARTBEAT</span></li>
          <li><span className={styles.processNumber}>02</span><strong>规格一致</strong><p>订单交付的 GPU 型号、显存、镜像和连接入口必须与冻结合同快照一致。</p><span className={styles.badge}>SNAPSHOT</span></li>
          <li><span className={styles.processNumber}>03</span><strong>禁止干预</strong><p>服务期间不得擅自停机、回收端口、替换设备、访问买家工作目录或复用临时密钥。</p><span className={styles.badge}>ISOLATED</span></li>
          <li><span className={styles.processNumber}>04</span><strong>故障配合</strong><p>发生中断、滥用、争议或清理失败时，供应方应保留必要证据并配合停止与复核。</p><span className={styles.badge}>AUDITED</span></li>
        </ol>
      </section>

      <section className={styles.section}>
        <SectionHeader index="04 / METERING" title="卡时计量与收益" lead="KAI 标准卡时是平台内部算力计价和结算单位，不是法定货币、存款、证券或无条件兑付承诺。" />
        <div className={styles.twoColumn}>
          <div className={styles.column}><h3>订单计算</h3><ul className={styles.checkList}><li>GPU 按秒计量，首期最低租用三分钟</li><li>买家先锁定预估卡时，服务结束后按实际计量扣减，多余部分释放</li><li>合同冻结设备规格、费率版本、供应协议版本、镜像和可用窗口</li><li>所有金额使用整数微卡时记录，避免浮点误差和重复入账</li></ul></div>
          <div className={styles.column}><h3>供应方收益</h3><ul className={styles.checkList}><li>只有服务完成、计量有效并通过验收后才形成租金收益</li><li>平台服务费和推荐奖励按合同冻结的版本化费率执行</li><li>争议、退款、欺诈或证据缺失可暂停归属和结算</li><li>回购、现金变现和公开充值在相应法务与支付能力上线前保持关闭</li></ul></div>
        </div>
      </section>

      <section className={styles.section}>
        <SectionHeader index="05 / SECURITY" title="数据、安全与禁止行为" />
        <div className={styles.cardGrid}>
          <article className={styles.card}><span className={styles.cardCode}>DATA</span><h3>最少必要数据</h3><p>平台只处理准入、验真、交付、计量和争议所需数据。敏感材料进入私有存储，普通页面和日志只保留摘要。</p></article>
          <article className={styles.card}><span className={styles.cardCode}>ABUSE</span><h3>禁止滥用</h3><p>不得伪造硬件、重放签名、绕过计量、超售库存、窥探买家数据、植入后门或将临时凭据用于其他目的。</p></article>
          <article className={styles.card}><span className={styles.cardCode}>INCIDENT</span><h3>安全事件</h3><p>发现凭据泄露、未授权访问、恶意负载或设备被控制时，应立即下线资源并通知平台协同处置。</p></article>
        </div>
      </section>

      <section className={styles.section}>
        <SectionHeader index="06 / DISPUTE" title="暂停、终止与争议" />
        <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>情形</th><th>平台动作</th><th>恢复条件</th></tr></thead><tbody>
          <tr><td>心跳、验真或端口失效</td><td>暂停报价和新订单</td><td>重新上线并完成验真</td></tr>
          <tr><td>开通、连接或计量失败</td><td>取消、退款或进入争议</td><td>完成根因分析和真实订单复演</td></tr>
          <tr><td>清理证据不完整</td><td>设备保持隔离并暂停收益处理</td><td>完成容器、密钥和工作目录清理</td></tr>
          <tr><td>权属、安全或合规风险</td><td>暂停供应主体、保全审计记录</td><td>人工复核通过或终止合作</td></tr>
        </tbody></table></div>
      </section>

      <aside className={styles.notice}>
        <div><h2>版本确认</h2><p>提交供应商审核即表示供应主体已阅读并同意版本 {version}。正式商用前，如双方另行签署书面合同，以书面合同约定的优先顺序处理冲突。</p></div>
        <div className={styles.actions}><Link className={styles.actionPrimary} href="/login?returnTo=%2Fsupply%2Fonboarding">进入供应商审核</Link><Link className={styles.actionSecondary} href="/hosting/partners">返回合作说明</Link></div>
      </aside>
    </HostingPublicShell>
  );
}
