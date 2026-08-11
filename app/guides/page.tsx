import type { Metadata } from "next";
import Link from "next/link";
import styles from "./guides.module.css";

export const metadata: Metadata = {
  title: "使用教程",
  description: "KAI Cloud GPU 租用、个人 4090 上架、交付、计量和卡时结算教程。",
};

const chapters = [
  { href: "#start", label: "开始使用" },
  { href: "#rent-gpu", label: "租用第一台 GPU" },
  { href: "#choosing-offer", label: "如何比较资源" },
  { href: "#list-4090", label: "上架一张 4090" },
  { href: "#cloud-host", label: "接入云 GPU" },
  { href: "#delivery", label: "交付与连接" },
  { href: "#metering", label: "计量与验收" },
  { href: "#card-hours", label: "卡时与结算" },
];

function Step({ number, title, children }: { number: string; title: string; children: React.ReactNode }) {
  return <li><span>{number}</span><div><h3>{title}</h3><p>{children}</p></div></li>;
}

export default function GuidesPage() {
  return (
    <div className={styles.docsPage}>
      <div className={styles.docsTopbar}>
        <div><span>KAI Cloud Docs</span><b>教程与操作手册</b></div>
        <div><Link href="/gpu">进入 GPU 市场</Link><Link href="/hosting">上架算力</Link></div>
      </div>
      <div className={styles.docsLayout}>
        <aside className={styles.sidebar}>
          <p>GETTING STARTED</p>
          <nav aria-label="教程章节">
            {chapters.map((chapter) => <a href={chapter.href} key={chapter.href}>{chapter.label}</a>)}
          </nav>
          <div className={styles.sidebarCard}>
            <strong>本地闭环说明</strong>
            <span>当前预览使用真实本地数据库和 TEST 状态机，不移动真实资金。</span>
          </div>
        </aside>

        <article className={styles.article}>
          <header id="start" className={styles.articleHero}>
            <p>开始使用</p>
            <h1>从一张 GPU，到一次完整服务。</h1>
            <p>KAI Cloud 同时服务两类人：需要算力的人，以及拥有算力的人。下面每条教程都对应网站中的真实操作入口。</p>
            <div className={styles.choiceGrid}>
              <Link href="/gpu"><span>我是使用者</span><strong>5 分钟租用第一台 GPU</strong><small>选择模板 → 比较资源 → 租用 → 连接</small></Link>
              <Link href="/hosting"><span>我是供应方</span><strong>把 GPU 上架并获得卡时</strong><small>登记 → 验真 → 上架 → 交付 → 结算</small></Link>
            </div>
          </header>

          <section id="rent-gpu">
            <div className={styles.sectionLabel}>01 · RENTER</div>
            <h2>租用第一台 GPU</h2>
            <p className={styles.lead}>先选软件环境，再找机器。模板决定实例启动后有什么，资源记录决定它跑在哪里、性能与价格是多少。</p>
            <ol className={styles.steps}>
              <Step number="1" title="选择模板">进入 GPU 市场，保留默认的 PyTorch + CUDA 模板，或按任务更换镜像与连接方式。</Step>
              <Step number="2" title="筛选资源">按 GPU 型号、显存、区域、资源等级和连接方式缩小范围。</Step>
              <Step number="3" title="查看卡时价格">资源卡主价格统一显示为 KAI 标准卡时 / GPU / 小时；人民币只作为固定换算参考。</Step>
              <Step number="4" title="创建租约">确认 GPU 数量、时长和预计卡时，创建 TEST 租约。平台会锁定容量并要求供应方确认。</Step>
              <Step number="5" title="领取并连接">交付包通过核验后，领取一次性连接信息，由平台先做连接检查，再进入服务时间窗。</Step>
            </ol>
            <Link className={styles.actionLink} href="/gpu">打开 GPU 市场开始操作 →</Link>
          </section>

          <section id="choosing-offer">
            <div className={styles.sectionLabel}>02 · MARKET</div>
            <h2>如何比较两条 GPU 资源</h2>
            <div className={styles.compareTable} role="table" aria-label="GPU 资源比较要点">
              <div role="row"><strong role="columnheader">指标</strong><strong role="columnheader">看什么</strong><strong role="columnheader">为什么重要</strong></div>
              <div role="row"><span>GPU 与显存</span><span>准确型号、显存、卡数</span><span>决定模型规模和并行方式</span></div>
              <div role="row"><span>资源等级</span><span>已验真、社区、数据中心</span><span>决定适合实验还是生产</span></div>
              <div role="row"><span>可靠性</span><span>可用率、响应时间、历史连接</span><span>长任务应优先看稳定性</span></div>
              <div role="row"><span>交付方式</span><span>SSH、Jupyter、容器或裸金属</span><span>决定启动和运维方法</span></div>
              <div role="row"><span>总卡时</span><span>单价 × GPU 数量 × 服务时长</span><span>不要只看每卡小时单价</span></div>
            </div>
            <div className={styles.note}><strong>提示</strong><p>硬件制造商与实际算力供应方是两个字段。页面不会用 NVIDIA、AMD 或云厂商 Logo 暗示其为卖家或合作方。</p></div>
          </section>

          <section id="list-4090">
            <div className={styles.sectionLabel}>03 · PERSONAL HOST</div>
            <h2>上架一张个人 RTX 4090</h2>
            <p className={styles.lead}>目标不是把名字放进供应商名录，而是让这张卡变成一条能被下单、交付、计量和验收的资源。</p>
            <ol className={styles.steps}>
              <Step number="1" title="准备主机">确认 Linux、NVIDIA 驱动、Docker、稳定公网、可用端口和散热条件。</Step>
              <Step number="2" title="登记身份">填写受控 GPU 型号、数量、区域和资源来源。4090 会记录为独立产品版本，不与 H100 混用。</Step>
              <Step number="3" title="完成验真">Connector 检查型号、24GB 显存、卡数、网络和连续时间窗；通过后生成验真凭证。</Step>
              <Step number="4" title="声明容量">选择未来可出租的时间窗、最大并行 GPU 数和是否允许中断。</Step>
              <Step number="5" title="发布价格">填写每 GPU / 小时的 KAI 标准卡时价格，系统生成不可变上架版本。</Step>
              <Step number="6" title="接单与交付">供应方确认订单，准备隔离实例和脱敏连接档案；连接测试通过后才能开始计量。</Step>
            </ol>
            <Link className={styles.actionLink} href="/hosting/personal-gpu">打开个人 GPU 上架说明 →</Link>
          </section>

          <section id="cloud-host">
            <div className={styles.sectionLabel}>04 · CLOUD & DATACENTER</div>
            <h2>接入云 GPU 或数据中心库存</h2>
            <p>云上资源与个人 GPU 不需要两套交易系统。差别只在验真方法和交付方式：云资源优先用 Cloud API 核验实例身份，数据中心可用 Connector 与人工审核组合；之后都进入相同的容量批次、上架、订单、交付和计量链路。</p>
            <div className={styles.flowDiagram} aria-label="云资源上架流程">
              <span>云账号 / 机房资源</span><i>→</i><span>API / Connector 验真</span><i>→</i><span>容量批次</span><i>→</i><span>GPU 市场</span>
            </div>
            <Link className={styles.actionLink} href="/hosting/cloud">查看资源连接器与接入状态 →</Link>
          </section>

          <section id="delivery">
            <div className={styles.sectionLabel}>05 · DELIVERY</div>
            <h2>交付与连接不是一句“已开通”</h2>
            <p>每笔订单都有独立交付任务。供应方只能提交脱敏端点、协议、端口、用户名提示、有效期和操作摘要；密码、私钥与 Token 不允许出现在公开档案中。平台审核通过后，买方领取一次性测试码并发起连接检查。</p>
            <div className={styles.stateLine}><span>PROVISIONING</span><i>→</i><span>PACKAGE VERIFIED</span><i>→</i><span>CLAIMED</span><i>→</i><strong>CONNECTION PASSED</strong></div>
          </section>

          <section id="metering">
            <div className={styles.sectionLabel}>06 · METERING</div>
            <h2>计量与验收</h2>
            <p>服务只能在固定订单时间窗内启动。实例启动后，计量会话从 SCHEDULED 进入 ACTIVE；时间窗结束后汇总可用与不可用 GPU 秒，形成 FINAL 计量记录。买方查看连接、服务窗与证据后选择验收或争议。</p>
            <div className={styles.codeLike}>
              <span>scheduled_gpu_seconds</span><b>=</b><span>GPU 数量 × 服务秒数</span>
              <span>available_gpu_seconds</span><b>+</b><span>unavailable_gpu_seconds</span>
              <span>acceptance</span><b>=</b><span>ACCEPTED / DISPUTED</span>
            </div>
          </section>

          <section id="card-hours">
            <div className={styles.sectionLabel}>07 · KAI STANDARD HOURS</div>
            <h2>卡时与测试结算</h2>
            <p>网站中的市场价格、订单预计支付和供应方应收都优先使用 KAI 标准卡时。固定参考为 1 KAI 标准卡时 = ¥1.002。当前本地闭环只记录 TEST 支付与测试结算，<strong>fundsMoved 永远为 false</strong>；真实充值、扣减与变现保持关闭。</p>
            <div className={styles.settlementCard}>
              <div><span>成交卡时</span><strong>Gross</strong></div>
              <div><span>未交付 / 争议抵扣</span><strong>Credits</strong></div>
              <div><span>供应方可结算</span><strong>Net payable</strong></div>
              <small>LOCAL TEST · 不代表真实余额或支付凭证</small>
            </div>
            <Link className={styles.actionLink} href="/gpu">在本地订单中走完结算 →</Link>
          </section>

          <footer className={styles.articleFooter}>
            <div><span>下一步</span><strong>选择一条路线并真正操作一次</strong></div>
            <div><Link href="/gpu">租用 GPU</Link><Link href="/hosting">上架 GPU</Link></div>
          </footer>
        </article>

        <aside className={styles.onThisPage}>
          <p>本页目录</p>
          {chapters.slice(1).map((chapter) => <a href={chapter.href} key={chapter.href}>{chapter.label}</a>)}
        </aside>
      </div>
    </div>
  );
}
