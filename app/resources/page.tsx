import type { Metadata } from "next";
import { Suspense } from "react";
import { ResourceExplorer } from "@/components/resource-explorer";
import { resourceListings } from "@/lib/data";

export const metadata: Metadata = {
  title: "算力资源目录",
  description: "发现并比较 GPU、Token、模型、整机柜容量与云厂商参考方案，再提交算力需求。",
};

function ResourceExplorerFallback() {
  return (
    <div className="shell py-24" role="status">
      <div className="border-y border-[var(--border)] bg-[var(--surface)] px-6 py-16 text-center">
        <p className="m-0 text-sm font-semibold text-[var(--ink)]">正在读取资源筛选条件…</p>
      </div>
    </div>
  );
}

export default function ResourcesPage() {
  return (
    <Suspense fallback={<ResourceExplorerFallback />}>
      <ResourceExplorer listings={resourceListings} />
    </Suspense>
  );
}
