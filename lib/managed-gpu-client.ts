import { DEFAULT_LOCALE, normalizeLocale, type Locale } from "@/lib/i18n";

export type ManagedGpuFacility = Readonly<{
  id: string;
  name: string;
  region: string;
  countryCode: string;
  status: string;
}>;

export type ManagedGpuProduct = Readonly<{
  id: string;
  hardwareClassId: string;
  sku: string;
  gpuModel: string;
  vramGb: number | null;
  sellerName: string;
  currency: string | null;
  unitPriceMinor: number | null;
  cardHourReferenceMicros: number | null;
  warrantyMonths: number | null;
  estimatedDeliveryDays: number | null;
  fulfillmentModes: readonly ("BEIDOU_HOSTING" | "GLOBAL_SHIPPING")[];
  facilityIds: readonly string[];
  utilization7dBps: number | null;
  utilization30dBps: number | null;
  status: "QUOTE_REQUIRED" | "AVAILABLE" | "PAUSED";
  quoteValidUntil: string | null;
}>;

export type ManagedGpuCatalogEnvelope = Readonly<{
  enabled: boolean;
  available: boolean;
  records: readonly ManagedGpuProduct[];
  facilities: readonly ManagedGpuFacility[];
  servedAt?: string;
}>;

export type ManagedGpuOrderSummary = Readonly<{
  id: string;
  productVersionId: string;
  quantity: number;
  fulfillmentChoice: "BEIDOU_HOSTING" | "GLOBAL_SHIPPING";
  status: string;
  createdAt: string;
  updatedAt: string;
}>;

export type ManagedGpuQuoteSummary = Readonly<{
  id: string;
  productVersionId: string;
  quantity: number;
  fulfillmentChoice: "BEIDOU_HOSTING" | "GLOBAL_SHIPPING";
  status: "REQUESTED" | "ISSUED" | "ACCEPTED" | "EXPIRED" | "CANCELLED";
  issuedCurrency: string | null;
  totalAmountMinor: number | null;
  expiresAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}>;

export type ManagedGpuAssetSummary = Readonly<{
  id: string;
  productVersionId: string;
  serialFingerprint: string;
  facilityId: string | null;
  status: string;
  agentBindingId: string | null;
  updatedAt: string;
}>;

export type ManagedGpuSettlementSummary = Readonly<{
  id: string;
  periodStart: string;
  periodEnd: string;
  status: string;
  grossCardHourMicros: number;
  refundCardHourMicros: number;
  platformFeeMicros: number;
  wearMicros: number;
  facilityChargeMicros: number;
  earnedCardHourMicros: number;
  totalChargeMicros: number;
  appliedDeductionMicros: number;
  shortfallMicros: number;
  netCardHourMicros: number;
  outstandingFeeId: string | null;
  outstandingFeeStatus: "PENDING" | "PAID" | "OVERDUE" | null;
  outstandingFeeDueAt: string | null;
}>;

export type ManagedGpuMemberSummary = Readonly<{
  enabled: boolean;
  organizationId: string;
  organizationName: string | null;
  orderCount: number;
  assetCount: number;
  activeAssetCount: number;
  settlementCount: number;
  orders: readonly ManagedGpuOrderSummary[];
  assets: readonly ManagedGpuAssetSummary[];
  settlements: readonly ManagedGpuSettlementSummary[];
  provisionalIncomeCardHourMicros: number;
  confirmedIncomeCardHourMicros: number;
  incomeUnit: "CARD_HOUR_MICROS";
  withdrawable: false;
  transferable: false;
  updatedAt: string;
}>;

export type ManagedGpuRecordsEnvelope<T> = Readonly<{ records: readonly T[]; count: number }>;

type ManagedGpuErrorCode = "AUTHENTICATION_REQUIRED" | "FORBIDDEN" | "MANAGED_GPU_DISABLED" | "MANAGED_GPU_INVITATION_REQUIRED" | "NOT_FOUND";
type ManagedGpuErrorCopy = Readonly<{ generic: string; requestId: string; codes: Readonly<Record<ManagedGpuErrorCode, string>> }>;

