"use client";

import Link from "next/link";
import { ChangeEvent, FormEvent, useMemo, useRef, useState } from "react";
import { createIdempotencyKey, marketplaceErrorMessage } from "@/lib/client/marketplace-client";
import {
  createVerificationJob,
  importMacInventory,
  supplyApiUnavailable,
  type SupplyPool,
  type SupplyVerificationJob,
} from "@/components/supply-api-client";

type MacInventoryMember = {
  supplierAssetId: string;
  serialDigest: string;
  modelIdentifier: string;
  chipFamily: string;
  cpuCores: number;
  gpuCores: number;
  neuralEngineCores: number;
  unifiedMemoryGiB: number;
  storageGiB: number;
  networkProfile: string;
  osVersion: string;
  imageProfile: string;
  regionCode: string;
  rackPositionPrivate: string;
  mdmStatus: string;
  connectorStatus: string;
  maintenanceClass: string;
};

const HEADERS = [
  "supplier_asset_id",
  "serial_digest",
  "model_identifier",
  "chip_family",
  "cpu_cores",
  "gpu_cores",
  "neural_engine_cores",
  "unified_memory_gib",
  "storage_gib",
  "network_profile",
  "os_version",
  "image_profile",
  "region_code",
  "rack_position_private",
  "mdm_status",
  "connector_status",
  "maintenance_class",
] as const;

const template = `${HEADERS.join(",")}\nMAC-001,sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef,"Macmini15,1",M4 Pro,14,20,16,48,1024,10GbE,15.6,KAI_MAC_BASE_V1,CN-NORTH-1,RACK-A-01,ENROLLED,ONLINE,STANDARD`;

function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const next = text[index + 1];
    if (character === '"' && quoted && next === '"') {
      cell += '"';
      index += 1;
    } else if (character === '"') {
      quoted = !quoted;
    } else if (character === "," && !quoted) {
      row.push(cell.trim());
      cell = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && next === "\n") index += 1;
      row.push(cell.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += character;
    }
  }
  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

function integer(value: string, field: string, rowNumber: number, minimum = 0) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum) throw new Error(`第 ${rowNumber} 行的 ${field} 必须是不小于 ${minimum} 的整数。`);
  return parsed;
}

function recordsFromCsv(text: string): MacInventoryMember[] {
  const rows = parseCsv(text.replace(/^\uFEFF/u, ""));
  if (rows.length < 2) throw new Error("CSV 至少需要表头和一条设备记录。");
  const actualHeaders = rows[0].map((item) => item.toLowerCase());
  const missing = HEADERS.filter((header) => !actualHeaders.includes(header));
  if (missing.length > 0) throw new Error(`缺少字段：${missing.join("、")}`);
  if (rows.length - 1 > 300) throw new Error("单次最多导入 300 台 Mac mini。");

  const seen = new Set<string>();
  return rows.slice(1).map((values, index) => {
    const rowNumber = index + 2;
    const value = (header: (typeof HEADERS)[number]) => values[actualHeaders.indexOf(header)]?.trim() ?? "";
    const supplierAssetId = value("supplier_asset_id");
    if (!supplierAssetId) throw new Error(`第 ${rowNumber} 行缺少 supplier_asset_id。`);
    if (seen.has(supplierAssetId)) throw new Error(`资产编号 ${supplierAssetId} 在文件中重复。`);
    seen.add(supplierAssetId);
    const serialDigest = value("serial_digest");
    if (!/^sha256:[a-f0-9]{64}$/i.test(serialDigest)) throw new Error(`第 ${rowNumber} 行 serial_digest 不是有效的 sha256 摘要。`);
    for (const field of ["model_identifier", "chip_family", "network_profile"] as const) {
      if (!value(field)) throw new Error(`第 ${rowNumber} 行缺少 ${field}。`);
    }
    return {
      supplierAssetId,
      serialDigest: serialDigest.toLowerCase(),
      modelIdentifier: value("model_identifier"),
      chipFamily: value("chip_family"),
      cpuCores: integer(value("cpu_cores"), "cpu_cores", rowNumber),
      gpuCores: integer(value("gpu_cores"), "gpu_cores", rowNumber),
      neuralEngineCores: integer(value("neural_engine_cores"), "neural_engine_cores", rowNumber),
      unifiedMemoryGiB: integer(value("unified_memory_gib"), "unified_memory_gib", rowNumber, 8),
      storageGiB: integer(value("storage_gib"), "storage_gib", rowNumber, 64),
      networkProfile: value("network_profile"),
      osVersion: value("os_version"),
      imageProfile: value("image_profile"),
      regionCode: value("region_code"),
      rackPositionPrivate: value("rack_position_private"),
      mdmStatus: value("mdm_status"),
      connectorStatus: value("connector_status"),
      maintenanceClass: value("maintenance_class"),
    };
  });
}

