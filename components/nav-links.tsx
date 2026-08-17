"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

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

const commonGroups: NavGroup[] = [
  {
    label: "算力云",
    paths: ["/gpu", "/resources", "/market"],
    items: [
      { href: "/gpu", label: "GPU 租赁", description: "筛选、比较并启动 GPU 实例" },
      { href: "/resources", label: "参考目录", description: "浏览 GPU、模型与基础设施参考方案并提交询价" },
      { href: "/market", label: "市场行情", description: "查看 KAI 标准卡时与市场快照" },
    ],
  },
  {
    label: "教程",
    paths: ["/guides", "/methodology"],
    items: [
      { href: "/guides", label: "教程首页", description: "从第一次租用到第一次上架" },
      { href: "/guides#rent-gpu", label: "租用 GPU", description: "模板、筛选、租用与连接" },
      { href: "/guides/host-agent", label: "上架 4090", description: "个人显卡完整上架步骤" },
      { href: "/guides#delivery", label: "交付与验收", description: "连接检查、计量和验收" },
      { href: "/methodology", label: "计价方法", description: "KAI 标准卡时与价格口径" },
    ],
  },
];

const hostingV2Group: NavGroup = {
  label: "Hosting",
  paths: ["/hosting", "/partners"],
  items: [
    { href: "/hosting", label: "开始上架", description: "从资源登记到清理再售的完整路径" },
    { href: "/hosting/personal-gpu", label: "个人 GPU", description: "上架一张 RTX 4090 或 H100" },
    { href: "/hosting/cloud", label: "云资源接入", description: "云主机、IDC 与集群连接器" },
    { href: "/hosting/earnings", label: "收益与结算", description: "计量、租金、佣金与卡时账本" },
    { href: "/hosting/partners", label: "供应商合作", description: "企业协议、审核与接入进度" },
  ],
};

function groupsFor() {
  return [commonGroups[0], hostingV2Group, commonGroups[1]];
}

function isGroupActive(pathname: string, group: NavGroup) {
  return group.paths.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

function isItemActive(pathname: string, href: string) {
  const path = href.split("#", 1)[0];
  if (path === "/hosting") return pathname === path;
  return pathname === path || pathname.startsWith(`${path}/`);
}

export function NavLinks() {
  const pathname = usePathname();
  const navRef = useRef<HTMLElement>(null);
  const groups = groupsFor();

  useEffect(() => {
    function closeOpenGroup(returnFocus = false) {
      const openGroups = navRef.current?.querySelectorAll<HTMLDetailsElement>("details[open]");
      if (!openGroups?.length) return;
      const focusTarget = openGroups[0].querySelector<HTMLElement>("summary");
      openGroups.forEach((group) => group.removeAttribute("open"));
      if (returnFocus) focusTarget?.focus();
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") closeOpenGroup(true);
    }

    function handlePointerDown(event: PointerEvent) {
      if (navRef.current && !navRef.current.contains(event.target as Node)) closeOpenGroup();
    }

    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("pointerdown", handlePointerDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, []);

  function closeGroups() {
    navRef.current?.querySelectorAll<HTMLDetailsElement>("details[open]").forEach((group) => {
      group.removeAttribute("open");
    });
  }

  return (
    <nav aria-label="全局导航" className="primary-nav primary-nav-mega" ref={navRef}>
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
                    aria-current={isItemActive(pathname, item.href) ? "page" : undefined}
                    href={item.href}
                    key={item.href}
                    onClick={closeGroups}
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
