"use client";

import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { adminErrorMessage, adminGetJson, adminPostAction } from "@/components/admin-api-client";
import { AdminPageHeader } from "@/components/admin-page-header";
import { AdminEmpty, AdminError, AdminLoading } from "@/components/admin-states";
import { formatCardHourDisplayMicros } from "@/lib/card-hours";

type Row = Record<string, unknown>;
type Overview = { products: Row[]; facilities: Row[]; economicPolicies: Row[]; quotes: Row[]; orders: Row[]; assets: Row[]; settlements: Row[]; serviceRequests: Row[]; approvals: Row[]; counts?: Record<string, number> };
type ActionType = "PUBLISH_PRODUCT_VERSION" | "ACTIVATE_FACILITY" | "PUBLISH_ECONOMIC_POLICY" | "ISSUE_QUOTE" | "RECORD_PAYMENT_EVIDENCE" | "TRANSITION_ORDER" | "CREATE_ASSET" | "TRANSITION_ASSET" | "CREATE_SETTLEMENT" | "TRANSITION_SETTLEMENT" | "SHIP_ASSET";
const actionLabels: Record<ActionType, string> = { PUBLISH_PRODUCT_VERSION: "上线已核验 GPU 商品", ACTIVATE_FACILITY: "验收并启用托管机房", PUBLISH_ECONOMIC_POLICY: "发布托管结算政策", ISSUE_QUOTE: "发出正式报价", RECORD_PAYMENT_EVIDENCE: "录入供应商银行付款证据", TRANSITION_ORDER: "推进购买订单", CREATE_ASSET: "分配实体 GPU", TRANSITION_ASSET: "推进验收 / 托管状态", CREATE_SETTLEMENT: "创建月度卡时结算", TRANSITION_SETTLEMENT: "推进月结审批 / 入账", SHIP_ASSET: "执行实体 GPU 寄送" };
const array = (value: unknown) => Array.isArray(value) ? value.filter((item): item is Row => Boolean(item) && typeof item === "object" && !Array.isArray(item)) : [];
const text = (row: Row, key: string) => row[key] == null ? "—" : String(row[key]);
const dateTime = (value: unknown) => typeof value === "string" && !Number.isNaN(Date.parse(value)) ? new Date(value).toLocaleString("zh-CN") : "—";

