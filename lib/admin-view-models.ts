export type AdminSectionKey =
  | "work-items"
  | "supply-offers"
  | "demands"
  | "matches"
  | "pools"
  | "verifications"
  | "orders"
  | "payments"
  | "delivery"
  | "exceptions"
  | "accounts"
  | "admins"
  | "audit";

export type AdminFieldFormat = "text" | "id" | "status" | "number" | "money" | "datetime" | "duration";

export type AdminField = Readonly<{
  label: string;
  paths: readonly string[];
  format?: AdminFieldFormat;
  width?: string;
}>;

export type AdminAction = Readonly<{
  value: string;
  label: string;
  highRisk?: boolean;
}>;

export type AdminEndpoint = Readonly<{
  path: string;
  source?: string;
  fallbackPath?: string;
  projection?: "delivery" | "exceptions";
}>;

export type AdminSectionConfig = Readonly<{
  key: AdminSectionKey;
  title: string;
  kicker: string;
  description: string;
  endpoints: readonly AdminEndpoint[];
  fields: readonly AdminField[];
  filters: readonly string[];
  emptyTitle: string;
  emptyDescription: string;
  actions: readonly AdminAction[];
  actionEndpoint?: string;
}>;

export const adminSectionConfigs: Record<AdminSectionKey, AdminSectionConfig> = {
  "work-items": {
    key: "work-items",
    title: "运营待办",
    kicker: "Operations inbox",
    description: "集中处理即将超时、尚未认领和需要跨团队协作的运营任务。",
    endpoints: [{ path: "/api/v1/admin/work-items" }],
    fields: [
      { label: "任务", paths: ["title", "summary", "type"] },
      { label: "关联对象", paths: ["objectId", "targetId", "resourceId"], format: "id" },
      { label: "优先级", paths: ["priority", "severity"], format: "status" },
      { label: "状态", paths: ["status"], format: "status" },
      { label: "负责人", paths: ["assigneeName", "assignee", "ownerName", "owner"] },
      { label: "SLA 截止", paths: ["dueAt", "slaDueAt"], format: "datetime" },
      { label: "更新时间", paths: ["updatedAt", "createdAt"], format: "datetime" },
    ],
    filters: ["状态", "优先级", "负责人", "SLA"],
    emptyTitle: "当前没有运营待办",
    emptyDescription: "接口返回了空列表，没有用演示任务填充页面。",
    actions: [
      { value: "MARK_WAITING", label: "标记等待外部处理" },
      { value: "RESOLVE", label: "标记已解决", highRisk: true },
    ],
    actionEndpoint: "/api/v1/admin/work-items",
  },
  "supply-offers": {
    key: "supply-offers",
    title: "供应商上架资源",
    kicker: "Supply operations",
    description: "查看通用资源供给、供应方身份、规格、数量、审核和公开状态。",
    endpoints: [{ path: "/api/v1/admin/supply-offers" }],
    fields: [
      { label: "Offer ID", paths: ["id", "offerId"], format: "id" },
      { label: "供应商", paths: ["supplierName", "supplier.displayName", "supplierActorId", "actorIds"] },
      { label: "身份", paths: ["supplierType", "facts.supplierType"], format: "status" },
      { label: "资源 / 产品", paths: ["productName", "title", "resourceType", "facts.resourceType"] },
      { label: "数量 / 地区", paths: ["subtitle", "quantity"] },
      { label: "计价单位", paths: ["quantityUnit", "pricingUnit", "facts.pricingUnit"] },
      { label: "来源", paths: ["sourceSystem", "entityType"], format: "status" },
      { label: "验真", paths: ["verificationStatus", "verification.status"], format: "status" },
      { label: "发布状态", paths: ["status", "publicationStatus"], format: "status" },
      { label: "提交时间", paths: ["submittedAt", "createdAt"], format: "datetime" },
    ],
    filters: ["供应身份", "资源类型", "地区", "验真", "发布状态"],
    emptyTitle: "没有供应商上架记录",
    emptyDescription: "尚无服务端供给记录，或当前筛选条件没有结果。",
    actions: [
      { value: "ASSIGN_REVIEWER", label: "创建审核任务" },
      { value: "REQUEST_EVIDENCE", label: "创建材料补充任务" },
      { value: "PAUSE", label: "创建暂停评估任务", highRisk: true },
    ],
    actionEndpoint: "/api/v1/admin/supply-offers",
  },
  demands: {
    key: "demands",
    title: "买方需求",
    kicker: "Demand operations",
    description: "管理买方规格、数量、预算、时间和交付要求，并查看候选资源。",
    endpoints: [{ path: "/api/v1/admin/demands" }],
    fields: [
      { label: "Demand ID", paths: ["id", "demandId"], format: "id" },
      { label: "买方", paths: ["buyerName", "buyer.displayName", "buyerActorId", "actorIds"] },
      { label: "资源需求", paths: ["productName", "resourceType", "title"] },
      { label: "数量 / 地区", paths: ["subtitle", "quantity", "requestedQuantity"] },
      { label: "预算", paths: ["budgetCents", "amountCents"], format: "money" },
      { label: "需求类型", paths: ["facts.requestType", "facts.kind", "entityType"] },
      { label: "候选数", paths: ["candidateCount", "matchCount"], format: "number" },
      { label: "状态", paths: ["status"], format: "status" },
      { label: "紧急度", paths: ["urgency", "priority"], format: "status" },
      { label: "创建时间", paths: ["createdAt"], format: "datetime" },
    ],
    filters: ["资源类型", "地区", "状态", "紧急度", "使用时间"],
    emptyTitle: "没有买方需求",
    emptyDescription: "当前没有开放需求，页面未生成任何模拟需求。",
    actions: [
      { value: "ASSIGN", label: "创建运营审核任务" },
      { value: "START_MATCHING", label: "创建匹配任务" },
      { value: "CLOSE", label: "创建关闭评估任务", highRisk: true },
    ],
    actionEndpoint: "/api/v1/admin/demands",
  },
  matches: {
    key: "matches",
    title: "供需匹配",
    kicker: "Matching desk",
    description: "展示规格、数量、时间、地区和交付适配依据，不只显示单一分数。",
    endpoints: [{ path: "/api/v1/admin/matches" }],
    fields: [
      { label: "Match ID", paths: ["id", "matchId"], format: "id" },
      { label: "需求 / 任务", paths: ["demandTitle", "title", "demandId"] },
      { label: "匹配摘要", paths: ["subtitle", "offerName", "offerId", "poolId"] },
      { label: "参与方", paths: ["supplierName", "supplierActorId", "actorIds"] },
      { label: "综合分", paths: ["score", "matchScore", "facts.metadata.score"], format: "number" },
      { label: "规格", paths: ["specFit", "specificationFit"], format: "status" },
      { label: "时间", paths: ["timeFit", "availabilityFit"], format: "status" },
      { label: "地区/交付", paths: ["deliveryFit", "regionFit"], format: "status" },
      { label: "冲突原因", paths: ["blocker", "conflictReason", "reason"] },
      { label: "状态", paths: ["status"], format: "status" },
    ],
    filters: ["匹配状态", "资源类型", "分数", "冲突原因", "负责人"],
    emptyTitle: "没有匹配记录",
    emptyDescription: "当前没有服务端匹配结果，系统不会展示虚构匹配分。",
    actions: [
      { value: "RECALCULATE", label: "创建重算审核任务" },
      { value: "RECOMMEND", label: "创建推荐审核任务" },
      { value: "EXCLUDE", label: "创建排除审核任务", highRisk: true },
    ],
    actionEndpoint: "/api/v1/admin/matches",
  },
  pools: {
    key: "pools",
    title: "算力池",
    kicker: "Capacity control",
    description: "核对资源成员、验真、在线、可用和锁定容量，不把申报数量当作可售库存。",
    endpoints: [{ path: "/api/v1/admin/pools" }],
    fields: [
      { label: "Pool ID", paths: ["id", "pool.id"], format: "id" },
      { label: "供应商", paths: ["supplierName", "pool.supplierActorId", "actorIds"] },
      { label: "资源池", paths: ["name", "pool.name", "title"] },
      { label: "类型 / 地区", paths: ["subtitle", "assetKind", "pool.assetKind"] },
      { label: "成员", paths: ["memberCount", "facts.memberCount"], format: "number" },
      { label: "已验真", paths: ["verifiedCount", "facts.verifiedCount"], format: "number" },
      { label: "在线", paths: ["onlineCount"], format: "number" },
      { label: "可用/锁定", paths: ["capacitySummary", "availableCount", "lockedCount"] },
      { label: "健康度", paths: ["health", "healthStatus", "status"], format: "status" },
      { label: "更新时间", paths: ["updatedAt", "pool.updatedAt"], format: "datetime" },
    ],
    filters: ["资源类型", "地区", "健康度", "验真", "在线状态"],
    emptyTitle: "没有算力池",
    emptyDescription: "当前管理范围内没有服务端算力池。",
    actions: [],
  },
  verifications: {
    key: "verifications",
    title: "验真任务",
    kicker: "Verification review",
    description: "检查设备、容量、在线证明和交付边界；通过或拒绝必须留下依据。",
    endpoints: [{ path: "/api/v1/admin/verifications" }],
    fields: [
      { label: "Job ID", paths: ["id", "jobId"], format: "id" },
      { label: "对象", paths: ["objectName", "title", "memberId", "offerId", "poolId"] },
      { label: "供应商 / 审核人", paths: ["supplierName", "supplierActorId", "actorIds"] },
      { label: "资源类型", paths: ["resourceType", "assetKind", "sourceSystem", "entityType"], format: "status" },
      { label: "证据 / 资源池", paths: ["evidenceSummary", "subtitle", "facts.poolId", "evidenceCount"] },
      { label: "在线/心跳", paths: ["agentStatus", "lastSeenAt"] },
      { label: "审核人", paths: ["reviewerName", "reviewedBy", "assignee"] },
      { label: "SLA", paths: ["dueAt", "slaDueAt"], format: "datetime" },
      { label: "状态", paths: ["status"], format: "status" },
    ],
    filters: ["状态", "资源类型", "审核人", "证据完整度", "SLA"],
    emptyTitle: "没有验真任务",
    emptyDescription: "当前没有等待处理的验真任务。",
    actions: [],
  },
  orders: {
    key: "orders",
    title: "订单",
    kicker: "Order control",
    description: "分别查看订单、支付、容量锁、交付和服务状态，避免笼统的“处理中”。",
    endpoints: [{ path: "/api/v1/admin/orders" }],
    fields: [
      { label: "订单号", paths: ["id", "orderId"], format: "id" },
      { label: "买方 / 供应商", paths: ["counterpartySummary", "buyerName", "buyerActorId", "actorIds"] },
      { label: "产品", paths: ["productName", "resourceName", "title", "memberId"] },
      { label: "数量/时长", paths: ["quantitySummary", "subtitle", "durationHours"] },
      { label: "金额", paths: ["amountCents", "totalAmountCents"], format: "money" },
      { label: "订单", paths: ["status"], format: "status" },
      { label: "支付", paths: ["paymentStatus", "payment.status"], format: "status" },
      { label: "容量锁", paths: ["allocationStatus", "allocation.status"], format: "status" },
      { label: "交付", paths: ["deliveryStatus", "delivery.status"], format: "status" },
      { label: "更新时间", paths: ["updatedAt"], format: "datetime" },
    ],
    filters: ["订单状态", "支付状态", "容量锁", "交付状态", "异常"],
    emptyTitle: "没有订单",
    emptyDescription: "没有服务端订单记录，页面不会生成成功交易样本。",
    actions: [],
  },
  payments: {
    key: "payments",
    title: "支付与退款",
    kicker: "Financial operations",
    description: "支付与退款分别读取服务端事实；后台不能手动标记支付成功。",
    endpoints: [
      { path: "/api/v1/admin/payments", source: "支付" },
      { path: "/api/v1/admin/refund-cases", source: "退款" },
    ],
    fields: [
      { label: "类型", paths: ["_sourceLabel", "operation", "entityType"] },
      { label: "订单 / 记录", paths: ["orderId", "facts.orderId", "title", "id"], format: "id" },
      { label: "渠道", paths: ["provider", "paymentProvider", "facts.provider"] },
      { label: "应付/退款", paths: ["amountCents", "refundAmountCents"], format: "money" },
      { label: "渠道流水", paths: ["providerTransactionRef", "tradeNo", "refundRequestId"], format: "id" },
      { label: "支付", paths: ["paymentStatus", "status"], format: "status" },
      { label: "回调/查单", paths: ["callbackStatus", "queryStatus"] },
      { label: "对账", paths: ["reconciliationStatus"], format: "status" },
      { label: "更新时间", paths: ["updatedAt", "createdAt"], format: "datetime" },
    ],
    filters: ["支付/退款", "渠道", "支付状态", "对账状态", "时间"],
    emptyTitle: "没有支付或退款记录",
    emptyDescription: "两个服务端接口均返回空列表。",
    actions: [
      { value: "REQUEST_REFUND", label: "申请退款", highRisk: true },
      { value: "APPROVE_REFUND", label: "批准退款案件", highRisk: true },
      { value: "REJECT_REFUND", label: "拒绝退款案件", highRisk: true },
    ],
    actionEndpoint: "/api/v1/admin/refund-cases",
  },
  delivery: {
    key: "delivery",
    title: "交付与服务",
    kicker: "Delivery operations",
    description: "跟踪 SSH、API、控制台交付、连接检查、服务开始和清理状态。",
    endpoints: [{ path: "/api/v1/admin/delivery", fallbackPath: "/api/v1/admin/orders", projection: "delivery" }],
    fields: [
      { label: "订单号", paths: ["orderId", "id"], format: "id" },
      { label: "资源", paths: ["resourceName", "productName", "memberId"] },
      { label: "交付形式", paths: ["deliveryForm", "delivery.form"] },
      { label: "公钥", paths: ["publicKeyStatus", "delivery.buyerPublicKeyFingerprint"], format: "status" },
      { label: "配置", paths: ["provisioningStatus", "delivery.status"], format: "status" },
      { label: "凭据有效期", paths: ["credentialExpiresAt", "delivery.credentialExpiresAt"], format: "datetime" },
      { label: "连接检查", paths: ["connectionStatus", "latestConnection.status"], format: "status" },
      { label: "服务", paths: ["serviceStatus", "status"], format: "status" },
      { label: "负责人", paths: ["assigneeName", "owner"] },
    ],
    filters: ["交付状态", "连接检查", "服务状态", "负责人", "超时"],
    emptyTitle: "没有交付任务",
    emptyDescription: "独立交付接口或订单投影没有返回交付记录。",
    actions: [],
  },
  exceptions: {
    key: "exceptions",
    title: "异常中心",
    kicker: "Exception command",
    description: "按严重度、影响、SLA 和负责人处理真实异常，不把普通等待状态升级为故障。",
    endpoints: [{ path: "/api/v1/admin/exceptions", fallbackPath: "/api/v1/admin/dashboard", projection: "exceptions" }],
    fields: [
      { label: "等级", paths: ["severity", "priority"], format: "status" },
      { label: "异常代码", paths: ["code", "exceptionCode"], format: "id" },
      { label: "关联对象", paths: ["objectId", "targetId", "orderId"], format: "id" },
      { label: "摘要", paths: ["summary", "message", "title"] },
      { label: "影响", paths: ["impact", "affectedCount"] },
      { label: "次数", paths: ["occurrenceCount", "count"], format: "number" },
      { label: "负责人", paths: ["assigneeName", "owner"] },
      { label: "SLA", paths: ["dueAt", "slaDueAt"], format: "datetime" },
      { label: "状态", paths: ["status"], format: "status" },
    ],
    filters: ["严重等级", "异常类型", "状态", "负责人", "SLA"],
    emptyTitle: "当前没有异常",
    emptyDescription: "服务端异常投影为空；页面不会将正常等待状态伪装为异常。",
    actions: [],
  },
  accounts: {
    key: "accounts",
    title: "供应商与买方账户",
    kicker: "Account operations",
    description: "查看身份、角色、认证和风险状态；敏感信息始终脱敏。",
    endpoints: [{ path: "/api/v1/admin/principals" }],
    fields: [
      { label: "账户 ID", paths: ["id", "actorId", "accountId"], format: "id" },
      { label: "名称", paths: ["displayName", "name"] },
      { label: "角色", paths: ["roles", "role"] },
      { label: "权限", paths: ["permissions"] },
      { label: "认证", paths: ["verificationStatus", "identityStatus"], format: "status" },
      { label: "供应/购买", paths: ["activitySummary", "supplyCount", "orderCount"] },
      { label: "状态", paths: ["status"], format: "status" },
      { label: "投影时间", paths: ["projectedAt", "lastActiveAt", "updatedAt"], format: "datetime" },
    ],
    filters: ["角色", "认证状态", "风险等级", "账户状态"],
    emptyTitle: "没有账户记录",
    emptyDescription: "当前管理范围内没有服务端账户数据。",
    actions: [],
  },
  admins: {
    key: "admins",
    title: "管理员与权限",
    kicker: "Access control",
    description: "管理运营角色和权限范围；权限变更必须留下理由和审计记录。",
    endpoints: [
      { path: "/api/v1/admin/principals", source: "管理员" },
      { path: "/api/v1/admin/roles", source: "角色目录" },
    ],
    fields: [
      { label: "类型", paths: ["_sourceLabel"] },
      { label: "账号 / 角色", paths: ["accountId", "id", "code"], format: "id" },
      { label: "角色名称", paths: ["name", "displayName"] },
      { label: "已分配角色", paths: ["roles"] },
      { label: "权限范围", paths: ["permissions", "scopes", "scopeSummary"] },
      { label: "说明", paths: ["description"] },
      { label: "状态", paths: ["status"], format: "status" },
      { label: "版本", paths: ["version"], format: "number" },
      { label: "更新时间", paths: ["updatedAt", "projectedAt", "invitedAt"], format: "datetime" },
    ],
    filters: ["角色", "状态", "权限范围", "环境"],
    emptyTitle: "没有管理员或角色记录",
    emptyDescription: "账号事实表和角色目录均没有返回数据。",
    actions: [
      { value: "INVITE_ADMIN", label: "邀请管理员", highRisk: true },
      { value: "SET_ROLES", label: "调整角色", highRisk: true },
      { value: "ACTIVATE_ADMIN", label: "启用管理员", highRisk: true },
      { value: "SUSPEND_ADMIN", label: "停用管理员", highRisk: true },
    ],
    actionEndpoint: "/api/v1/admin/principals",
  },
  audit: {
    key: "audit",
    title: "操作审计",
    kicker: "Audit trail",
    description: "只读查看后台操作、理由、结果和关联对象，不提供删除或改写入口。",
    endpoints: [{ path: "/api/v1/admin/audit-events" }],
    fields: [
      { label: "时间", paths: ["createdAt", "occurredAt"], format: "datetime" },
      { label: "管理员", paths: ["actorName", "actorId", "actorPrincipalId"] },
      { label: "动作", paths: ["action", "operation"], format: "status" },
      { label: "对象", paths: ["targetType", "objectType", "entityType"] },
      { label: "对象 ID", paths: ["targetId", "objectId", "entityId"], format: "id" },
      { label: "理由", paths: ["reason", "summary"] },
      { label: "结果", paths: ["outcome", "status"], format: "status" },
      { label: "来源 / 摘要", paths: ["sourceSystem", "payloadDigest", "requestId"], format: "id" },
    ],
    filters: ["管理员", "动作", "对象类型", "结果", "时间"],
    emptyTitle: "没有审计记录",
    emptyDescription: "服务端审计接口返回了空列表。",
    actions: [],
  },
};

export const adminNavigation = [
  { label: "运营总览", items: [{ href: "/admin", label: "总览", exact: true }] },
  { label: "供给运营", items: [
    { href: "/admin/supply-offers", label: "上架资源" },
    { href: "/admin/pools", label: "算力池" },
    { href: "/admin/verifications", label: "验真任务" },
  ] },
  { label: "需求运营", items: [
    { href: "/admin/demands", label: "买方需求" },
    { href: "/admin/matches", label: "供需匹配" },
  ] },
  { label: "交易履约", items: [
    { href: "/admin/orders", label: "订单" },
    { href: "/admin/payments/refunds", label: "支付与退款" },
    { href: "/admin/delivery", label: "交付与服务" },
  ] },
  { label: "风险异常", items: [
    { href: "/admin/work-items", label: "运营待办" },
    { href: "/admin/exceptions", label: "异常中心" },
  ] },
  { label: "管理", items: [
    { href: "/admin/accounts", label: "账户" },
    { href: "/admin/admins", label: "管理员" },
    { href: "/admin/audit", label: "操作审计" },
  ] },
] as const;
