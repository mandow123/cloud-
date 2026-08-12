"use client";

import { useState } from "react";

export function LocalPreviewLogin({ returnTo, secret }: { returnTo: string; secret: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function enterPreview() {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      const response = await fetch("/api/auth/local", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json", "x-kai-local-auth-secret": secret },
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
      <p className="mt-1 text-sm text-[var(--muted)]">进入隔离的验收账户，验证供应商、挂牌和订单页面；生产环境不会显示此入口。</p>
      <button className="button button-secondary mt-3 min-h-11 w-full justify-center" disabled={busy} onClick={() => void enterPreview()} type="button">{busy ? "正在建立验收会话…" : "进入本地验收环境"}</button>
      {error ? <p className="mt-3 text-sm text-[var(--error)]" role="alert">{error}</p> : null}
    </div>
  );
}