export function AdminManagedGpu() {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [busyApprovalId, setBusyApprovalId] = useState("");
  const [busyAction, setBusyAction] = useState(false);
  const [actionType, setActionType] = useState<ActionType>("ISSUE_QUOTE");
  const [targetId, setTargetId] = useState("");
  const [draft, setDraft] = useState<Record<string, string>>({ currency: "CNY", eventType: "CAPTURED", provider: "供应商银行", unitIndex: "1" });
  const [notice, setNotice] = useState("");
  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const payload = await adminGetJson("/api/v1/admin/managed-gpu/overview");
      setData({ products: array(payload.products), facilities: array(payload.facilities), economicPolicies: array(payload.economicPolicies), quotes: array(payload.quotes), orders: array(payload.orders), assets: array(payload.assets), settlements: array(payload.settlements), serviceRequests: array(payload.serviceRequests), approvals: array(payload.approvals), counts: payload.counts && typeof payload.counts === "object" ? payload.counts as Record<string, number> : undefined });
    } catch (reason) { setError(reason); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { const handle = window.requestAnimationFrame(() => void load()); return () => window.cancelAnimationFrame(handle); }, [load]);

  async function decideApproval(row: Row, decision: "approve" | "reject") {
    const id = text(row, "id");
    if (id === "—") return;
    setBusyApprovalId(id); setError(null); setNotice("");
    try {
      await adminPostAction(`/api/v1/admin/managed-gpu/approvals/${encodeURIComponent(id)}/${decision}`, { actionType: text(row, "actionType"), expectedVersion: Number(row.version) });
      setNotice(decision === "approve" ? "双人审批已通过；原申请管理员可使用该审批执行对应命令。" : "审批已拒绝，命令不能执行。");
      await load();
    } catch (reason) { setError(reason); }
    finally { setBusyApprovalId(""); }
  }

  const targetRows = data ? rowsForAction(data, actionType) : [];
  const selectedTarget = targetRows.find((row) => text(row, "id") === targetId) ?? null;

  async function requestActionApproval() {
    if (!selectedTarget) { setError(new Error("请先选择需要处理的记录。")); return; }
    setBusyAction(true); setError(null); setNotice("");
    try {
      const commandPayload = buildCommandPayload(actionType, selectedTarget, draft);
      await adminPostAction("/api/v1/admin/managed-gpu/approvals", { actionType, targetId: approvalTarget(actionType, targetId, commandPayload), commandPayload });
      setNotice(`${actionLabels[actionType]}已提交双人审批。请由另一位具备相应权限的管理员复核。`);
      await load();
    } catch (reason) { setError(reason); }
    finally { setBusyAction(false); }
  }

  async function executeApproved(row: Row) {
    const id = text(row, "id"), type = text(row, "actionType") as ActionType, target = text(row, "targetId");
    if (!(type in actionLabels) || id === "—" || target === "—" || !row.commandPayload || typeof row.commandPayload !== "object") return;
    setBusyApprovalId(id); setError(null); setNotice("");
    try {
      await adminPostAction(actionEndpoint(type, target), row.commandPayload, "POST", id);
      setNotice(`${actionLabels[type]}已执行，审批已核销，业务数据已重新读取。`);
      await load();
    } catch (reason) { setError(reason); }
    finally { setBusyApprovalId(""); }
  }

  return <div className="admin-page">
    <AdminPageHeader actions={<button className="admin-button secondary" disabled={loading} onClick={() => void load()} type="button">{loading ? "读取中…" : "刷新真实数据"}</button>} description="统一查看实体 GPU 报价、供应商银行付款、整卡确权、机房托管、月度卡时结算与退出寄送。高风险动作必须由服务端双人审批。" kicker="Managed physical GPU" title="GPU 云托管运营" />
    {loading && !data ? <AdminLoading label="正在读取 GPU 云托管运营数据…" /> : null}
    {error ? <AdminError message={adminErrorMessage(error, error instanceof Error ? error.message : "GPU 云托管数据暂时无法读取。")} onRetry={() => void load()} /> : null}
    {data ? <>
      <section className="admin-metric-grid">
        <article className="admin-metric-card"><span>报价申请</span><strong>{data.quotes.length}</strong><small>等待企业审核或供应商正式报价</small></article>
        <article className="admin-metric-card"><span>购买订单</span><strong>{data.orders.length}</strong><small>银行付款不得由页面自行确认</small></article>
        <article className="admin-metric-card"><span>实体 GPU</span><strong>{data.assets.length}</strong><small>一张卡、一个所有者、一个序列号摘要</small></article>
        <article className="admin-metric-card"><span>退出 / 寄送</span><strong>{data.serviceRequests.length}</strong><small>退出需提前30天并完成排空清算</small></article>
      </section>
      {notice ? <div className="admin-inline-success" role="status"><strong>审批已更新</strong><span>{notice}</span></div> : null}
      <section className="admin-action-panel" aria-labelledby="managed-gpu-action-title">
        <div><p className="admin-kicker">双人审批工作流</p><h2 id="managed-gpu-action-title">运营动作工作台</h2><span>先由操作员填写真实凭证并提交审批；另一位管理员批准后，必须回到审批队列点击执行。批准本身不会改业务状态。</span><p className="admin-inline-warning">证据字段只接收 SHA-256 摘要，不得粘贴合同、银行回单、序列号、地址、私钥或其他敏感原文。</p></div>
        <div className="admin-action-fields">
          <label><span>处理动作</span><select value={actionType} onChange={(event) => { setActionType(event.target.value as ActionType); setTargetId(""); setDraft((current) => ({ currency: current.currency ?? "CNY", eventType: current.eventType ?? "CAPTURED", provider: current.provider ?? "供应商银行", unitIndex: current.unitIndex ?? "1" })); }}>{Object.entries(actionLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label><span>需要处理的记录</span><select value={targetId} onChange={(event) => setTargetId(event.target.value)}><option value="">请选择</option>{targetRows.map((row) => <option key={text(row, "id")} value={text(row, "id")}>{recordOption(row)}</option>)}</select></label>
          <ManagedGpuActionFields actionType={actionType} draft={draft} selected={selectedTarget} setDraft={setDraft} />
          <button className="admin-button primary" disabled={busyAction || !selectedTarget} onClick={() => void requestActionApproval()} type="button">{busyAction ? "提交中…" : "提交双人审批"}</button>
        </div>
      </section>
      <section className="admin-table-wrap"><table className="admin-table"><caption>双人审批队列</caption><thead><tr><th>审批</th><th>动作</th><th>目标</th><th>申请人</th><th>待执行内容</th><th>状态</th><th>申请时间</th><th>操作</th></tr></thead><tbody>{data.approvals.map((row) => <tr key={text(row, "id")}><td className="admin-mono">{text(row, "id")}</td><td>{actionLabels[text(row, "actionType") as ActionType] ?? text(row, "actionType")}</td><td className="admin-mono">{text(row, "targetId")}</td><td className="admin-mono">{text(row, "requesterAccountId")}</td><td><code>{compactPayload(row.commandPayload)}</code></td><td><span className="admin-status neutral">{text(row, "status")}</span></td><td>{dateTime(row.requestedAt)}</td><td>{text(row, "status") === "REQUESTED" ? <div className="admin-row-actions"><button className="admin-button primary" disabled={Boolean(busyApprovalId)} onClick={() => void decideApproval(row, "approve")} type="button">{busyApprovalId === text(row, "id") ? "处理中…" : "批准"}</button><button className="admin-button danger" disabled={Boolean(busyApprovalId)} onClick={() => void decideApproval(row, "reject")} type="button">拒绝</button></div> : text(row, "status") === "APPROVED" ? <button className="admin-button primary" disabled={Boolean(busyApprovalId)} onClick={() => void executeApproved(row)} type="button">{busyApprovalId === text(row, "id") ? "执行中…" : "执行已批准动作"}</button> : "—"}</td></tr>)}</tbody></table>{data.approvals.length === 0 ? <AdminEmpty description="高风险命令提交审批后会出现在这里；申请人不能审批自己的命令。" title="暂无双人审批" /> : null}</section>
      <AdminTable title="云托管商品版本" rows={data.products} columns={[['商品版本','id'],['SKU','sku'],['供应商','sellerName'],['GPU','gpuModel'],['真实库存','verifiedInventoryCount'],['状态','status'],['上线时间','createdAt']]} />
      <AdminTable title="托管机房" rows={data.facilities} columns={[['机房','id'],['名称','displayName'],['地区','region'],['托管条款','custodyTermsVersion'],['状态','status'],['版本','version']]} />
      <AdminTable title="托管结算政策" rows={data.economicPolicies} columns={[['政策版本','id'],['政策代码','policyCode'],['版本','versionNumber'],['机房','facilityId'],['每日托管费（卡时微单位）','facilityChargeMicrosPerAssetDay'],['生效时间','effectiveFrom']]} />
      <AdminTable title="实体 GPU 购买订单" rows={data.orders} columns={[['订单','id'],['组织','organizationId'],['商品','productVersionId'],['数量','quantity'],['交付','fulfillmentChoice'],['状态','status'],['更新时间','updatedAt']]} />
      <AdminTable title="实体 GPU 资产" rows={data.assets} columns={[['资产','id'],['所有者组织','ownerOrganizationId'],['序列号摘要','serialFingerprint'],['机房','facilityId'],['状态','status'],['版本','version'],['更新时间','updatedAt']]} />
      <section className="admin-table-wrap"><table className="admin-table"><caption>托管卡时结算</caption><thead><tr><th>结算</th><th>资产</th><th>周期</th><th>毛产出</th><th>平台费</th><th>磨损</th><th>托管费</th><th>净入账</th><th>状态</th></tr></thead><tbody>{data.settlements.map((row) => <tr key={text(row, 'id')}><td className="admin-mono">{text(row, 'id')}</td><td className="admin-mono">{text(row, 'assetId')}</td><td>{dateTime(row.periodStart)} – {dateTime(row.periodEnd)}</td><td>{micros(row.grossCardHourMicros)}</td><td>{micros(row.platformFeeMicros)}</td><td>{micros(row.wearMicros)}</td><td>{micros(row.facilityChargeMicros)}</td><td>{micros(row.netCardHourMicros)}</td><td><span className="admin-status neutral">{text(row, 'status')}</span></td></tr>)}</tbody></table>{data.settlements.length === 0 ? <AdminEmpty description="无真实成交或尚未完成每日确认时，不会生成可入账结算。" title="暂无托管卡时结算" /> : null}</section>
      <AdminTable title="退出与全球寄送申请" rows={data.serviceRequests} columns={[['申请','id'],['资产','assetId'],['类型','requestType'],['国家/地区','destinationCountryCode'],['状态','status'],['创建时间','createdAt']]} />
      <p className="admin-inline-warning">管理员不能输入或承诺固定收益，不能把卡时设置为可提现，也不能在缺少银行到账证据、机房验收证据或真实算力成交时跳过状态。</p>
    </> : !loading && !error ? <AdminEmpty description="没有使用演示数据填充页面。" title="暂无 GPU 云托管运营数据" /> : null}
  </div>;
}

function AdminTable({ title, rows, columns }: { title: string; rows: Row[]; columns: Array<[string, string]> }) {
  return <section className="admin-table-wrap"><table className="admin-table"><caption>{title}</caption><thead><tr>{columns.map(([label]) => <th key={label}>{label}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={text(row, 'id') === "—" ? index : text(row, 'id')}>{columns.map(([label, key]) => <td className={key === 'id' || key.endsWith('Id') || key.includes('Fingerprint') ? 'admin-mono' : ''} key={label}>{key.endsWith('At') ? dateTime(row[key]) : text(row, key)}</td>)}</tr>)}</tbody></table>{rows.length === 0 ? <AdminEmpty description="服务端没有返回记录，页面未生成模拟条目。" title={`暂无${title}`} /> : null}</section>;
}

function rowsForAction(data: Overview, action: ActionType) {
  if (action === "PUBLISH_PRODUCT_VERSION") return [{ id: "NEW_PRODUCT_VERSION", status: "待填写并双审" }];
  if (action === "ACTIVATE_FACILITY") return data.facilities.filter((row) => ["PLANNED", "SUSPENDED"].includes(text(row, "status")));
  if (action === "PUBLISH_ECONOMIC_POLICY") return [{ id: "NEW_ECONOMIC_POLICY", status: "待填写并双审" }];
  if (action === "ISSUE_QUOTE") return data.quotes;
  if (["RECORD_PAYMENT_EVIDENCE", "TRANSITION_ORDER", "CREATE_ASSET"].includes(action)) return data.orders;
  if (["TRANSITION_ASSET", "CREATE_SETTLEMENT"].includes(action)) return data.assets;
  if (action === "TRANSITION_SETTLEMENT") return data.settlements;
  return data.serviceRequests.filter((row) => text(row, "requestType") === "GLOBAL_SHIPPING");
}

function recordOption(row: Row) {
  const id = text(row, "id"), status = text(row, "status"), subject = text(row, "productVersionId") !== "—" ? text(row, "productVersionId") : text(row, "assetId");
  return `${id} · ${subject} · ${status}`;
}

function actionEndpoint(action: ActionType, targetId: string) {
  const target = encodeURIComponent(targetId);
  if (action === "PUBLISH_PRODUCT_VERSION") return "/api/v1/admin/managed-gpu/catalog/products";
  if (action === "ACTIVATE_FACILITY") return `/api/v1/admin/managed-gpu/facilities/${target}/activate`;
  if (action === "PUBLISH_ECONOMIC_POLICY") return "/api/v1/admin/managed-gpu/economic-policies";
  if (action === "ISSUE_QUOTE") return `/api/v1/admin/managed-gpu/quotes/${target}/issue`;
  if (action === "RECORD_PAYMENT_EVIDENCE") return "/api/v1/admin/managed-gpu/payments";
  if (action === "TRANSITION_ORDER") return `/api/v1/admin/managed-gpu/orders/${target}/transition`;
  if (action === "CREATE_ASSET") return "/api/v1/admin/managed-gpu/assets";
  if (action === "TRANSITION_ASSET") return `/api/v1/admin/managed-gpu/assets/${target}/transition`;
  if (action === "CREATE_SETTLEMENT") return "/api/v1/admin/managed-gpu/settlements";
  if (action === "TRANSITION_SETTLEMENT") return `/api/v1/admin/managed-gpu/settlements/${target}/transition`;
  return `/api/v1/admin/managed-gpu/service-requests/${target}/ship`;
}

function requiredDraft(draft: Record<string, string>, key: string, label: string) {
  const value = draft[key]?.trim() ?? "";
  if (!value) throw new Error(`请填写${label}。`);
  return value;
}

function integerDraft(draft: Record<string, string>, key: string, label: string, minimum = 0) {
  const value = Number(requiredDraft(draft, key, label));
  if (!Number.isSafeInteger(value) || value < minimum) throw new Error(`${label}必须是有效整数。`);
  return value;
}

function isoDraft(draft: Record<string, string>, key: string, label: string) {
  const parsed = new Date(requiredDraft(draft, key, label));
  if (!Number.isFinite(parsed.getTime())) throw new Error(`${label}无效。`);
  return parsed.toISOString();
}

function jsonDraft(draft: Record<string, string>, key: string, label: string) {
  try {
    const parsed: unknown = JSON.parse(requiredDraft(draft, key, label));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    return parsed as Row;
  } catch { throw new Error(`${label}必须是 JSON 对象。`); }
}

function listDraft(draft: Record<string, string>, key: string, label: string) {
  const values = requiredDraft(draft, key, label).split(",").map((value) => value.trim()).filter(Boolean);
  if (values.length === 0 || new Set(values).size !== values.length) throw new Error(`${label}不能为空或重复。`);
  return values;
}

function approvalTarget(action: ActionType, selectedTargetId: string, payload: Row) {
  if (action === "PUBLISH_PRODUCT_VERSION") return String(payload.sku);
  if (action === "PUBLISH_ECONOMIC_POLICY") return `${String(payload.policyCode)}:${String(payload.versionNumber)}`;
  return selectedTargetId;
}

function buildCommandPayload(action: ActionType, selected: Row, draft: Record<string, string>): Row {
  const id = text(selected, "id"), version = Number(selected.version);
  if (action === "PUBLISH_PRODUCT_VERSION") return { hardwareClassId: requiredDraft(draft, "hardwareClassId", "硬件类别编号").toUpperCase(), sku: requiredDraft(draft, "sku", "SKU").toUpperCase(), manufacturer: requiredDraft(draft, "manufacturer", "制造商"), model: requiredDraft(draft, "model", "型号"), displayName: requiredDraft(draft, "displayName", "商品名称"), sellerName: requiredDraft(draft, "sellerName", "认证供应商"), gpuModel: requiredDraft(draft, "gpuModel", "GPU 型号"), hardwareTier: requiredDraft(draft, "hardwareTier", "硬件等级"), vramGb: integerDraft(draft, "vramGb", "显存 GB", 1), specs: jsonDraft(draft, "specs", "规格 JSON"), verifiedInventoryCount: integerDraft(draft, "verifiedInventoryCount", "已核验库存", 1), inventoryEvidenceDigest: requiredDraft(draft, "inventoryEvidenceDigest", "库存验真摘要"), currency: requiredDraft(draft, "currency", "币种"), warrantyMonths: integerDraft(draft, "warrantyMonths", "质保月数"), estimatedDeliveryDays: integerDraft(draft, "estimatedDeliveryDays", "预计交付天数"), fulfillmentModes: listDraft(draft, "fulfillmentModes", "履约方式"), facilityIds: draft.facilityIds?.trim() ? listDraft(draft, "facilityIds", "机房编号") : [], quoteValidUntil: isoDraft(draft, "quoteValidUntil", "报价有效期") };
  if (action === "ACTIVATE_FACILITY") return { expectedVersion: version, custodyTermsVersion: requiredDraft(draft, "custodyTermsVersion", "托管条款版本"), verificationEvidenceDigest: requiredDraft(draft, "verificationEvidenceDigest", "机房验收摘要") };
  if (action === "PUBLISH_ECONOMIC_POLICY") return { policyCode: requiredDraft(draft, "policyCode", "政策代码").toUpperCase(), versionNumber: integerDraft(draft, "versionNumber", "政策版本", 1), facilityId: requiredDraft(draft, "facilityId", "活动机房编号"), facilityChargeMicrosPerAssetDay: integerDraft(draft, "facilityChargeMicrosPerAssetDay", "每卡每日托管费"), calculation: jsonDraft(draft, "calculation", "计算说明 JSON"), effectiveFrom: isoDraft(draft, "effectiveFrom", "生效时间"), effectiveUntil: draft.effectiveUntil?.trim() ? isoDraft(draft, "effectiveUntil", "失效时间") : null };
  if (action === "ISSUE_QUOTE") return { expectedVersion: version, unitAmountMinor: integerDraft(draft, "unitAmountMinor", "单卡报价", 1), shippingMinor: integerDraft(draft, "shippingMinor", "寄送费用"), taxMinor: integerDraft(draft, "taxMinor", "税费"), otherMinor: integerDraft(draft, "otherMinor", "其他费用"), currency: requiredDraft(draft, "currency", "币种"), expiresAt: isoDraft(draft, "expiresAt", "报价有效期") };
  if (action === "RECORD_PAYMENT_EVIDENCE") return { orderId: id, provider: requiredDraft(draft, "provider", "收款银行或服务方"), providerReference: requiredDraft(draft, "providerReference", "银行流水引用"), eventType: requiredDraft(draft, "eventType", "付款事件"), amountMinor: integerDraft(draft, "amountMinor", "到账金额", 1), currency: requiredDraft(draft, "currency", "币种"), payloadDigest: requiredDraft(draft, "evidenceDigest", "付款证据摘要"), occurredAt: isoDraft(draft, "occurredAt", "到账时间") };
  if (action === "TRANSITION_ORDER") return { expectedVersion: version, toStatus: requiredDraft(draft, "toStatus", "订单目标状态") };
  if (action === "CREATE_ASSET") return { orderId: id, unitIndex: integerDraft(draft, "unitIndex", "订单内卡序号", 1), serialFingerprint: requiredDraft(draft, "serialFingerprint", "序列号摘要"), facilityId: draft.facilityId?.trim() || null, status: "EXPECTED" };
  if (action === "TRANSITION_ASSET") {
    const toStatus = requiredDraft(draft, "toStatus", "资产目标状态");
    return { expectedVersion: version, toStatus, evidenceDigest: requiredDraft(draft, "evidenceDigest", "操作证据摘要"), agentBindingId: draft.agentBindingId?.trim() || null, ...(toStatus === "DRAINING" ? { verifiedAt: isoDraft(draft, "verifiedAt", "Agent 排空验证时间"), allocationCount: 0, processCount: 0 } : {}) };
  }
  if (action === "CREATE_SETTLEMENT") return { assetId: id, periodStart: isoDraft(draft, "periodStart", "结算开始时间"), periodEnd: isoDraft(draft, "periodEnd", "结算结束时间"), policyVersionId: requiredDraft(draft, "policyVersionId", "结算政策版本"), sourceKey: requiredDraft(draft, "sourceKey", "结算来源编号") };
  if (action === "TRANSITION_SETTLEMENT") return { expectedStatus: text(selected, "status"), toStatus: requiredDraft(draft, "toStatus", "结算目标状态") };
  return { expectedVersion: version, evidenceDigest: requiredDraft(draft, "evidenceDigest", "寄送交接证据摘要") };
}

function ManagedGpuActionFields({ actionType, draft, selected, setDraft }: { actionType: ActionType; draft: Record<string, string>; selected: Row | null; setDraft: Dispatch<SetStateAction<Record<string, string>>> }) {
  const set = (key: string, value: string) => setDraft((current) => ({ ...current, [key]: value }));
  const input = (label: string, key: string, type: "text" | "number" | "datetime-local" = "text", placeholder = "") => <label><span>{label}</span><input min={type === "number" ? 0 : undefined} onChange={(event) => set(key, event.target.value)} placeholder={placeholder} type={type} value={draft[key] ?? ""} /></label>;
  if (actionType === "PUBLISH_PRODUCT_VERSION") return <>{input("硬件类别编号", "hardwareClassId", "text", "NVIDIA_DATACENTER")}{input("SKU", "sku", "text", "H200-NVL-141GB")}{input("制造商", "manufacturer", "text", "NVIDIA")}{input("硬件型号", "model")}{input("商品展示名称", "displayName")}{input("认证供应商", "sellerName")}{input("GPU 型号", "gpuModel")}<label><span>硬件等级</span><select onChange={(event) => set("hardwareTier", event.target.value)} value={draft.hardwareTier ?? "DATACENTER"}><option value="CONSUMER">消费级</option><option value="WORKSTATION">工作站级</option><option value="DATACENTER">数据中心级</option></select></label>{input("显存（GB）", "vramGb", "number")}{input("规格 JSON", "specs", "text", "{\"memory\":\"141GB\"}")}{input("已核验库存", "verifiedInventoryCount", "number")}{input("库存证据 SHA-256", "inventoryEvidenceDigest", "text", "64位十六进制摘要")}<label><span>币种</span><select onChange={(event) => set("currency", event.target.value)} value={draft.currency ?? "CNY"}><option>CNY</option><option>USD</option><option>HKD</option><option>SGD</option></select></label>{input("质保月数", "warrantyMonths", "number")}{input("预计交付天数", "estimatedDeliveryDays", "number")}{input("履约方式（逗号分隔）", "fulfillmentModes", "text", "BEIDOU_HOSTING,GLOBAL_SHIPPING")}{input("活动机房编号（逗号分隔）", "facilityIds")}{input("报价有效期", "quoteValidUntil", "datetime-local")}</>;
  if (actionType === "ACTIVATE_FACILITY") return <>{input("托管条款版本", "custodyTermsVersion", "text", "BEIDOU-CUSTODY-V1")}{input("机房验收证据 SHA-256", "verificationEvidenceDigest", "text", "64位十六进制摘要")}</>;
  if (actionType === "PUBLISH_ECONOMIC_POLICY") return <>{input("政策代码", "policyCode", "text", "BEIDOU-HOSTING")}{input("政策版本", "versionNumber", "number")}{input("活动机房编号", "facilityId")}{input("每卡每日托管费（卡时微单位）", "facilityChargeMicrosPerAssetDay", "number")}{input("计算说明 JSON", "calculation", "text", "{\"settlementCadence\":\"MONTHLY\"}")}{input("生效时间", "effectiveFrom", "datetime-local")}{input("失效时间（可留空）", "effectiveUntil", "datetime-local")}</>;
  if (actionType === "ISSUE_QUOTE") return <>{input("单卡报价（最小货币单位）", "unitAmountMinor", "number")}{input("寄送费用", "shippingMinor", "number")}{input("税费", "taxMinor", "number")}{input("其他费用", "otherMinor", "number")}<label><span>币种</span><select onChange={(event) => set("currency", event.target.value)} value={draft.currency ?? "CNY"}><option>CNY</option><option>USD</option><option>HKD</option><option>SGD</option></select></label>{input("报价有效期", "expiresAt", "datetime-local")}</>;
  if (actionType === "RECORD_PAYMENT_EVIDENCE") return <>{input("收款银行 / 服务方", "provider")}{input("银行流水引用", "providerReference")}<label><span>付款事件</span><select onChange={(event) => set("eventType", event.target.value)} value={draft.eventType ?? "CAPTURED"}><option value="CAPTURED">到账</option><option value="REFUNDED">退款</option><option value="CHARGEBACK">拒付</option><option value="REVERSAL">冲正</option></select></label>{input("金额（最小货币单位）", "amountMinor", "number")}<label><span>币种</span><select onChange={(event) => set("currency", event.target.value)} value={draft.currency ?? "CNY"}><option>CNY</option><option>USD</option><option>HKD</option><option>SGD</option></select></label>{input("付款证据 SHA-256", "evidenceDigest", "text", "64位十六进制摘要")}{input("到账时间", "occurredAt", "datetime-local")}</>;
  if (actionType === "TRANSITION_ORDER") return <StatusSelect label="订单目标状态" value={draft.toStatus ?? ""} values={nextOrderStatuses(text(selected ?? {}, "status"))} onChange={(value) => set("toStatus", value)} />;
  if (actionType === "CREATE_ASSET") return <>{input("订单内卡序号", "unitIndex", "number")}{input("序列号 SHA-256 摘要", "serialFingerprint", "text", "不填写明文序列号")}{input("机房编号（寄送可留空）", "facilityId")}</>;
  if (actionType === "TRANSITION_ASSET") return <><StatusSelect label="资产目标状态" value={draft.toStatus ?? ""} values={nextAssetStatuses(text(selected ?? {}, "status"))} onChange={(value) => set("toStatus", value)} />{input("操作证据 SHA-256", "evidenceDigest", "text", "64位十六进制摘要")}{input("Agent 绑定编号（按状态填写）", "agentBindingId")}{draft.toStatus === "DRAINING" ? input("Agent 排空验证时间", "verifiedAt", "datetime-local") : null}</>;
  if (actionType === "CREATE_SETTLEMENT") return <>{input("结算开始时间", "periodStart", "datetime-local")}{input("结算结束时间", "periodEnd", "datetime-local")}{input("结算政策版本", "policyVersionId")}{input("唯一结算来源编号", "sourceKey")}</>;
  if (actionType === "TRANSITION_SETTLEMENT") return <StatusSelect label="结算目标状态" value={draft.toStatus ?? ""} values={nextSettlementStatuses(text(selected ?? {}, "status"))} onChange={(value) => set("toStatus", value)} />;
  return <>{input("寄送交接证据 SHA-256", "evidenceDigest", "text", "64位十六进制摘要")}</>;
}

function StatusSelect({ label, value, values, onChange }: { label: string; value: string; values: string[]; onChange: (value: string) => void }) {
  return <label><span>{label}</span><select onChange={(event) => onChange(event.target.value)} value={values.includes(value) ? value : ""}><option value="">请选择</option>{values.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>;
}

function nextOrderStatuses(status: string) { return ({ REQUESTED: ["QUOTED", "CANCELLED"], QUOTED: ["AWAITING_PAYMENT", "CANCELLED"], AWAITING_PAYMENT: ["PAID", "CANCELLED", "DISPUTED"], PAID: ["PROCUREMENT", "DISPUTED", "REFUNDED"], PROCUREMENT: ["ASSET_ASSIGNED", "DISPUTED", "REFUNDED"], ASSET_ASSIGNED: ["FULFILLED", "DISPUTED", "REFUNDED"], DISPUTED: ["REFUNDED", "FULFILLED"] } as Record<string, string[]>)[status] ?? []; }
function nextAssetStatuses(status: string) { return ({ EXPECTED: ["RECEIVED"], RECEIVED: ["INSPECTING"], INSPECTING: ["VERIFIED"], VERIFIED: ["INSTALLED"], INSTALLED: ["ACTIVE", "MAINTENANCE", "DRAINING"], ACTIVE: ["MAINTENANCE", "DRAINING"], MAINTENANCE: ["ACTIVE", "DRAINING"], DRAINING: ["RETIRED"], SHIPPING: ["DELIVERED"], DELIVERED: ["RETIRED"] } as Record<string, string[]>)[status] ?? []; }
function nextSettlementStatuses(status: string) { return ({ REVIEW_REQUIRED: ["READY"], READY: ["APPROVED"], APPROVED: ["POSTED"] } as Record<string, string[]>)[status] ?? []; }

function micros(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? `${formatCardHourDisplayMicros(value)} 卡时` : "—";
}

function compactPayload(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "—";
  const serialized = JSON.stringify(value);
  return serialized.length > 240 ? `${serialized.slice(0, 237)}…` : serialized;
}
