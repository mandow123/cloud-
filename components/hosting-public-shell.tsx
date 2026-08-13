import Link from "next/link";
import type { ReactNode } from "react";
import styles from "./hosting-public.module.css";

export const hostingPublicStyles = styles;

const routes = [
  { href: "/hosting", label: "总览" },
  { href: "/hosting/personal-gpu", label: "上架 GPU" },
  { href: "/hosting/cloud", label: "云连接器" },
  { href: "/hosting/earnings", label: "收益账本" },
  { href: "/hosting/partners", label: "供应商审核" },
] as const;

export function HostingPublicShell({
  activePath,
  eyebrow,
  title,
  titleEn,
  summary,
  children,
}: {
  activePath: string;
  eyebrow: string;
  title: string;
  titleEn?: string;
  summary: string;
  children: ReactNode;
}) {
  return (
    <div className={styles.page}>
      <header className={styles.masthead}>
        <div className={styles.mastheadInner}>
          <p className={styles.eyebrow}>{eyebrow}</p>
          <h1 className={styles.title}>{title}</h1>
          {titleEn ? <p className={styles.titleEn} lang="en">{titleEn}</p> : null}
          <p className={styles.summary}>{summary}</p>
        </div>
        <nav aria-label="Hosting 页面" className={styles.routeNav}>
          <ul className={styles.routeNavList}>
            {routes.map((route) => (
              <li key={route.href}>
                <Link aria-current={activePath === route.href ? "page" : undefined} href={route.href}>
                  {route.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </header>
      <div className={styles.content}>{children}</div>
    </div>
  );
}

export function SectionHeader({ index, title, lead }: { index: string; title: string; lead?: string }) {
  return (
    <div className={styles.sectionHeader}>
      <div>
        <p className={styles.sectionIndex}>{index}</p>
        <h2 className={styles.sectionTitle}>{title}</h2>
      </div>
      {lead ? <p className={styles.sectionLead}>{lead}</p> : null}
    </div>
  );
}