export function SupplyMacImport() {
  const [region, setRegion] = useState("华北");
  const [records, setRecords] = useState<MacInventoryMember[]>([]);
  const [fileName, setFileName] = useState("");
  const [pools, setPools] = useState<SupplyPool[]>([]);
  const [verification, setVerification] = useState<SupplyVerificationJob[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const mutationKeys = useRef(new Map<string, string>());

  function mutationKey(scope: string) {
    const current = mutationKeys.current.get(scope);
    if (current) return current;
    const created = createIdempotencyKey(scope);
    mutationKeys.current.set(scope, created);
    return created;
  }

  const groups = useMemo(() => {
    const map = new Map<string, { key: string; label: string; count: number; records: MacInventoryMember[] }>();
    for (const record of records) {
      const effectiveRegion = record.regionCode || region;
      const label = `${record.modelIdentifier} · ${record.chipFamily} · ${record.unifiedMemoryGiB}GB / ${record.storageGiB}GB · ${effectiveRegion} · ${record.networkProfile}`;
      const key = [record.modelIdentifier, record.chipFamily, record.unifiedMemoryGiB, record.storageGiB, effectiveRegion, record.networkProfile].join("|");
      const current = map.get(key);
      map.set(key, { key, label, count: (current?.count ?? 0) + 1, records: [...(current?.records ?? []), record] });
    }
    return [...map.values()].sort((left, right) => right.count - left.count);
  }, [records, region]);

  async function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setError("");
    setNotice("");
    try {
      const nextRecords = recordsFromCsv(await file.text());
      setRecords(nextRecords);
      setFileName(file.name);
    } catch (parseError) {
      setRecords([]);
      setFileName(file.name);
      setError(parseError instanceof Error ? parseError.message : "CSV 无法解析。");
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");
    if (records.length === 0) {
      setError("请先选择并通过本地校验的 CSV 文件。");
      return;
    }
    setBusy(true);
    try {
      const imported = await importMacInventory(records.map((record) => ({
        externalRef: record.supplierAssetId,
        serialDigest: record.serialDigest,
        hardwareUuidDigest: null,
        model: record.modelIdentifier,
        chip: record.chipFamily,
        memoryGiB: record.unifiedMemoryGiB,
        storageGiB: record.storageGiB,
        region: record.regionCode || region,
        networkProfile: record.networkProfile,
        deliveryForm: "库存检测（不可成交）",
      })), mutationKey("mac-inventory-batch"));
      const serverGroups = imported.record.groups;
      const nextPools: SupplyPool[] = serverGroups.map(({ pool: currentPool, policy, items }) => ({
        ...currentPool,
        policy,
        memberCount: items.length,
        verifiedCount: items.filter((item) => item.status === "VERIFIED").length,
      }));
      const nextJobs: SupplyVerificationJob[] = [];
      const importedMembers = serverGroups.flatMap((group) => group.items);
      for (let index = 0; index < importedMembers.length; index += 12) {
          const jobBatch = await Promise.all(importedMembers.slice(index, index + 12).map((member) =>
            createVerificationJob(member.id, mutationKey(`mac-verify-${member.id}`)).then((result) => result.record)));
          nextJobs.push(...jobBatch);
      }
      setPools(nextPools);
      setVerification(nextJobs);
      setNotice(`${records.length} 台设备已写入服务端并生成 ${serverGroups.length} 个规格分组；检测任务已创建。该资源池不具备发布或成交权限。`);
    } catch (submitError) {
      setError(supplyApiUnavailable(submitError)
        ? "Mac 入库服务 API 尚未就绪，本地预览不会被当作已入库状态。请等待 /api/v1/supply 服务上线后重试。"
        : marketplaceErrorMessage(submitError, "Mac 批量入库未完成；已成功的批次会保留，请在资产页核对后再重试。"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="shell py-10 sm:py-14">
      <section className="border-t-4 border-[var(--border-strong)] bg-[var(--surface)] p-6 ring-1 ring-[var(--border)] sm:p-8" aria-labelledby="mac-import-title">
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div>
            <p className="kicker">Mac inventory intake</p>
            <h2 className="m-0 text-3xl" id="mac-import-title">批量入库、检测与分组</h2>
            <p className="section-lead text-base">最多 300 台。CSV 先在浏览器校验，再分 100 台一批写入服务端；全程不创建价格、挂牌或订单。</p>
          </div>
          <span className="border border-[var(--warning)] bg-[var(--warning-bg)] px-4 py-3 text-sm font-semibold text-[var(--ink)]">INVENTORY ONLY · 禁止成交</span>
        </div>

        {error ? <div className="mt-5 border-l-4 border-[var(--error)] bg-[var(--error-bg)] p-4 text-sm text-[var(--error)]" role="alert">{error}</div> : null}
        {notice ? <div className="mt-5 border-l-4 border-[var(--success)] bg-[var(--success-bg)] p-4 text-sm" role="status">{notice}</div> : null}

        <form className="mt-7" onSubmit={submit}>
          <div className="grid gap-5 md:grid-cols-2">
            <label className="field">
              <span>默认资源地区（CSV region_code 为空时使用）</span>
              <select onChange={(event) => setRegion(event.target.value)} value={region}>
                {['华北', '华东', '华南', '西南', '西北'].map((item) => <option key={item}>{item}</option>)}
              </select>
            </label>
          </div>

          <div className="mt-6 border-2 border-dashed border-[var(--border-strong)] bg-[var(--info-bg)] p-6 text-center">
            <label className="inline-grid cursor-pointer gap-2">
              <span className="text-lg font-semibold text-[var(--ink)]">选择 Mac mini CSV 清单</span>
              <input accept=".csv,text/csv" className="mx-auto max-w-full" onChange={(event) => void chooseFile(event)} type="file" />
            </label>
            <p className="mb-0 mt-3 text-sm text-[var(--text)]">只上传序列号摘要；明文序列号、Apple Account、密码和私钥不得进入文件。</p>
            <a className="mt-3 inline-flex min-h-11 items-center text-sm font-semibold text-[var(--accent)] underline" download="kai-mac-mini-import-template.csv" href={`data:text/csv;charset=utf-8,${encodeURIComponent(template)}`}>下载 CSV 模板</a>
          </div>

          <div className="mt-6 grid gap-px bg-[var(--border)] sm:grid-cols-4">
            <div className="bg-[var(--info-bg)] p-5"><span className="text-xs text-[var(--muted)]">文件</span><strong className="mt-1 block break-words text-[var(--ink)]">{fileName || "未选择"}</strong></div>
            <div className="bg-[var(--info-bg)] p-5"><span className="text-xs text-[var(--muted)]">通过本地校验</span><strong className="mt-1 block text-2xl text-[var(--ink)]">{records.length} / 300</strong></div>
            <div className="bg-[var(--info-bg)] p-5"><span className="text-xs text-[var(--muted)]">规格预分组</span><strong className="mt-1 block text-2xl text-[var(--ink)]">{groups.length}</strong></div>
            <div className="bg-[var(--info-bg)] p-5"><span className="text-xs text-[var(--muted)]">成交权限</span><strong className="mt-1 block text-[var(--warning)]">永久阻断（首期）</strong></div>
          </div>

          {groups.length > 0 ? (
            <div className="mt-6 overflow-x-auto border border-[var(--border)]">
              <table className="data-table min-w-[680px]">
                <caption className="sr-only">Mac mini 规格预分组</caption>
                <thead><tr><th scope="col">规格分组</th><th className="num" scope="col">设备数</th><th scope="col">后续动作</th></tr></thead>
                <tbody>{groups.map((group) => <tr key={group.label}><th scope="row">{group.label}</th><td className="num">{group.count}</td><td>服务端入库后创建检测任务</td></tr>)}</tbody>
              </table>
            </div>
          ) : null}

          <div className="mt-6 flex flex-wrap items-center gap-4">
            <button className="button button-primary" disabled={busy || records.length === 0} type="submit">{busy ? "正在分批入库…" : `入库 ${records.length || 0} 台并创建检测任务`}</button>
            <Link className="button button-secondary" href="/supply/assets">查看资源资产</Link>
          </div>
        </form>

        {(pools.length > 0 || verification.length > 0) ? (
          <div className="mt-6 border-l-4 border-[var(--accent)] bg-[var(--accent-soft)] p-5 text-sm">
            <strong className="block text-[var(--ink)]">服务端回执</strong>
            <span className="block break-words">资源池：{pools.length} 个</span>
            <span className="block break-words">检测任务：{verification.length} 个</span>
          </div>
        ) : null}
      </section>
    </div>
  );
}
