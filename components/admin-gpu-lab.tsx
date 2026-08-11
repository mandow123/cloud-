"use client";

import { useEffect, useState } from "react";
import { adminGetSession } from "@/components/admin-api-client";
import { AdminPageHeader } from "@/components/admin-page-header";
import { AdminError, AdminLoading, AdminLoginRequired } from "@/components/admin-states";
import { GpuHostingLab } from "@/components/gpu-cloud-lab";

export function AdminGpuLab() {
  const [authenticated, setAuthenticated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void adminGetSession()
      .then((session) => {
        if (cancelled) return;
        if (!session) {
          setAuthenticated(false);
          return;
        }
        const admin = session.admin && typeof session.admin === "object" && !Array.isArray(session.admin)
          ? session.admin as Record<string, unknown>
          : {};
        const principal = admin.principal && typeof admin.principal === "object" && !Array.isArray(admin.principal)
          ? admin.principal as Record<string, unknown>
          : {};
        const roles = Array.isArray(principal.roles) ? principal.roles : [];
        setAuthenticated(session.authenticated === true && roles.includes("ROOT"));
        setForbidden(session.authenticated === true && !roles.includes("ROOT"));
      })
      .catch(() => { if (!cancelled) setError(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  if (loading) return <AdminLoading label="正在校验本地实验室权限…" />;
  if (!authenticated && !error) return <AdminLoginRequired forbidden={forbidden} />;
  if (error) return <AdminError message="本地实验室权限校验失败。" />;

  return (
    <div className="admin-page">
      <AdminPageHeader
        description="只在 LOCAL 环境开放；数据与生产市场完全隔离。"
        kicker="Local experiment"
        title="GPU 闭环实验室"
      />
      <GpuHostingLab />
    </div>
  );
}