const MANAGED_GPU_ERROR_COPY: Record<Locale, ManagedGpuErrorCopy> = {
  "zh-CN": { generic: "GPU 云托管服务暂时无法读取。", requestId: "请求编号", codes: { AUTHENTICATION_REQUIRED: "请先登录后查看 GPU 云托管。", FORBIDDEN: "当前账户无权查看这项 GPU 云托管数据。", MANAGED_GPU_DISABLED: "GPU 云托管当前未开放。", MANAGED_GPU_INVITATION_REQUIRED: "当前组织尚未获得 GPU 云托管邀请。", NOT_FOUND: "未找到对应的 GPU 云托管记录。" } },
  "zh-TW": { generic: "目前無法讀取 GPU 雲端託管服務。", requestId: "請求編號", codes: { AUTHENTICATION_REQUIRED: "請先登入再查看 GPU 雲端託管。", FORBIDDEN: "目前帳戶無權查看此 GPU 雲端託管資料。", MANAGED_GPU_DISABLED: "GPU 雲端託管目前未開放。", MANAGED_GPU_INVITATION_REQUIRED: "目前組織尚未獲得 GPU 雲端託管邀請。", NOT_FOUND: "找不到對應的 GPU 雲端託管記錄。" } },
  en: { generic: "Managed GPU data is temporarily unavailable.", requestId: "Request ID", codes: { AUTHENTICATION_REQUIRED: "Sign in to view managed GPU data.", FORBIDDEN: "This account cannot access the requested managed GPU data.", MANAGED_GPU_DISABLED: "Managed GPU is not available.", MANAGED_GPU_INVITATION_REQUIRED: "This organization has not been invited to Managed GPU.", NOT_FOUND: "The requested managed GPU record was not found." } },
  ja: { generic: "GPU 運用サービスは一時的に利用できません。", requestId: "リクエスト ID", codes: { AUTHENTICATION_REQUIRED: "GPU 運用を表示するにはログインしてください。", FORBIDDEN: "この GPU 運用データを表示する権限がありません。", MANAGED_GPU_DISABLED: "GPU 運用は現在利用できません。", MANAGED_GPU_INVITATION_REQUIRED: "この組織は GPU 運用に招待されていません。", NOT_FOUND: "GPU 運用レコードが見つかりません。" } },
  ko: { generic: "GPU 호스팅 데이터를 일시적으로 불러올 수 없습니다.", requestId: "요청 ID", codes: { AUTHENTICATION_REQUIRED: "GPU 호스팅을 보려면 로그인하세요.", FORBIDDEN: "이 GPU 호스팅 데이터에 접근할 권한이 없습니다.", MANAGED_GPU_DISABLED: "GPU 호스팅을 현재 사용할 수 없습니다.", MANAGED_GPU_INVITATION_REQUIRED: "현재 조직은 GPU 호스팅 초대를 받지 않았습니다.", NOT_FOUND: "GPU 호스팅 기록을 찾을 수 없습니다." } },
  fr: { generic: "Les données GPU hébergées sont momentanément indisponibles.", requestId: "ID de requête", codes: { AUTHENTICATION_REQUIRED: "Connectez-vous pour consulter les GPU hébergés.", FORBIDDEN: "Ce compte ne peut pas consulter ces données GPU.", MANAGED_GPU_DISABLED: "L’hébergement GPU n’est pas disponible.", MANAGED_GPU_INVITATION_REQUIRED: "Cette organisation n’a pas été invitée à l’hébergement GPU.", NOT_FOUND: "L’enregistrement GPU demandé est introuvable." } },
  th: { generic: "ข้อมูล GPU ที่ฝากไว้ไม่พร้อมใช้งานชั่วคราว", requestId: "รหัสคำขอ", codes: { AUTHENTICATION_REQUIRED: "โปรดเข้าสู่ระบบเพื่อดู GPU ที่ฝากไว้", FORBIDDEN: "บัญชีนี้ไม่มีสิทธิ์ดูข้อมูล GPU นี้", MANAGED_GPU_DISABLED: "บริการฝาก GPU ยังไม่เปิดใช้", MANAGED_GPU_INVITATION_REQUIRED: "องค์กรนี้ยังไม่ได้รับเชิญให้ใช้บริการฝาก GPU", NOT_FOUND: "ไม่พบรายการ GPU ที่ร้องขอ" } },
  vi: { generic: "Dữ liệu GPU lưu ký tạm thời không khả dụng.", requestId: "ID yêu cầu", codes: { AUTHENTICATION_REQUIRED: "Hãy đăng nhập để xem GPU lưu ký.", FORBIDDEN: "Tài khoản này không thể truy cập dữ liệu GPU đó.", MANAGED_GPU_DISABLED: "Dịch vụ lưu ký GPU chưa khả dụng.", MANAGED_GPU_INVITATION_REQUIRED: "Tổ chức này chưa được mời dùng dịch vụ lưu ký GPU.", NOT_FOUND: "Không tìm thấy bản ghi GPU được yêu cầu." } },
  id: { generic: "Data GPU hosting sementara tidak tersedia.", requestId: "ID permintaan", codes: { AUTHENTICATION_REQUIRED: "Masuk untuk melihat GPU hosting.", FORBIDDEN: "Akun ini tidak dapat mengakses data GPU tersebut.", MANAGED_GPU_DISABLED: "GPU hosting belum tersedia.", MANAGED_GPU_INVITATION_REQUIRED: "Organisasi ini belum diundang ke GPU hosting.", NOT_FOUND: "Catatan GPU yang diminta tidak ditemukan." } },
  ms: { generic: "Data GPU hos tidak tersedia sementara.", requestId: "ID permintaan", codes: { AUTHENTICATION_REQUIRED: "Log masuk untuk melihat GPU hos.", FORBIDDEN: "Akaun ini tidak boleh mengakses data GPU tersebut.", MANAGED_GPU_DISABLED: "GPU hos belum tersedia.", MANAGED_GPU_INVITATION_REQUIRED: "Organisasi ini belum dijemput ke GPU hos.", NOT_FOUND: "Rekod GPU yang diminta tidak ditemui." } },
};

