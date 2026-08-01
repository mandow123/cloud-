import Link from "next/link";

export function SiteFooter() {
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
          <Link href="/partners">供应商合作</Link>
          <Link href="/member">演示会员中心</Link>
        </div>
        <div className="footer-disclaimer">
          <p className="footer-label">演示声明</p>
          <p>本站资源、供应商与价格均为演示数据，不构成实时成交报价或投资、采购建议。</p>
          <p>数据日期：2026-08-01 · 中国标准时间</p>
        </div>
      </div>
      <div className="shell footer-bottom">
        <span>© 2026 KAI Cloud</span>
        <span>让异构算力拥有可比较的市场语言</span>
      </div>
    </footer>
  );
}
