import Link from "next/link";
import { marketSeries } from "@/lib/data";
import { isHostingV2Enabled } from "@/lib/server/hosting-v2-feature";
import { readMarketSnapshot } from "@/lib/server/market-snapshot";

function dateLabel(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "待确认"
    : new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

export async function SiteFooter() {
  const { snapshot } = await readMarketSnapshot();
  const hostingV2 = isHostingV2Enabled();
  const infrastructureUpdatedAt = marketSeries.reduce(
    (latest, series) => series.updatedAt > latest ? series.updatedAt : latest,
    "",
  );
  return (
    <footer className="site-footer">
      <div className="shell footer-grid">
        <div>
          <p className="footer-brand">KAI Cloud</p>
          <p className="footer-copy">中国 Token 学院算力市场</p>
        </div>
        <div>
          <p className="footer-label">市场服务</p>
          <Link href="/market">行情中心</Link>
          <Link href="/resources">资源市场</Link>
          <Link href="/request">租赁与置换</Link>
        </div>
        <div>
          <p className="footer-label">平台说明</p>
          <Link href="/methodology">数据方法</Link>
          <Link href={hostingV2 ? "/hosting/partners" : "/partners"}>供应商合作</Link>
          <Link href="/member">会员工作台</Link>
        </div>
        <div className="footer-disclaimer">
          <p className="footer-label">报价说明</p>
          <p>本站展示市场参考报价，具体价格、库存与交付条件以询价确认为准，不构成要约或投资、采购建议。</p>
          <p>模型目录价发布：{dateLabel(snapshot.publishedAt)} · 基础设施初始化样本截至：{dateLabel(infrastructureUpdatedAt)}</p>
        </div>
      </div>
      <div className="shell footer-bottom">
        <span>© 2026 KAI Cloud</span>
        <span>让异构算力拥有可比较的市场语言</span>
      </div>
    </footer>
  );
}
