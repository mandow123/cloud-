"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type NavItem = {
  href: string;
  label: string;
  description: string;
  external?: boolean;
};

type NavGroup = {
  label: string;
  paths: string[];
  items: NavItem[];
};

const groups: NavGroup[] = [
  {
    label: "算力云",
    paths: ["/gpu", "/resources", "/market"],
    items: [
      { href: "/gpu", label: "GPU 租赁", description: "筛选、比较并启动 GPU 实例" },
      { href: "/resources", label: "全部资源", description: "浏览 GPU、模型与基础设施资源" },
      { href: "/market", label: "市场行情", description: "查看 KAI 标准卡时与市场快照" },
    ],
  },
  {
    label: "Hosting",
    paths: ["/hosting", "/partners"],
    items: [
      { href: "/hosting", label: "开始上架", description: "登记、验真并发布你的算力" },
      { href: "/hosting#personal-gpu", label: "个人 GPU", description: "从一张 RTX 4090 开始出租" },
      { href: "/hosting#cloud-provider", label: "云资源接入", description: "接入云主机或数据中心库存" },
      { href: "/hosting#earnings", label: "收益与结算", description: "理解计量、验收与卡时收益" },
      { href: "/partners", label: "供应商合作", description: "企业供应商和服务边界说明" },
    ],
  },
  {
    label: "教程",
    paths: ["/guides", "/methodology"],
    items: [
      { href: "/guides", label: "教程首页", description: "从第一次租用到第一次上架" },
      { href: "/guides#rent-gpu", label: "租用 GPU", description: "模板、筛选、租用与连接" },
      { href: "/guides#list-4090", label: "上架 4090", description: "个人显卡完整上架步骤" },
      { href: "/guides#delivery", label: "交付与验收", description: "连接检查、计量和验收" },
      { href: "/methodology", label: "计价方法", description: "KAI 标准卡时与价格口径" },
    ],
  },
];

function isGroupActive(pathname: string, group: NavGroup) {
  return group.paths.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

export function NavLinks() {
  const pathname = usePathname();

  return (
    <nav aria-label="全局导航" className="primary-nav primary-nav-mega">
      {groups.map((group) => {
        const active = isGroupActive(pathname, group);
        return (
          <details className="nav-group" key={group.label}>
            <summary aria-current={active ? "page" : undefined}>
              <span>{group.label}</span>
              <span aria-hidden="true" className="nav-chevron">⌄</span>
            </summary>
            <div className="nav-popover">
              <p className="nav-popover-label">{group.label}</p>
              <div className="nav-popover-links">
                {group.items.map((item) => (
                  <Link
                    href={item.href}
                    key={item.href}
                    target={item.external ? "_blank" : undefined}
                    rel={item.external ? "noreferrer" : undefined}
                  >
                    <strong>{item.label}</strong>
                    <span>{item.description}</span>
                  </Link>
                ))}
              </div>
            </div>
          </details>
        );
      })}
      <a className="nav-company-link" href="https://kai.com" target="_blank" rel="noreferrer">
        Company <span aria-hidden="true">↗</span>
      </a>
    </nav>
  );
}
