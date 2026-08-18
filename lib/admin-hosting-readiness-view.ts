export type HostingReadinessItem = Readonly<{
  key: string;
  label: string;
  ready: boolean;
  reason: string;
  detail: string;
  href: string;
  action: string;
}>;

export type HostingReadiness = Readonly<{
  enabled: boolean;
  configurationEnabled: boolean;
  ready: boolean;
  rolloutMode: string;
  items: readonly HostingReadinessItem[];
}>;

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

const readinessReason: Readonly<Record<string, string>> = {
  HOSTING_V2_STORAGE_NOT_READY: "交易存储尚未完成生产初始化",
  KAI_IDENTITY_NOT_READY: "统一登录当前不可用",
  KAI_IDENTITY_LOGIN_EVIDENCE_MISSING: "尚未完成一次真实 KAI Identity 登录验收",
  KAI_ACCOUNT_OIDC_CLIENT_ID: "尚未配置统一登录 Client ID",
  KAI_ACCOUNT_OIDC_TRANSACTION_SECRET: "尚未配置统一登录会话密钥",
  OIDC_DISCOVERY_INVALID: "统一身份中心 Discovery 当前不可用或配置不一致",
  HOSTING_APPROVED_SUPPLIER_MISSING: "尚无审核通过的供应主体",
  HOSTING_ACTIVE_AGENT_MISSING: "尚无持续在线并通过验真的 Host Agent",
  HOSTING_ACTIVE_FEE_MISSING: "尚未激活成交费率版本",
  CARD_HOUR_STORAGE_NOT_READY: "卡时账本未就绪",
  HOSTING_APPROVED_IMAGE_POLICY_MISSING: "尚未配置不可变交付镜像",
  HOSTING_TERMS_POLICY_MISSING: "尚未配置有效供应协议版本",
  HOSTING_METERING_NOT_READY: "真实 Agent 与计量链路尚未同时就绪",
  HOSTING_CLEANUP_NOT_READY: "仍有清理失败或隔离中的设备",
  ALIPAY_MUST_REMAIN_DISABLED_DURING_TRIAL: "试运营期间支付宝必须保持关闭",
};

export function hostingReadinessFromPayload(payload: Record<string, unknown>): HostingReadiness | null {
  const hosting = object(payload.hostingV2);
  const capabilities = object(payload.capabilities);
  const identity = object(capabilities?.kaiIdentityLogin);
  const identityMissing = Array.isArray(identity?.missing)
    ? identity.missing.find((entry): entry is string => typeof entry === "string")
    : undefined;
  const checks = object(hosting?.checks);
  if (!hosting || !checks) return null;

  const check = (key: string) => object(checks[key]);
  const item = (key: string, label: string, detail: string, href: string, action: string, source = check(key)): HostingReadinessItem => {
    const reason = typeof source?.reason === "string" ? source.reason : "";
    return {
      key,
      label,
      ready: source?.ready === true,
      reason: reason ? readinessReason[reason] ?? reason : "已通过服务端只读核验",
      detail,
      href,
      action,
    };
  };

  return {
    enabled: hosting.enabled === true,
    configurationEnabled: hosting.configurationEnabled === true,
    ready: hosting.ready === true,
    rolloutMode: typeof hosting.rolloutMode === "string" ? hosting.rolloutMode : "UNKNOWN",
    items: [
      item("identity", "统一登录", "用户登录、组织身份与供应商权限的唯一可信来源。", "/login?returnTo=%2Fsupply", "验证登录", identity ? {
        ready: identity.available === true,
        reason: identity.available === true
          ? ""
          : typeof identity.errorCode === "string"
            ? identity.errorCode
            : identityMissing ?? "KAI_IDENTITY_NOT_READY",
      } : null),
      item("storage", "交易存储", "设备、报价、合同、实例、计量和收益必须落入同一生产事务库。", "/admin", "查看系统状态"),
      item("supplierIdentity", "供应主体", "必须完成协议签署和管理员准入审核。", "#supplier-review-title", "处理审核"),
      item("trialGrantRequest", "卡时申请复核", "试运营卡时只能由授权角色提交，并保留幂等业务凭证。", "#grant-request-title", "查看申请"),
      item("trialGrantApproval", "卡时双人审批", "发放人与审批人分离，禁止同一管理员自行批准。", "#grant-request-title", "处理审批"),
      item("agentDelivery", "真实 Host Agent", "至少一台真实 GPU 持续心跳并完成硬件验真。", "/guides/host-agent", "查看安装教程"),
      item("feeSchedule", "成交费率", "合同成交时冻结平台费率和推荐奖励版本。", "#fee-schedule-title", "配置费率"),
      item("cardHourLedger", "卡时账本", "锁定、实扣、退款、租金和佣金使用同一不可变账本。", "#grant-request-title", "查看卡时发放"),
      item("approvedImages", "交付镜像", "只允许受控仓库中带 sha256 摘要的 OCI 镜像。", "/guides/host-agent", "查看镜像要求"),
      item("supplierTerms", "供应协议", "供应方提交的协议版本必须与平台当前版本一致。", "/hosting/partners/terms/KAI_HOSTING_TERMS_2026_08", "查看当前协议"),
      item("metering", "真实计量", "服务端时间窗与 Agent 停机凭证共同确定实际秒数。", "#golden-loop-title", "核验黄金订单"),
      item("cleanup", "撤权清理", "容器、公钥和工作区清除完整后才恢复可售。", "#cleanup-recovery-title", "查看隔离事件"),
      item("alipayClosed", "公开支付", "试运营只使用双人审批卡时，支付宝保持关闭。", "#grant-request-title", "查看试运营规则"),
    ],
  };
}
