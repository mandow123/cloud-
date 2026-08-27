"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { useLocale } from "./locale-provider";
import type { MessageKey } from "@/lib/i18n";

type NavItem = {
  href: string;
  label: MessageKey;
  description: MessageKey;
  external?: boolean;
};

type NavGroup = {
  label: MessageKey;
  paths: string[];
  items: NavItem[];
};

const commonGroups: NavGroup[] = [
  {
    label: "compute",
    paths: ["/gpu", "/resources", "/market"],
    items: [
      { href: "/gpu", label: "gpuRental", description: "gpuRentalDesc" },
      { href: "/resources", label: "allResources", description: "allResourcesDesc" },
      { href: "/market", label: "market", description: "marketDesc" },
    ],
  },
  {
    label: "guides",
    paths: ["/guides", "/methodology"],
    items: [
      { href: "/guides", label: "guideHome", description: "guideHomeDesc" },
      { href: "/guides#rent-gpu", label: "rentGpu", description: "rentGpuDesc" },
      { href: "/guides/host-agent", label: "listGpu", description: "listGpuDesc" },
      { href: "/guides#delivery", label: "delivery", description: "deliveryDesc" },
      { href: "/methodology", label: "pricing", description: "pricingDesc" },
    ],
  },
];

const hostingV2Group: NavGroup = {
  label: "hosting",
  paths: ["/hosting", "/partners"],
  items: [
    { href: "/hosting", label: "startHosting", description: "startHostingDesc" },
    { href: "/hosting/personal-gpu", label: "personalGpu", description: "personalGpuDesc" },
    { href: "/hosting/cloud", label: "cloudAccess", description: "cloudAccessDesc" },
    { href: "/hosting/earnings", label: "earnings", description: "earningsDesc" },
    { href: "/hosting/partners", label: "suppliers", description: "suppliersDesc" },
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
  const { t } = useLocale();
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
    <nav aria-label={t("globalNav")} className="primary-nav primary-nav-mega" ref={navRef}>
      {groups.map((group) => {
        const active = isGroupActive(pathname, group);
        return (
          <details className="nav-group" key={group.label}>
            <summary aria-current={active ? "page" : undefined}>
              <span>{t(group.label)}</span>
              <span aria-hidden="true" className="nav-chevron">⌄</span>
            </summary>
            <div className="nav-popover">
              <p className="nav-popover-label">{t(group.label)}</p>
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
                    <strong>{t(item.label)}</strong>
                    <span>{t(item.description)}</span>
                  </Link>
                ))}
              </div>
            </div>
          </details>
        );
      })}
      <a className="nav-company-link" href="https://kai.com" target="_blank" rel="noreferrer">
        {t("company")} <span aria-hidden="true">↗</span>
      </a>
    </nav>
  );
}
