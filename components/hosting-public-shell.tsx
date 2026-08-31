"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useLocale } from "@/components/locale-provider";
import type { Locale } from "@/lib/i18n";
import styles from "./hosting-public.module.css";

export const hostingPublicStyles = styles;

const routeHrefs = ["/hosting", "/hosting/personal-gpu", "/hosting/cloud", "/hosting/earnings", "/hosting/partners"] as const;
const SHELL_COPY: Record<Locale, { nav: string; routes: readonly [string, string, string, string, string] }> = {
  "zh-CN": { nav: "Hosting 页面", routes: ["总览", "上架 GPU", "云连接器", "收益账本", "供应商审核"] },
  "zh-TW": { nav: "Hosting 頁面", routes: ["總覽", "上架 GPU", "雲端連接器", "收益帳本", "供應商審核"] },
  en: { nav: "Hosting pages", routes: ["Overview", "List a GPU", "Cloud connectors", "Earnings ledger", "Supplier review"] },
  ja: { nav: "Hosting ページ", routes: ["概要", "GPUを掲載", "クラウド接続", "収益台帳", "供給者審査"] },
  ko: { nav: "Hosting 페이지", routes: ["개요", "GPU 등록", "클라우드 연결", "수익 원장", "공급자 검토"] },
  fr: { nav: "Pages Hosting", routes: ["Vue d’ensemble", "Publier un GPU", "Connecteurs cloud", "Registre des revenus", "Examen fournisseur"] },
  th: { nav: "หน้า Hosting", routes: ["ภาพรวม", "ลงรายการ GPU", "ตัวเชื่อมต่อคลาวด์", "บัญชีรายได้", "ตรวจสอบผู้ให้บริการ"] },
  vi: { nav: "Trang Hosting", routes: ["Tổng quan", "Đăng GPU", "Kết nối cloud", "Sổ cái doanh thu", "Xét duyệt nhà cung cấp"] },
  id: { nav: "Halaman Hosting", routes: ["Ringkasan", "Listing GPU", "Konektor cloud", "Buku besar pendapatan", "Tinjauan pemasok"] },
  ms: { nav: "Halaman Hosting", routes: ["Ringkasan", "Senaraikan GPU", "Penyambung awan", "Lejar pendapatan", "Semakan pembekal"] },
};

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
  const { locale } = useLocale();
  const copy = SHELL_COPY[locale];
  return (
    <div className={styles.page}>
      <header className={styles.masthead}>
        <div className={styles.mastheadInner}>
          <p className={styles.eyebrow}>{eyebrow}</p>
          <h1 className={styles.title}>{title}</h1>
          {titleEn ? <p className={styles.titleEn} lang="en">{titleEn}</p> : null}
          <p className={styles.summary}>{summary}</p>
        </div>
        <nav aria-label={copy.nav} className={styles.routeNav}>
          <ul className={styles.routeNavList}>
            {routeHrefs.map((href, index) => (
              <li key={href}>
                <Link aria-current={activePath === href ? "page" : undefined} href={href}>
                  {copy.routes[index]}
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
