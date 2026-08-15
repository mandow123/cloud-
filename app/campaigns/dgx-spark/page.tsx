import type { Metadata } from "next";
import Link from "next/link";
import { AccountRequired } from "@/components/account-required";
import { formatCardHourDisplayMicros } from "@/lib/card-hours";
import { getDgxSparkCampaignConfig } from "@/lib/server/dgx-spark-campaign";
import styles from "./campaign.module.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "02672 白鸽在线特供 · DGX Spark",
  description: "KAI Cloud DGX Spark 活动信息、核验状态与登记入口。",
};

const interestPath = "/request?mode=service&category=gpu&unit=卡时&title=02672%20DGX%20Spark%20活动兴趣登记";

export default function DgxSparkCampaignPage() {
  const campaign = getDgxSparkCampaignConfig();
  const verified = Boolean(campaign.status === "VERIFIED" && campaign.verifiedTerms && campaign.priceCardHoursMicros && campaign.purchasePath);

  return (
    <div className={styles.page}>
      <section className={styles.hero} aria-labelledby="dgx-spark-title">
        <div className="shell">
          <div className={styles.statusLine}>
            <span>02672</span>
            <strong>{verified ? "平台已核验" : campaign.status === "ENDED" ? "活动已结束" : "资料核验中"}</strong>
          </div>
          <h1 id="dgx-spark-title">白鸽在线特供<br /><em>DGX Spark</em></h1>
          <p className={styles.lead}>面向本地 AI 开发与推理工作流的紧凑型 AI 系统。活动信息与供应商审核相互独立，只有两者均通过平台服务端核验后才开放真实购买入口。</p>

          {verified ? (
            <div className={styles.verifiedOffer} aria-label="已核验活动条件">
              <div><span>活动配额</span><strong>{campaign.verifiedTerms!.totalUnits} 台</strong></div>
              <div><span>活动折扣</span><strong>{campaign.verifiedTerms!.discountPercent / 10} 折</strong></div>
              <div><span>开放节奏</span><strong>{campaign.verifiedTerms!.countdownSeconds} 秒开抢</strong></div>
              <div><span>预计发货</span><strong>{campaign.verifiedTerms!.estimatedShippingMonths} 个月</strong></div>
              <div className={styles.price}><span>活动价</span><strong>{formatCardHourDisplayMicros(campaign.priceCardHoursMicros!)} KAI 卡时</strong></div>
            </div>
          ) : (
            <div className={styles.pending} role="status">
              <strong>当前不展示库存、折扣、价格、开抢时间或发货承诺</strong>
              <span>服务端状态默认为 PENDING；在活动条款、真实商品入口和供应商审核全部完成前，只接受兴趣登记。</span>
            </div>
          )}

          <div className={styles.supplierReview}>
            <span>供应商平台审核</span>
            <strong>{campaign.supplierReviewStatus === "APPROVED" ? "已通过" : "待完成"}</strong>
            <small>此标记仅代表 KAI Cloud 平台审核状态，不代表 NVIDIA 官方授权或背书。</small>
          </div>

          {verified ? (
            <AccountRequired purpose="预约购买 DGX Spark">
              <Link className={styles.primaryAction} href={campaign.purchasePath!}>进入真实商品页</Link>
            </AccountRequired>
          ) : campaign.status === "PENDING" && campaign.interestRegistrationEnabled ? (
            <AccountRequired purpose="登记 DGX Spark 活动兴趣">
              <Link className={styles.primaryAction} href={interestPath}>登记兴趣</Link>
              <p className={styles.actionNote}>提交的是采购兴趣，不会创建报价、锁定库存或生成订单。</p>
            </AccountRequired>
          ) : (
            <p className={styles.closed}>活动当前未开放登记或购买。</p>
          )}
        </div>
      </section>

      <section className={styles.specs} aria-labelledby="dgx-spark-specs">
        <div className="shell">
          <header><p>VERIFIED PRODUCT FACTS</p><h2 id="dgx-spark-specs">已核对的产品规格</h2></header>
          <dl>
            <div><dt>平台</dt><dd>NVIDIA Grace Blackwell</dd></div>
            <div><dt>统一内存</dt><dd>128GB</dd></div>
            <div><dt>本地存储</dt><dd>4TB NVMe</dd></div>
            <div><dt>AI 性能</dt><dd>最高 1 PFLOP FP4</dd></div>
            <div><dt>网络</dt><dd>10GbE / ConnectX-7</dd></div>
          </dl>
          <p className={styles.source}>规格来源：<a href="https://www.nvidia.com/en-us/products/workstations/dgx-spark/" rel="noreferrer" target="_blank">NVIDIA DGX Spark 产品页 ↗</a></p>
        </div>
      </section>
    </div>
  );
}
