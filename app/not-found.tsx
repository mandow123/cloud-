import Link from "next/link";

export default function NotFound() {
  return (
    <section className="narrow-shell py-24 lg:py-32">
      <p className="kicker">404 / Resource Not Found</p>
      <h1 className="text-4xl leading-tight sm:text-5xl">没有找到这项资源</h1>
      <p className="mt-5 max-w-2xl text-lg">资源可能已被筛选条件隐藏，或当前链接不在已发布数据集中。</p>
      <div className="mt-9 flex flex-wrap gap-3">
        <Link className="button button-primary" href="/resources">返回资源市场</Link>
        <Link className="button button-secondary" href="/">返回首页</Link>
      </div>
    </section>
  );
}