const MANAGED_GPU_ERROR_CODES = new Set<ManagedGpuErrorCode>(["AUTHENTICATION_REQUIRED", "FORBIDDEN", "MANAGED_GPU_DISABLED", "MANAGED_GPU_INVITATION_REQUIRED", "NOT_FOUND"]);

function safeRequestId(value: unknown) {
  return typeof value === "string" && /^[A-Za-z0-9._:-]{1,128}$/.test(value) ? value : undefined;
}

export function managedGpuSafeErrorMessage(locale: Locale, error: unknown) {
  const copy = MANAGED_GPU_ERROR_COPY[locale];
  const envelope = error && typeof error === "object" && !Array.isArray(error) ? error as Record<string, unknown> : {};
  const rawCode = typeof envelope.code === "string" ? envelope.code : "";
  const code = MANAGED_GPU_ERROR_CODES.has(rawCode as ManagedGpuErrorCode) ? rawCode as ManagedGpuErrorCode : null;
  const requestId = safeRequestId(envelope.requestId);
  return `${code ? copy.codes[code] : copy.generic}${requestId ? ` (${copy.requestId}: ${requestId})` : ""}`;
}

function browserLocale() {
  return typeof document === "undefined" ? DEFAULT_LOCALE : normalizeLocale(document.documentElement.lang);
}

export async function readManagedGpuJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, { cache: "no-store", credentials: "same-origin", signal });
  const body = await response.json().catch(() => null) as ({ error?: { code?: unknown; requestId?: unknown } } & T) | null;
  if (!response.ok || body === null) throw new Error(managedGpuSafeErrorMessage(browserLocale(), body?.error));
  return body;
}

export function formatMoneyMinor(minor: number, currency: string) {
  return new Intl.NumberFormat("zh-CN", { style: "currency", currency, minimumFractionDigits: 2 }).format(minor / 100);
}

export function formatUtilizationBps(value: number | null) {
  return value === null ? "尚无真实数据" : `${(value / 100).toFixed(2)}%`;
}

export function managedGpuStatusLabel(value: string) {
  const labels: Record<string, string> = {
    DRAFT: "草稿", QUOTED: "已报价", COMPLIANCE_PENDING: "合规审核中", COMPLIANCE_APPROVED: "合规已通过",
    REQUESTED: "已提交", AWAITING_PAYMENT: "待向供应商银行付款", PAID: "银行付款已确认",
    AWAITING_BANK_PAYMENT: "待向供应商银行付款", PAYMENT_CONFIRMED: "付款已人工确认", PROCUREMENT: "采购中",
    ASSET_ASSIGNED: "已分配实体 GPU", FULFILLED: "交付完成", FULFILLMENT_SELECTED: "已选择交付", COMPLETED: "已完成", CANCELLED: "已取消", DISPUTED: "争议处理中", REFUNDED: "已退款",
    EXPECTED: "待到货", RECEIVED: "已收货", INSPECTING: "验收中", VERIFIED: "已验证", INSTALLED: "已安装",
    ACTIVE: "运营中", MAINTENANCE: "维护中", DRAINING: "退出排空中", SHIPPING: "寄送中", DELIVERED: "已送达", REMOVED: "已拆机", SHIPPED: "已寄送",
    RETIRED: "已退役", OPEN: "待计算", HOURLY_PROVISIONAL: "小时暂估", DAILY_CONFIRMED: "每日确认",
    MONTHLY_CALCULATED: "月度已计算", REVIEW_REQUIRED: "待复核", READY: "待审批", APPROVED: "已审批", POSTED: "已入账",
    REVERSED: "已冲正",
    ONLINE: "在线", OFFLINE: "离线", UNBOUND: "未绑定 Agent", DEGRADED: "状态异常",
  };
  return labels[value] ?? value;
}
