"use client";

import Link from "next/link";
import styles from "./kai-standard-pages.module.css";

export function KaiStandardLoading({ label }: { label: string }) {
  return (
    <div className={styles.state} role="status" aria-live="polite">
      <strong>正在读取{label}</strong>
      <p>页面正在核对服务端快照、更新时间和政策版本。</p>
    </div>
  );
}

export function KaiStandardError({
  title = "暂时无法读取数据",
  description,
  onRetry,
}: {
  title?: string;
  description: string;
  onRetry: () => void;
}) {
  return (
    <div className={`${styles.state} ${styles.stateError}`} role="alert">
      <strong>{title}</strong>
      <p>{description}</p>
      <button className={styles.retry} type="button" onClick={onRetry}>重新读取</button>
    </div>
  );
}

export function KaiStandardEmpty({ title, description }: { title: string; description: string }) {
  return (
    <div className={styles.state} role="status">
      <strong>{title}</strong>
      <p>{description}</p>
    </div>
  );
}

export function KaiStandardSignIn() {
  const returnTo = typeof window === "undefined" ? "/member/kai-hours" : window.location.pathname + window.location.search;
  return (
    <div className={`${styles.state} ${styles.stateError}`} role="alert">
      <strong>登录后查看本组织的容量与结算</strong>
      <p>公开行情可以匿名查看；组织容量、订单占用和人民币结算只对已登录成员开放。</p>
      <Link className={styles.primaryLink} href={`/login?returnTo=${encodeURIComponent(returnTo)}`}>邮箱验证码登录</Link>
    </div>
  );
}
