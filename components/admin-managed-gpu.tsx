"use client";

import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { AdminApiError, adminGetJson, adminPostAction } from "@/components/admin-api-client";
import { AdminPageHeader } from "@/components/admin-page-header";
import { AdminEmpty, AdminError, AdminLoading } from "@/components/admin-states";
import { useLocale } from "@/components/locale-provider";
import { formatCardHourDisplayMicros } from "@/lib/card-hours";
import type { Locale } from "@/lib/i18n";

type Row = Record<string, unknown>;
type Overview = { products: Row[]; facilities: Row[]; economicPolicies: Row[]; quotes: Row[]; orders: Row[]; assets: Row[]; settlements: Row[]; serviceRequests: Row[]; approvals: Row[]; counts?: Record<string, number> };
type ActionType = "PUBLISH_PRODUCT_VERSION" | "ACTIVATE_FACILITY" | "PUBLISH_ECONOMIC_POLICY" | "ISSUE_QUOTE" | "RECORD_PAYMENT_EVIDENCE" | "TRANSITION_ORDER" | "CREATE_ASSET" | "TRANSITION_ASSET" | "CREATE_SETTLEMENT" | "TRANSITION_SETTLEMENT" | "SHIP_ASSET";
const ACTIONS_ZH: Record<ActionType, string> = { PUBLISH_PRODUCT_VERSION: "上线已核验 GPU 商品", ACTIVATE_FACILITY: "验收并启用托管机房", PUBLISH_ECONOMIC_POLICY: "发布托管结算政策", ISSUE_QUOTE: "发出正式报价", RECORD_PAYMENT_EVIDENCE: "录入供应商银行付款证据", TRANSITION_ORDER: "推进购买订单", CREATE_ASSET: "分配实体 GPU", TRANSITION_ASSET: "推进验收 / 托管状态", CREATE_SETTLEMENT: "创建月度卡时结算", TRANSITION_SETTLEMENT: "推进月结审批 / 入账", SHIP_ASSET: "执行实体 GPU 寄送" };
const ACTIONS_EN: Record<ActionType, string> = { PUBLISH_PRODUCT_VERSION: "Publish verified GPU product", ACTIVATE_FACILITY: "Verify and activate facility", PUBLISH_ECONOMIC_POLICY: "Publish settlement policy", ISSUE_QUOTE: "Issue formal quote", RECORD_PAYMENT_EVIDENCE: "Record supplier bank-payment evidence", TRANSITION_ORDER: "Advance purchase order", CREATE_ASSET: "Assign physical GPU", TRANSITION_ASSET: "Advance verification / hosting state", CREATE_SETTLEMENT: "Create monthly card-hour settlement", TRANSITION_SETTLEMENT: "Advance settlement approval / posting", SHIP_ASSET: "Ship physical GPU" };
type ManagedGpuCopy = { actions: Record<ActionType,string>; title:string; description:string; loading:string; refresh:string; safeError:string; requestId:string; labels:Record<string,string>; approved:string; rejected:string; submitted:string; executed:string; selectRecord:string; approvalUpdated:string; emptyRecords:string; emptyPrefix:string };
const LABELS_EN: Record<string,string> = {
  "报价申请":"Quote requests","购买订单":"Purchase orders","实体 GPU":"Physical GPUs","退出 / 寄送":"Exit / shipping","等待企业审核或供应商正式报价":"Awaiting business review or supplier quote","银行付款不得由页面自行确认":"Bank payment cannot be confirmed by this page","一张卡、一个所有者、一个序列号摘要":"One card, one owner, one serial digest","退出需提前30天并完成排空清算":"Exit requires 30-day notice and drain settlement","双人审批工作流":"Dual-control workflow","运营动作工作台":"Operations action desk","先由操作员填写真实凭证并提交审批；另一位管理员批准后，必须回到审批队列点击执行。批准本身不会改业务状态。":"An operator submits real evidence; another administrator approves it, then the requester executes from the approval queue. Approval alone never changes business state.","证据字段只接收 SHA-256 摘要，不得粘贴合同、银行回单、序列号、地址、私钥或其他敏感原文。":"Evidence fields accept SHA-256 digests only. Never paste contracts, bank receipts, serials, addresses, private keys, or other sensitive source text.","处理动作":"Action","需要处理的记录":"Target record","请选择":"Select","提交中…":"Submitting…","提交双人审批":"Submit dual approval","双人审批队列":"Dual-approval queue","审批":"Approval","动作":"Action","目标":"Target","申请人":"Requester","待执行内容":"Pending command","状态":"Status","申请时间":"Requested","操作":"Action","处理中…":"Processing…","批准":"Approve","拒绝":"Reject","执行中…":"Executing…","执行已批准动作":"Execute approved action","暂无双人审批":"No dual approvals","高风险命令提交审批后会出现在这里；申请人不能审批自己的命令。":"High-risk commands appear here after submission; requesters cannot approve their own commands.","云托管商品版本":"Hosted product versions","托管机房":"Hosting facilities","托管结算政策":"Hosting settlement policies","实体 GPU 购买订单":"Physical GPU purchase orders","实体 GPU 资产":"Physical GPU assets","托管卡时结算":"Hosted card-hour settlements","退出与全球寄送申请":"Exit and global shipping requests","管理员不能输入或承诺固定收益，不能把卡时设置为可提现，也不能在缺少银行到账证据、机房验收证据或真实算力成交时跳过状态。":"Administrators cannot enter or promise fixed returns, make card-hours withdrawable, or skip states without bank, facility, and real compute-sale evidence.","没有使用演示数据填充页面。":"No demo data is used to populate this page.","暂无 GPU 云托管运营数据":"No managed GPU operations data","服务端没有返回记录，页面未生成模拟条目。":"The server returned no records; no simulated rows were generated.","结算":"Settlement","资产":"Asset","周期":"Period","毛产出":"Gross output","平台费":"Platform fee","磨损":"Wear","托管费":"Hosting fee","净入账":"Net credit","无真实成交或尚未完成每日确认时，不会生成可入账结算。":"No postable settlement is created without real sales and completed daily confirmation.","暂无托管卡时结算":"No hosted card-hour settlements","商品版本":"Product version","供应商":"Supplier","真实库存":"Verified inventory","上线时间":"Published","机房":"Facility","名称":"Name","地区":"Region","托管条款":"Custody terms","版本":"Version","政策版本":"Policy version","政策代码":"Policy code","每日托管费（卡时微单位）":"Daily hosting fee (card-hour micros)","生效时间":"Effective from","订单":"Order","组织":"Organization","商品":"Product","数量":"Quantity","交付":"Fulfillment","更新时间":"Updated","所有者组织":"Owner organization","序列号摘要":"Serial digest","申请":"Request","类型":"Type","国家/地区":"Country/region","创建时间":"Created"
};
const BASE_EN: ManagedGpuCopy = { actions:ACTIONS_EN,title:"Managed GPU Operations",description:"View physical GPU quotes, supplier bank payments, ownership, facility hosting, monthly card-hour settlement, exits, and shipping. High-risk actions require server-side dual control.",loading:"Loading managed GPU operations…",refresh:"Refresh live data",safeError:"Managed GPU data is temporarily unavailable.",requestId:"Request ID",labels:LABELS_EN,approved:"Dual approval granted; the original requester may execute the command.",rejected:"Approval rejected; the command cannot execute.",submitted:"{action} submitted for dual approval. A different authorized administrator must review it.",executed:"{action} executed; approval consumed and business data refreshed.",selectRecord:"Select a record to process.",approvalUpdated:"Approval updated",emptyRecords:"The server returned no records; no simulated rows were generated.",emptyPrefix:"No " };
const MANAGED_GPU_COPY = {
  "zh-CN": { ...BASE_EN,actions:ACTIONS_ZH,title:"GPU 云托管运营",description:"统一查看实体 GPU 报价、供应商银行付款、整卡确权、机房托管、月度卡时结算与退出寄送。高风险动作必须由服务端双人审批。",loading:"正在读取 GPU 云托管运营数据…",refresh:"刷新真实数据",safeError:"GPU 云托管数据暂时无法读取。",requestId:"请求编号",labels:{},approved:"双人审批已通过；原申请管理员可使用该审批执行对应命令。",rejected:"审批已拒绝，命令不能执行。",submitted:"{action}已提交双人审批。请由另一位具备相应权限的管理员复核。",executed:"{action}已执行，审批已核销，业务数据已重新读取。",selectRecord:"请先选择需要处理的记录。",approvalUpdated:"审批已更新",emptyRecords:"服务端没有返回记录，页面未生成模拟条目。",emptyPrefix:"暂无" },
  "zh-TW": { ...BASE_EN,actions:ACTIONS_ZH,title:"GPU 雲端託管營運",description:"統一查看實體 GPU 報價、銀行付款、確權、機房託管、月度卡時結算與退出寄送。高風險動作必須雙人審批。",loading:"正在讀取 GPU 託管營運資料…",refresh:"重新整理真實資料",safeError:"暫時無法讀取 GPU 託管資料。",requestId:"請求編號",labels:{},approved:"雙人審批已通過；原申請管理員可執行命令。",rejected:"審批已拒絕，命令不能執行。",submitted:"{action}已提交雙人審批，請由另一位授權管理員覆核。",executed:"{action}已執行，審批已核銷並重新讀取資料。",selectRecord:"請先選擇需要處理的記錄。",approvalUpdated:"審批已更新",emptyRecords:"服務端沒有返回記錄，頁面未產生模擬項目。",emptyPrefix:"暫無" },
  en: BASE_EN,
  ja: { ...BASE_EN,title:"GPU ホスティング運用",description:"物理 GPU の見積、銀行支払い、所有権、施設、月次カード時決済、退出・配送を管理します。高リスク操作は二人承認が必要です。",loading:"GPU 運用データを読込中…",refresh:"実データを更新",safeError:"GPU 運用データを取得できません。",requestId:"リクエスト ID" },
  ko: { ...BASE_EN,title:"GPU 호스팅 운영",description:"실물 GPU 견적, 은행 결제, 소유권, 시설 호스팅, 월별 카드시간 정산 및 배송을 관리합니다. 고위험 작업에는 이중 승인이 필요합니다.",loading:"GPU 운영 데이터 로딩 중…",refresh:"실제 데이터 새로고침",safeError:"GPU 운영 데이터를 불러올 수 없습니다.",requestId:"요청 ID" },
  fr: { ...BASE_EN,title:"Opérations GPU hébergées",description:"Gérer devis, paiements bancaires, propriété, hébergement, règlements mensuels, sorties et expéditions. Les actions à risque exigent un double contrôle.",loading:"Chargement des opérations GPU…",refresh:"Actualiser les données",safeError:"Les données GPU sont indisponibles.",requestId:"ID de requête" },
  th: { ...BASE_EN,title:"การดำเนินงาน GPU แบบโฮสต์",description:"จัดการราคา การชำระผ่านธนาคาร สิทธิ์เจ้าของ ศูนย์ข้อมูล การชำระรายเดือน การออกและจัดส่ง งานเสี่ยงสูงต้องอนุมัติสองคน",loading:"กำลังโหลดข้อมูล GPU…",refresh:"รีเฟรชข้อมูลจริง",safeError:"ไม่สามารถอ่านข้อมูล GPU ได้",requestId:"รหัสคำขอ" },
  vi: { ...BASE_EN,title:"Vận hành GPU lưu trữ",description:"Quản lý báo giá, thanh toán ngân hàng, quyền sở hữu, lưu trữ, quyết toán tháng, rút và vận chuyển. Thao tác rủi ro cần hai người duyệt.",loading:"Đang tải dữ liệu GPU…",refresh:"Làm mới dữ liệu thật",safeError:"Không thể đọc dữ liệu GPU.",requestId:"ID yêu cầu" },
  id: { ...BASE_EN,title:"Operasi GPU Terkelola",description:"Kelola penawaran, pembayaran bank, kepemilikan, fasilitas, penyelesaian bulanan, keluar dan pengiriman. Tindakan berisiko memerlukan kontrol ganda.",loading:"Memuat data GPU…",refresh:"Muat ulang data nyata",safeError:"Data GPU tidak tersedia.",requestId:"ID permintaan" },
  ms: { ...BASE_EN,title:"Operasi GPU Terurus",description:"Urus sebut harga, bayaran bank, pemilikan, kemudahan, penyelesaian bulanan, keluar dan penghantaran. Tindakan berisiko memerlukan kawalan dua pihak.",loading:"Memuatkan data GPU…",refresh:"Muat semula data sebenar",safeError:"Data GPU tidak tersedia.",requestId:"ID permintaan" },
} satisfies Record<Locale,ManagedGpuCopy>;
const tr = (copy: ManagedGpuCopy, value: string) => copy.labels[value] ?? value;
const array = (value: unknown) => Array.isArray(value) ? value.filter((item): item is Row => Boolean(item) && typeof item === "object" && !Array.isArray(item)) : [];
const text = (row: Row, key: string) => row[key] == null ? "—" : String(row[key]);
const dateTime = (value: unknown, locale: Locale = "zh-CN") => typeof value === "string" && !Number.isNaN(Date.parse(value)) ? new Date(value).toLocaleString(locale) : "—";
class ManagedGpuInputError extends Error {}
function managedGpuError(error: unknown, copy: ManagedGpuCopy) {
  if (error instanceof ManagedGpuInputError) return error.message;
  const requestId = error instanceof AdminApiError ? error.requestId : undefined;
  return `${copy.safeError}${requestId ? ` (${copy.requestId}: ${requestId})` : ""}`;
}

