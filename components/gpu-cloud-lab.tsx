"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { ExchangeOrder, MarketListing, ProductVersion } from "@/lib/exchange";
import { formatCardHourValue } from "@/lib/card-hours";
import styles from "./gpu-cloud-lab.module.css";

type LabSnapshot = {
  environment: "LOCAL_TEST";
  fundsMoved: false;
  kaiReferenceRate: number;
  virtualNow: string;
  products: ProductVersion[];
  listings: MarketListing[];
  orders: ExchangeOrder[];
};

type LabProof = Record<string, string | undefined>;
type LabResponse = { snapshot?: LabSnapshot; order?: ExchangeOrder; proof?: LabProof; error?: { message?: string } };

const API = "/api/v1/lab/gpu-loop";

function commandId(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function kaiPrice(listing: MarketListing, rate: number) {
  return listing.unitPriceMicros / 1_000_000 / rate;
}

function kaiAmount(order: ExchangeOrder, rate: number) {
  return order.totalAmountCents / 100 / rate;
}

function shortId(value?: string | null) {
  if (!value) return "—";
  return value.length > 20 ? `${value.slice(0, 12)}…${value.slice(-6)}` : value;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

async function requestLab(payload?: unknown): Promise<LabResponse> {
  const response = await fetch(API, payload ? {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  } : { cache: "no-store" });
  const body = await response.json() as LabResponse;
  if (!response.ok) throw new Error(body.error?.message ?? "本地闭环请求失败。");
  return body;
}

function StatusDot({ done, active }: { done: boolean; active?: boolean }) {
  return <span aria-hidden="true" className={`${styles.statusDot} ${done ? styles.statusDone : ""} ${active ? styles.statusActive : ""}`} />;
}

function OrderLoop({
  order,
  rate,
  busy,
  onAction,
}: {
  order: ExchangeOrder;
  rate: number;
  busy: string | null;
  onAction: (action: "start" | "complete" | "accept" | "settle") => Promise<void>;
}) {
  const deliveryReady = order.delivery?.package?.status === "CLAIMED"
    && order.delivery.package.latestConnectionCheck?.status === "PASSED";
  const serviceStarted = order.metering?.status === "ACTIVE" || order.metering?.status === "FINAL";
  const meteringFinal = order.metering?.status === "FINAL";
  const accepted = order.acceptance?.status === "ACCEPTED";
  const settled = order.settlement?.status === "TEST_RECORDED";
  const nextAction = !serviceStarted ? "start" : !meteringFinal ? "complete" : !accepted ? "accept" : !settled ? "settle" : null;
  const labels = {
    start: "进入服务时间窗并开机",
    complete: "结束服务并生成计量",
    accept: "确认交付与计量",
    settle: "记录测试结算",
  } as const;

  return (
    <aside className={styles.orderPanel} aria-label="订单闭环进度">
      <div className={styles.orderPanelHead}>
        <div>
          <p className={styles.eyebrow}>LIVE CONTRACT · LOCAL TEST</p>
          <h2>租用闭环</h2>
        </div>
        <span className={styles.testBadge}>资金未移动</span>
      </div>
      <div className={styles.orderPrice}>
        <strong>{formatCardHourValue(kaiAmount(order, rate))}</strong>
        <span>KAI 标准卡时</span>
      </div>
      <p className={styles.mutedLine}>订单 {shortId(order.id)} · {order.rateUnits} GPU · {order.durationSeconds / 3600} 小时</p>
      <ol className={styles.loopSteps}>
        <li><StatusDot done /><span><strong>容量锁定与卡时预授权</strong><small>供应商确认，TEST 支付事件已捕获</small></span></li>
        <li><StatusDot done={Boolean(deliveryReady)} active={!deliveryReady} /><span><strong>交付包与连接检查</strong><small>{deliveryReady ? "脱敏 SSH 端点已领取并通过测试" : "等待交付"}</small></span></li>
        <li><StatusDot done={serviceStarted} active={nextAction === "start"} /><span><strong>实例启动</strong><small>{serviceStarted ? `服务于 ${formatDate(order.metering?.actualStartAt ?? order.startAt)} 启动` : "进入固定服务时间窗后启动"}</small></span></li>
        <li><StatusDot done={meteringFinal} active={nextAction === "complete"} /><span><strong>计量完成</strong><small>{meteringFinal ? "GPU 秒级容量证据已汇总" : "按实际服务窗生成计量"}</small></span></li>
        <li><StatusDot done={accepted} active={nextAction === "accept"} /><span><strong>用户验收</strong><small>{accepted ? "连接、服务窗与计量已确认" : "买方核对交付结果"}</small></span></li>
        <li><StatusDot done={settled} active={nextAction === "settle"} /><span><strong>测试结算</strong><small>{settled ? "闭环完成；资金移动 = false" : "生成供应商应收测试台账"}</small></span></li>
      </ol>
      {nextAction ? (
        <button className={styles.primaryButton} disabled={Boolean(busy)} onClick={() => onAction(nextAction)}>
          {busy === nextAction ? "正在写入状态…" : labels[nextAction]}
        </button>
      ) : (
        <div className={styles.successPanel}>
          <strong>闭环已完成</strong>
          <span>上架、租用、交付、计量、验收和 TEST 结算均有持久化记录。</span>
        </div>
      )}
      <details className={styles.evidence}>
        <summary>查看后台凭证</summary>
        <dl>
          <div><dt>Payment</dt><dd>{shortId(order.payment?.id)}</dd></div>
          <div><dt>Delivery</dt><dd>{shortId(order.delivery?.package?.id)}</dd></div>
          <div><dt>Metering</dt><dd>{shortId(order.metering?.id)}</dd></div>
          <div><dt>Settlement</dt><dd>{shortId(order.settlement?.id)}</dd></div>
        </dl>
      </details>
    </aside>
  );
}

export function GpuMarketplaceLab() {
  const [snapshot, setSnapshot] = useState<LabSnapshot | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState("ALL");
  const [durationHours, setDurationHours] = useState(1);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState("正在装载本地算力市场…");
  const [order, setOrder] = useState<ExchangeOrder | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        let body = await requestLab();
        if (!body.snapshot?.listings.length) body = await requestLab({ action: "seed" });
        if (cancelled || !body.snapshot) return;
        setSnapshot(body.snapshot);
        setSelectedId(body.snapshot.listings[0]?.id ?? null);
        setOrder(body.snapshot.orders[0] ?? null);
        setNotice("本地 TEST 市场已就绪");
      } catch (error) {
        if (!cancelled) setNotice(error instanceof Error ? error.message : "本地闭环不可用。");
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const filtered = useMemo(() => snapshot?.listings.filter((listing) => (
    selectedModel === "ALL" || listing.product.model === selectedModel
  )) ?? [], [selectedModel, snapshot]);
  const selected = snapshot?.listings.find((listing) => listing.id === selectedId) ?? filtered[0] ?? null;
  const models = [...new Set(snapshot?.listings.map((listing) => listing.product.model) ?? [])];

  async function rent(listing: MarketListing) {
    setBusy("checkout");
    setNotice("正在锁定容量并准备测试交付…");
    try {
      const body = await requestLab({
        action: "checkout",
        input: {
          commandId: commandId("rent"),
          listingVersionId: listing.id,
          durationHours,
        },
      });
      if (body.snapshot) setSnapshot(body.snapshot);
      if (body.order) setOrder(body.order);
      setNotice("容量、测试卡时预授权、交付包和连接检查已完成");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "租用失败。");
    } finally {
      setBusy(null);
    }
  }

  async function orderAction(action: "start" | "complete" | "accept" | "settle") {
    if (!order) return;
    setBusy(action);
    try {
      const body = await requestLab({ action, orderId: order.id });
      if (body.snapshot) setSnapshot(body.snapshot);
      if (body.order) setOrder(body.order);
      setNotice(action === "settle" ? "完整 TEST 闭环已经写入本地数据库" : "订单已进入下一阶段");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "状态推进失败。");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className={styles.marketApp}>
      <section className={styles.marketIntro}>
        <div>
          <p className={styles.eyebrow}>GPU CLOUD MARKETPLACE</p>
          <h1>找到合适的 GPU，直接开始工作。</h1>
          <p>按型号、显存、区域、可靠性和 KAI 标准卡时价格比较真实上架记录；本页为本地 TEST 闭环，所有订单状态会持久化，资金不会移动。</p>
        </div>
        <div className={styles.marketIntroActions}>
          <Link href="/guides#rent-gpu">先看 5 分钟教程</Link>
          <Link className={styles.primaryButton} href="/hosting">我有 GPU 要上架</Link>
        </div>
      </section>

      <div className={styles.labNotice} role="status">
        <span><span className={styles.pulse} aria-hidden="true" />{notice}</span>
        <span>固定参考：1 KAI 标准卡时 = ¥{snapshot?.kaiReferenceRate.toFixed(3) ?? "1.002"}</span>
      </div>

      <div className={styles.marketLayout}>
        <aside className={styles.filterRail} aria-label="算力筛选">
          <div className={styles.templateCard}>
            <div className={styles.templateIcon}>PT</div>
            <div><strong>PyTorch · CUDA</strong><span>SSH + Jupyter 模板</span></div>
            <button type="button" aria-label="更换模板">更换</button>
          </div>
          <label>
            <span>GPU 型号</span>
            <select value={selectedModel} onChange={(event) => setSelectedModel(event.target.value)}>
              <option value="ALL">全部型号</option>
              {models.map((model) => <option key={model}>{model}</option>)}
            </select>
          </label>
          <fieldset>
            <legend>资源等级</legend>
            <label><input type="checkbox" defaultChecked /> KAI Verified</label>
            <label><input type="checkbox" defaultChecked /> 个人与社区</label>
            <label><input type="checkbox" defaultChecked /> 数据中心</label>
          </fieldset>
          <fieldset>
            <legend>连接方式</legend>
            <label><input type="checkbox" defaultChecked /> SSH</label>
            <label><input type="checkbox" defaultChecked /> Jupyter</label>
          </fieldset>
          <Link className={styles.guideLink} href="/guides#choosing-offer">如何比较资源 →</Link>
        </aside>

        <section className={styles.offers} aria-label="GPU 上架列表">
          <div className={styles.offerToolbar}>
            <div>
              <strong>{filtered.length}</strong> 个可租用资源
              <span>本地持久化市场</span>
            </div>
            <div className={styles.quickFilters} aria-label="快捷筛选">
              <button type="button" className={styles.quickActive}>按需</button>
              <button type="button">低价优先</button>
              <button type="button">可靠性优先</button>
            </div>
          </div>
          {filtered.map((listing) => {
            const memory = String(listing.product.specs.memoryGiB ?? "—");
            const selectedRow = selected?.id === listing.id;
            return (
              <article className={`${styles.offerRow} ${selectedRow ? styles.offerSelected : ""}`} key={listing.id} onClick={() => setSelectedId(listing.id)}>
                <div className={styles.vendorMark} aria-hidden="true">{listing.resource.title.slice(0, 1).toUpperCase()}</div>
                <div className={styles.offerIdentity}>
                  <div><span className={styles.verifiedBadge}>✓ Verified</span><small>{shortId(listing.id)}</small></div>
                  <h2>{listing.maxRateUnits}× {listing.product.model}</h2>
                  <p>{listing.resource.title}</p>
                </div>
                <dl className={styles.specGrid}>
                  <div><dt>显存</dt><dd>{memory} GB</dd></div>
                  <div><dt>架构</dt><dd>{String(listing.product.specs.architecture ?? listing.product.formFactor)}</dd></div>
                  <div><dt>区域</dt><dd>{listing.resource.region}</dd></div>
                  <div><dt>可用窗</dt><dd>{formatDate(listing.lot.startAt)} 起</dd></div>
                  <div><dt>可靠性</dt><dd>{listing.sla.availabilityPercent}%</dd></div>
                  <div><dt>交付</dt><dd>{listing.deliveryForm}</dd></div>
                </dl>
                <div className={styles.offerPrice}>
                  <span>每 GPU / 小时</span>
                  <strong>{formatCardHourValue(kaiPrice(listing, snapshot?.kaiReferenceRate ?? 1.002))}</strong>
                  <small>KAI 标准卡时</small>
                  <button disabled={Boolean(busy)} onClick={(event) => { event.stopPropagation(); void rent(listing); }}>
                    {busy === "checkout" && selectedRow ? "锁定中…" : "租用"}
                  </button>
                </div>
              </article>
            );
          })}
          {!filtered.length ? <div className={styles.emptyState}>没有符合筛选条件的资源。</div> : null}
        </section>

        <aside className={styles.rentSummary} aria-label="租用配置">
          {order ? <OrderLoop order={order} rate={snapshot?.kaiReferenceRate ?? 1.002} busy={busy} onAction={orderAction} /> : (
            <div className={styles.configCard}>
              <p className={styles.eyebrow}>RENT CONFIGURATION</p>
              <h2>启动配置</h2>
              {selected ? (
                <>
                  <p className={styles.selectedGpu}>{selected.product.model}</p>
                  <label><span>租用时长</span><select value={durationHours} onChange={(event) => setDurationHours(Number(event.target.value))}><option value={1}>1 小时</option><option value={2}>2 小时</option><option value={4}>4 小时</option><option value={8}>8 小时</option></select></label>
                  <dl className={styles.quoteList}>
                    <div><dt>GPU 数量</dt><dd>1</dd></div>
                    <div><dt>模板</dt><dd>PyTorch + CUDA</dd></div>
                    <div><dt>预计支付</dt><dd>{formatCardHourValue(kaiPrice(selected, snapshot?.kaiReferenceRate ?? 1.002) * durationHours)} 卡时</dd></div>
                  </dl>
                  <button className={styles.primaryButton} disabled={Boolean(busy)} onClick={() => rent(selected)}>创建 TEST 租约</button>
                  <small>仅本地测试，不触发人民币、支付宝或真实卡时扣减。</small>
                </>
              ) : <p>正在选择资源…</p>}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

export function GpuHostingLab() {
  const [snapshot, setSnapshot] = useState<LabSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("正在连接本地验真与上架服务…");
  const [proof, setProof] = useState<LabProof | null>(null);
  const [form, setForm] = useState({
    supplierName: "我的 4090 主机",
    productVersionId: "PV-GPU-RTX4090-PCIE-24GB",
    gpuCount: 1,
    region: "上海",
    sourceType: "PERSONAL" as "PERSONAL" | "CLOUD" | "DATACENTER",
    priceKaiPerGpuHour: 0.88,
  });

  useEffect(() => {
    void requestLab().then((body) => {
      if (body.snapshot) setSnapshot(body.snapshot);
      setNotice("本地上架通道已就绪");
    }).catch((error) => setNotice(error instanceof Error ? error.message : "本地上架通道不可用。"));
  }, []);

  async function publish(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setNotice("正在登记资源、验真、切分容量并生成不可变上架版本…");
    try {
      const body = await requestLab({ action: "publish", input: { ...form, commandId: commandId("publish") } });
      if (body.snapshot) setSnapshot(body.snapshot);
      setProof(body.proof ?? null);
      setNotice("上架闭环已完成，这条资源现在可以在 GPU 市场被租用");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "上架失败。");
    } finally {
      setBusy(false);
    }
  }

  const products = snapshot?.products ?? [];
  return (
    <div className={styles.hostingApp}>
      <section className={styles.hostingHero}>
        <div>
          <p className={styles.eyebrow}>HOST COMPUTE · EARN KAI HOURS</p>
          <h1>把一张闲置 GPU，变成可验收的算力服务。</h1>
          <p>个人主机、云服务器和数据中心使用同一条标准上架链路：登记硬件、完成验真、声明可用时间、发布卡时价格、交付实例、接受计量与验收。</p>
          <div className={styles.heroPills}><span>个人 4090</span><span>云 GPU</span><span>数据中心集群</span><span>TEST 可回退</span></div>
        </div>
        <div className={styles.hostingHeroPanel}>
          <span>你的资源</span><strong>GPU × N</strong><i aria-hidden="true">→</i><span>统一计量</span><strong>KAI 标准卡时</strong>
        </div>
      </section>

      <div className={styles.labNotice} role="status"><span><span className={styles.pulse} aria-hidden="true" />{notice}</span><span>LOCAL TEST · 资金移动 = false</span></div>

      <section className={styles.hostingFlow} aria-label="上架流程">
        {["登记资源", "平台验真", "容量上架", "接单交付"].map((label, index) => <div key={label}><b>{String(index + 1).padStart(2, "0")}</b><span>{label}</span></div>)}
      </section>

      <div className={styles.hostingGrid} id="personal-gpu">
        <form className={styles.hostingForm} onSubmit={publish}>
          <div className={styles.formHead}><div><p className={styles.eyebrow}>LIST A MACHINE</p><h2>上架一台 GPU 主机</h2></div><span className={styles.testBadge}>本地测试</span></div>
          <div className={styles.formGrid}>
            <label><span>资源名称</span><input value={form.supplierName} onChange={(event) => setForm({ ...form, supplierName: event.target.value })} required /></label>
            <label><span>资源来源</span><select value={form.sourceType} onChange={(event) => setForm({ ...form, sourceType: event.target.value as typeof form.sourceType })}><option value="PERSONAL">个人本地主机</option><option value="CLOUD">云服务器</option><option value="DATACENTER">数据中心</option></select></label>
            <label className={styles.wideField}><span>GPU 型号</span><select value={form.productVersionId} onChange={(event) => setForm({ ...form, productVersionId: event.target.value })}>{products.map((product) => <option value={product.id} key={product.id}>{product.displayName}</option>)}</select></label>
            <label><span>GPU 数量</span><input type="number" min={1} max={64} value={form.gpuCount} onChange={(event) => setForm({ ...form, gpuCount: Number(event.target.value) })} /></label>
            <label><span>所在区域</span><input value={form.region} onChange={(event) => setForm({ ...form, region: event.target.value })} required /></label>
            <label className={styles.wideField}><span>每 GPU / 小时价格</span><div className={styles.priceInput}><input type="number" min="0.01" step="0.01" value={form.priceKaiPerGpuHour} onChange={(event) => setForm({ ...form, priceKaiPerGpuHour: Number(event.target.value) })} /><b>KAI 标准卡时</b></div><small>固定参考 1 KAI 标准卡时 = ¥1.002；本地页面不发生真实支付。</small></label>
          </div>
          <label className={styles.attestation}><input type="checkbox" required /><span>我确认有权提供此资源，并允许平台进行硬件、网络、稳定性与交付测试。</span></label>
          <button className={styles.primaryButton} disabled={busy || !products.length}>{busy ? "正在完成四步上架…" : "验真并发布到 GPU 市场"}</button>
        </form>

        <aside className={styles.proofPanel}>
          <p className={styles.eyebrow}>PERSISTED PROOF</p>
          <h2>{proof ? "上架凭证已生成" : "每一步都留下凭证"}</h2>
          <p>不是公开供应商名录，也不是一个“提交后等待”的空表单。上架成功后会生成可被真实下单状态机消费的资源、验真、容量批次和不可变挂牌版本。</p>
          <dl>
            <div><dt>Resource Asset</dt><dd>{shortId(proof?.resourceAssetId)}</dd></div>
            <div><dt>Verification</dt><dd>{shortId(proof?.verificationRunId)}</dd></div>
            <div><dt>Capacity Lot</dt><dd>{shortId(proof?.capacityLotId)}</dd></div>
            <div><dt>Listing Version</dt><dd>{shortId(proof?.listingVersionId)}</dd></div>
          </dl>
          {proof ? <Link className={styles.primaryButton} href="/gpu">去市场租用这条资源</Link> : <Link className={styles.guideLink} href="/guides/host-agent">先看个人 4090 教程 →</Link>}
        </aside>
      </div>

      <section className={styles.hostingPaths} id="cloud-provider">
        <article><span>01</span><h2>个人主机</h2><p>从一张 4090 开始。Connector 核对型号、显存、可用端口和稳定性，再允许进入市场。</p><a href="#personal-gpu">按个人资源填写 ↑</a></article>
        <article><span>02</span><h2>云资源接入</h2><p>使用云 API 或平台连接器同步实例身份和可用时间，仍然按同一交付、计量和验收规则执行。</p><a href="#personal-gpu">切换为云服务器 ↑</a></article>
        <article><span>03</span><h2>数据中心集群</h2><p>声明批量容量、网络与 SLA；买方只看到被验真、可锁定、可交付的具体资源版本。</p><Link href="/partners">查看企业合作</Link></article>
      </section>

      <section className={styles.earningsSection} id="earnings">
        <div><p className={styles.eyebrow}>EARNINGS</p><h2>收入来自已完成的服务，不来自“挂上去”。</h2></div>
        <div className={styles.earningsFormula}><span>成交卡时</span><i>−</i><span>未交付抵扣</span><i>−</i><span>争议抵扣</span><i>=</i><strong>可结算卡时</strong></div>
        <p>当前页面只记录 TEST 结算事实；真实卡时余额、变现与人民币支付在正式支付系统接入前保持关闭。</p>
      </section>
    </div>
  );
}
