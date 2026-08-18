"use client";

import { useState, useSyncExternalStore } from "react";

type PreviewProfile = "buyer" | "supplier";

const PREVIEW_PROFILES: Record<PreviewProfile, { host: string; label: string; returnTo: string; description: string }> = {
  buyer: {
    host: "buyer.localhost",
    label: "买家验收",
    returnTo: "/gpu",
    description: "浏览报价、锁定卡时并完成实例订单",
  },
  supplier: {
    host: "supplier.localhost",
    label: "供应商验收",
    returnTo: "/supply",
    description: "完成入驻、Agent 验真、挂牌与收益查看",
  },
};

function previewProfile(hostname: string): PreviewProfile | null {
  const entry = Object.entries(PREVIEW_PROFILES).find(([, profile]) => profile.host === hostname.toLowerCase());
  return entry?.[0] as PreviewProfile | undefined ?? null;
}

const subscribeToLocation = () => () => undefined;

export function LocalPreviewLogin({ returnTo }: { returnTo: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const profile = useSyncExternalStore(subscribeToLocation, () => previewProfile(window.location.hostname), () => null);

  function openProfile(nextProfile: PreviewProfile) {
    const target = new URL(window.location.href);
    target.hostname = PREVIEW_PROFILES[nextProfile].host;
    target.pathname = "/login";
    target.search = new URLSearchParams({ returnTo: PREVIEW_PROFILES[nextProfile].returnTo }).toString();
    target.hash = "";
    window.location.assign(target.toString());
  }

  async function enterPreview() {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      const response = await fetch("/api/auth/local", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      if (!response.ok) throw new Error("LOCAL_PREVIEW_LOGIN_FAILED");
      window.location.assign(returnTo);
    } catch {
      setError("本地验收会话未能建立，请检查本地启动配置。");
      setBusy(false);
    }
  }

  return (
    <div className="mt-5 border border-dashed border-[var(--border-strong)] bg-[var(--surface-soft)] p-4">
      <p className="m-0 text-sm font-semibold text-[var(--ink)]">仅本机开发环境</p>
      <p className="mt-1 text-sm text-[var(--muted)]">买家与供应商使用不同本地域名和独立会话，可以同时打开两个窗口验证真实前后端流程；生产环境不会显示这些入口。</p>
      {profile ? (
        <button className="button button-secondary mt-3 min-h-11 w-full justify-center" disabled={busy} onClick={() => void enterPreview()} type="button">
          {busy ? "正在建立验收会话…" : `以${PREVIEW_PROFILES[profile].label}身份进入`}
        </button>
      ) : (
        <div className="mt-3 grid gap-2 sm:grid-cols-2" aria-label="本地验收身份">
          {(Object.entries(PREVIEW_PROFILES) as Array<[PreviewProfile, (typeof PREVIEW_PROFILES)[PreviewProfile]]>).map(([key, item]) => (
            <button className="min-h-20 border border-[var(--border)] bg-[var(--surface)] p-3 text-left text-[var(--ink)] transition hover:border-[var(--border-strong)]" key={key} onClick={() => openProfile(key)} type="button">
              <strong className="block text-sm">打开{item.label}窗口</strong>
              <span className="mt-1 block text-xs leading-5 text-[var(--muted)]">{item.description}</span>
            </button>
          ))}
        </div>
      )}
      {error ? <p className="mt-3 text-sm text-[var(--error)]" role="alert">{error}</p> : null}
    </div>
  );
}