export function AdminManagedGpu() {
  const { locale } = useLocale(); const copy = MANAGED_GPU_COPY[locale];
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
      setNotice(decision === "approve" ? copy.approved : copy.rejected);
      await load();
    } catch (reason) { setError(reason); }
    finally { setBusyApprovalId(""); }
  }

  const targetRows = data ? rowsForAction(data, actionType) : [];
  const selectedTarget = targetRows.find((row) => text(row, "id") === targetId) ?? null;

  async function requestActionApproval() {
    if (!selectedTarget) { setError(new ManagedGpuInputError(copy.selectRecord)); return; }
    setBusyAction(true); setError(null); setNotice("");
    try {
      const commandPayload = buildCommandPayload(actionType, selectedTarget, draft);
      await adminPostAction("/api/v1/admin/managed-gpu/approvals", { actionType, targetId: approvalTarget(actionType, targetId, commandPayload), commandPayload });
      setNotice(copy.submitted.replace("{action}", copy.actions[actionType]));
      await load();
    } catch (reason) { setError(reason); }
    finally { setBusyAction(false); }
  }

  async function executeApproved(row: Row) {
    const id = text(row, "id"), type = text(row, "actionType") as ActionType, target = text(row, "targetId");
    if (!(type in copy.actions) || id === "—" || target === "—" || !row.commandPayload || typeof row.commandPayload !== "object") return;
    setBusyApprovalId(id); setError(null); setNotice("");
    try {
      await adminPostAction(actionEndpoint(type, target), row.commandPayload, "POST", id);
      setNotice(copy.executed.replace("{action}", copy.actions[type]));
      await load();
    } catch (reason) { setError(reason); }
    finally { setBusyApprovalId(""); }
  }

  return <div className="admin-page">
    <AdminPageHeader actions={<button className="admin-button secondary" disabled={loading} onClick={() => void load()} type="button">{loading ? tr(copy,"读取中…") : copy.refresh}</button>} description={copy.description} kicker="Managed physical GPU" title={copy.title} />
    {loading && !data ? <AdminLoading label={copy.loading} /> : null}
    {error ? <AdminError message={managedGpuError(error, copy)} onRetry={() => void load()} /> : null}
    {data ? <>
      <section className="admin-metric-grid">
        <article className="admin-metric-card"><span>{tr(copy,"报价申请")}</span><strong>{data.quotes.length}</strong><small>{tr(copy,"等待企业审核或供应商正式报价")}</small></article>
        <article className="admin-metric-card"><span>{tr(copy,"购买订单")}</span><strong>{data.orders.length}</strong><small>{tr(copy,"银行付款不得由页面自行确认")}</small></article>
        <article className="admin-metric-card"><span>{tr(copy,"实体 GPU")}</span><strong>{data.assets.length}</strong><small>{tr(copy,"一张卡、一个所有者、一个序列号摘要")}</small></article>
        <article className="admin-metric-card"><span>{tr(copy,"退出 / 寄送")}</span><strong>{data.serviceRequests.length}</strong><small>{tr(copy,"退出需提前30天并完成排空清算")}</small></article>
      </section>
      {notice ? <div className="admin-inline-success" role="status"><strong>{copy.approvalUpdated}</strong><span>{notice}</span></div> : null}
      <section className="admin-action-panel" aria-labelledby="managed-gpu-action-title">
        <div><p className="admin-kicker">{tr(copy,"双人审批工作流")}</p><h2 id="managed-gpu-action-title">{tr(copy,"运营动作工作台")}</h2><span>{tr(copy,"先由操作员填写真实凭证并提交审批；另一位管理员批准后，必须回到审批队列点击执行。批准本身不会改业务状态。")}</span><p className="admin-inline-warning">{tr(copy,"证据字段只接收 SHA-256 摘要，不得粘贴合同、银行回单、序列号、地址、私钥或其他敏感原文。")}</p></div>
        <div className="admin-action-fields">
          <label><span>{tr(copy,"处理动作")}</span><select value={actionType} onChange={(event) => { setActionType(event.target.value as ActionType); setTargetId(""); setDraft((current) => ({ currency: current.currency ?? "CNY", eventType: current.eventType ?? "CAPTURED", provider: current.provider ?? "供应商银行", unitIndex: current.unitIndex ?? "1" })); }}>{Object.entries(copy.actions).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label><span>{tr(copy,"需要处理的记录")}</span><select value={targetId} onChange={(event) => setTargetId(event.target.value)}><option value="">{tr(copy,"请选择")}</option>{targetRows.map((row) => <option key={text(row, "id")} value={text(row, "id")}>{recordOption(row)}</option>)}</select></label>
          <ManagedGpuActionFields actionType={actionType} copy={copy} draft={draft} selected={selectedTarget} setDraft={setDraft} />
          <button className="admin-button primary" disabled={busyAction || !selectedTarget} onClick={() => void requestActionApproval()} type="button">{busyAction ? tr(copy,"提交中…") : tr(copy,"提交双人审批")}</button>
        </div>
      </section>
      <section className="admin-table-wrap"><table className="admin-table"><caption>{tr(copy,"双人审批队列")}</caption><thead><tr>{["审批","动作","目标","申请人","待执行内容","状态","申请时间","操作"].map((label) => <th key={label}>{tr(copy,label)}</th>)}</tr></thead><tbody>{data.approvals.map((row) => <tr key={text(row, "id")}><td className="admin-mono">{text(row, "id")}</td><td>{copy.actions[text(row, "actionType") as ActionType] ?? text(row, "actionType")}</td><td className="admin-mono">{text(row, "targetId")}</td><td className="admin-mono">{text(row, "requesterAccountId")}</td><td><code>{compactPayload(row.commandPayload)}</code></td><td><span className="admin-status neutral">{text(row, "status")}</span></td><td>{dateTime(row.requestedAt,locale)}</td><td>{text(row, "status") === "REQUESTED" ? <div className="admin-row-actions"><button className="admin-button primary" disabled={Boolean(busyApprovalId)} onClick={() => void decideApproval(row, "approve")} type="button">{busyApprovalId === text(row, "id") ? tr(copy,"处理中…") : tr(copy,"批准")}</button><button className="admin-button danger" disabled={Boolean(busyApprovalId)} onClick={() => void decideApproval(row, "reject")} type="button">{tr(copy,"拒绝")}</button></div> : text(row, "status") === "APPROVED" ? <button className="admin-button primary" disabled={Boolean(busyApprovalId)} onClick={() => void executeApproved(row)} type="button">{busyApprovalId === text(row, "id") ? tr(copy,"执行中…") : tr(copy,"执行已批准动作")}</button> : "—"}</td></tr>)}</tbody></table>{data.approvals.length === 0 ? <AdminEmpty description={tr(copy,"高风险命令提交审批后会出现在这里；申请人不能审批自己的命令。")} title={tr(copy,"暂无双人审批")} /> : null}</section>
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

function ManagedGpuActionFields({ actionType, copy, draft, selected, setDraft }: { actionType: ActionType; copy: ManagedGpuCopy; draft: Record<string, string>; selected: Row | null; setDraft: Dispatch<SetStateAction<Record<string, string>>> }) {
  const set = (key: string, value: string) => setDraft((current) => ({ ...current, [key]: value }));
  const input = (label: string, key: string, type: "text" | "number" | "datetime-local" = "text", placeholder = "") => <label><span>{tr(copy,label)}</span><input min={type === "number" ? 0 : undefined} onChange={(event) => set(key, event.target.value)} placeholder={placeholder} type={type} value={draft[key] ?? ""} /></label>;
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
