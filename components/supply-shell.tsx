"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

const supplyNavigation = [
  { href: "/supply", label: "上架概览", exact: true },
  { href: "/supply/new", label: "通用资源上架" },
  { href: "/supply/h100/new", label: "H100 试运行" },
  { href: "/supply/mac/import", label: "Mac 批量入库" },
  { href: "/supply/assets", label: "资源资产" },
  { href: "/supply/listings", label: "上架计划" },
];

export function SupplyShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="min-h-[70vh] bg-[var(--canvas)]">
      <header className="border-b border-[var(--border)] bg-[var(--info-bg)]">
        <div className="shell py-10 sm:py-14">
          <div className="flex flex-wrap items-end justify-between gap-6">
            <div>
              <p className="kicker">Supply center</p>
              <h1 className="m-0 text-4xl leading-tight sm:text-5xl">算力上架中心</h1>
              <p className="section-lead max-w-3xl">通用资源先登记供给，再按类型核验和审核；未通过安全门的容量不会进入交易。</p>
            </div>
            <span className="border border-[var(--border-strong)] bg-[var(--surface)] px-4 py-3 text-sm font-semibold text-[var(--ink)]">
              第一阶段 · 限量试运行
            </span>
          </div>
          <nav aria-label="算力上架中心" className="mt-8 flex gap-2 overflow-x-auto border-b border-[var(--border)] pb-3">
            {supplyNavigation.map((item) => {
              const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
              return (
                <Link
                  aria-current={active ? "page" : undefined}
                  className={`min-h-11 shrink-0 border px-4 py-2.5 text-sm font-semibold ${active ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--ink)]" : "border-[var(--border)] bg-[var(--surface)] text-[var(--text)]"}`}
                  href={item.href}
                  key={item.href}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>
      </header>

      <div className="shell pt-6">
        <div className="grid gap-3 lg:grid-cols-2" aria-label="试运行安全状态">
          <div className="border-l-4 border-[var(--warning)] bg-[var(--warning-bg)] p-4 text-sm text-[var(--text)]">
            <strong className="block text-[var(--ink)]">支付宝 LIVE 尚未就绪</strong>
            当前页面不会调用测试支付冒充真实成交；没有生产商户配置、签名回调与查单能力时，订单支付保持阻断。
          </div>
          <div className="border-l-4 border-[var(--accent)] bg-[var(--info-bg)] p-4 text-sm text-[var(--text)]">
            <strong className="block text-[var(--ink)]">验真是发布前置条件</strong>
            通用资源按类型核验；KAI 自有 H100 预设需验证 8 卡同节点，Mac 预设第一阶段只允许入库、检测与分组。
          </div>
        </div>
      </div>

      {children}
    </div>
  );
}
