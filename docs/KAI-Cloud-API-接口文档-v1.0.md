# KAI Cloud API 接口文档

> 版本：v1.0
> 代码基线：`ef656ce`
> 更新日期：2026-08-20
> 生产地址：`https://cloud.kai.com`

## 1. 文档定位

本文档描述 KAI Cloud 网站当前代码中实际存在的 HTTP 接口，供网站前端、运营后台和后续服务端集成使用。

当前接口以同源 Web 应用为主要使用场景，尚未作为带 API Key、配额和版本承诺的第三方公共 API 对外开放。外部系统不得直接依赖管理员、Host Agent、测试或关闭中的交易接口。

当前产品边界：

- GPU 供应商目录和人工询价可以使用。
- 用户可以提交算力申请并在个人中心查看独立组织的数据。
- 供应商可以提交人工上架申请，管理员可以审核。
- 人工交付可安全收集 SSH 公钥；公钥原文仅限有权限的管理员按需查看。
- Hosting V2 自动成交、卡时自动扣减、Host Agent 自动交付和支付宝默认关闭。
- 页面金额统一以 KAI 标准卡时展示两位小数；人民币仅作为购买卡时或内部报价换算参考，不是算力资源结算单位。

## 2. 通用约定

### 2.1 基础地址

```text
https://cloud.kai.com
```

所有正文中的路径均相对于该地址，例如：

```text
GET https://cloud.kai.com/api/auth/session
```

### 2.2 数据格式

- 请求正文：`application/json; charset=utf-8`
- 响应正文：`application/json; charset=utf-8`
- 普通业务写入正文最大 32KB。
- 认证请求正文最大 16KB。
- 时间采用 ISO 8601 UTC 字符串，例如 `2026-08-20T01:23:45.000Z`。
- 标识符必须视为不透明字符串，不应由客户端拆解或自行生成业务含义。

### 2.3 身份与租户

KAI Cloud 使用 HttpOnly、`SameSite=Strict` Cookie 会话。浏览器不得从 JavaScript 读取会话令牌。

一个账户可以属于多个组织。所有买家、供应商、卡时和申请数据均以服务端会话中的 `activeOrganization` 为唯一租户边界；客户端传入的 `organizationId`、角色或视图模式不能改变权限。

后台 Root 和财务审批身份不能直接参与购买、供应或收款。如同一自然人需要交易，应使用不含后台权限的独立交易组织。

### 2.4 三类会话

| 会话 | 入口 | 用途 |
|---|---|---|
| KAI账户会话 | `/api/auth/*` | 登录用户、组织、买家与供应商数据 |
| 市场访客会话 | `/api/session` | 市场浏览、CSRF令牌、匿名/兼容市场上下文 |
| 独立管理员会话 | `/api/auth/admin/password` | 管理后台与受权限控制的运营接口 |

`/api/session` 与 `/api/auth/session` 不是同一个接口：前者是市场上下文，后者是登录账户会话。

### 2.5 写入请求头

大部分市场写入必须同时携带：

```http
Content-Type: application/json
Origin: https://cloud.kai.com
Idempotency-Key: <16-128位稳定唯一字符串>
X-KAI-CSRF: <GET /api/session 返回的 csrfToken>
Cookie: <浏览器自动携带>
```

要求：

- `Idempotency-Key` 只可包含字母、数字、点、下划线、冒号和短横线。
- 同一个幂等键和完全相同的正文重试时，服务端返回原结果。
- 同一个幂等键提交不同正文时返回 `409 IDEMPOTENCY_CONFLICT`。
- 生产写入必须同源；跨站或缺失可信 `Origin` 返回 403。
- 不要把 SSH 公钥、密码、私钥或访问令牌放在 URL 查询参数中。

### 2.6 标准成功响应

集合接口通常返回：

```json
{
  "records": [],
  "count": 0,
  "updatedAt": "2026-08-20T01:23:45.000Z"
}
```

部分旧接口使用 `items` 而不是 `records`。写入接口通常返回：

```json
{
  "record": {},
  "replayed": false
}
```

响应头 `x-request-id` 用于排查服务端日志；幂等写入可能返回 `idempotency-replayed: true`。

### 2.7 标准错误响应

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "提交内容不符合要求。",
    "field": "quantity",
    "requestId": "4db15d90-9b5d-4abd-a05b-48bfd0bc04ce"
  }
}
```

常用状态码：

| 状态码 | 含义 |
|---:|---|
| 200 | 查询成功或幂等重放成功 |
| 201 | 新记录创建成功 |
| 202 | 请求已受理，例如邮箱验证码发送 |
| 302/303 | 登录或回调跳转 |
| 400 | 参数、JSON或服务端字段不合法 |
| 401 | 未登录或会话失效 |
| 403 | 无权限、跨站请求、CSRF失败或交易主体被禁止 |
| 404 | 记录不存在；跨组织详情也统一返回404 |
| 409 | 幂等冲突或状态冲突 |
| 413 | 正文超过32KB |
| 426 | 写入必须使用HTTPS |
| 429 | 频率或需求报价数量超限 |
| 503 | 能力关闭、队列已满或服务未就绪 |

## 3. 登录与组织接口

### 3.1 发起 KAI Identity 登录

```http
GET /api/auth/kai/start?returnTo=/member
```

用途：跳转至 KAI Identity 完成 OIDC 登录。

- `returnTo` 只能是本站以 `/` 开头的安全相对路径。
- 默认返回 `/member`。
- 成功返回 `302`；失败返回 `303` 到 `/login` 并附带 `authError`。

### 3.2 OIDC 回调

```http
GET /api/auth/kai/callback
```

由 KAI Identity 调用。校验授权事务、交换令牌、创建本站会话并跳回原页面。业务前端不应主动调用该接口。

### 3.3 查询账户会话

```http
GET /api/auth/session
```

未登录：

```json
{
  "authenticated": false
}
```

已登录响应包含当前账户、当前组织和该账户可切换的组织列表：

```json
{
  "authenticated": true,
  "account": {
    "id": "acct_...",
    "displayName": "KAI User",
    "status": "ACTIVE"
  },
  "organization": {
    "id": "org_...",
    "name": "示例组织",
    "status": "ACTIVE"
  },
  "memberships": []
}
```

管理员字段只会在独立密码管理员会话中出现。

### 3.4 切换当前组织

```http
POST /api/auth/organization
Content-Type: application/json
Origin: https://cloud.kai.com

{
  "organizationId": "org_..."
}
```

仅允许切换到当前账户具有 `ACTIVE` membership 的组织。成功后服务端签发新会话并撤销旧会话，前端必须重新加载所有组织级数据。

### 3.5 退出登录

```http
POST /api/auth/logout
Origin: https://cloud.kai.com
```

成功响应：

```json
{
  "authenticated": false
}
```

### 3.6 邮箱登录接口

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/auth/email/request` | 请求邮箱验证码 |
| POST | `/api/auth/email/verify` | 验证邮箱验证码并创建会话 |
| GET | `/api/auth/email/local-inbox` | 仅本地测试，生产不可用 |

生产网站当前以 KAI Identity 登录为正式入口；本地登录接口 `/api/auth/local` 仅允许本地验收环境。

## 4. 公共与市场接口

### 4.1 存活检查

```http
GET /api/live
```

```json
{
  "status": "ok",
  "check": "live",
  "service": "kai-cloud-marketplace",
  "release": "ef656ce"
}
```

该接口只代表进程可以响应，不代表数据库和业务能力全部可用。

### 4.2 就绪检查

```http
GET /api/ready
GET /api/health
```

`/api/health` 当前复用 `/api/ready`。业务依赖未就绪时返回503，响应包含数据库、市场、存储和能力状态。不要向普通用户展示完整就绪对象。

### 4.3 获取市场访客会话与CSRF令牌

```http
GET /api/session
```

```json
{
  "session": {
    "source": "cookie",
    "csrfToken": "...",
    "expiresAt": "2026-08-20T02:00:00.000Z",
    "retentionDays": 30
  }
}
```

浏览器应保存服务端设置的Cookie，并在后续市场写入中发送 `X-KAI-CSRF`。

### 4.4 卡时行情快照

```http
GET /api/market
GET /api/market?summary=1
```

完整接口返回当前行情快照；`summary=1` 只返回发布时间、报价数和指数变化。

### 4.5 公共资源挂牌

```http
GET /api/v1/market/listings
```

```json
{
  "items": [],
  "count": 0,
  "updatedAt": "2026-08-20T01:23:45.000Z"
}
```

这是旧资源交易域的公共挂牌读取接口。GPU供应商静态目录主要由网站服务端目录数据渲染，不应将该接口等同于已验真的实时GPU库存。

### 4.6 买方需求池

```http
GET /api/requests?view=market&limit=20&cursor=...
GET /api/requests?view=mine&limit=20&cursor=...
```

查询参数：

| 参数 | 说明 |
|---|---|
| `view` | `market` 公共需求池；`mine` 当前访客/会话需求 |
| `limit` | 1–50，默认20 |
| `cursor` | 服务端返回的下一页游标 |

创建需求：

```http
POST /api/requests
```

写入必须登录交易账户，并携带同源、CSRF和幂等请求头。

### 4.7 报价接口

```http
GET /api/quotes?view=buyer
GET /api/quotes?view=supplier
POST /api/quotes
```

`POST` 用于供应方响应需求，要求登录交易账户、市场写入上下文、CSRF和幂等键。

## 5. 买家接口

### 5.1 账户控制台摘要

```http
GET /api/v1/member/account-console-summary
```

权限：登录、当前组织ACTIVE、非后台Root/财务交易身份。

```json
{
  "account": {
    "displayName": "KAI User",
    "organizationName": "示例组织",
    "subjectStatus": "ACTIVE"
  },
  "buyer": {
    "cardHours": {
      "availableMicros": 10000000,
      "heldMicros": 0
    },
    "purchaseIntents": {
      "total": 1,
      "pendingManualDelivery": 1,
      "recent": []
    }
  },
  "supplier": {
    "available": false,
    "approved": false,
    "status": "NOT_SUBMITTED",
    "subjectStatus": "ACTIVE",
    "applications": {}
  }
}
```

说明：

- 1 KAI标准卡时 = 1,000,000 微卡时。
- 前端统一格式化为两位小数。
- `supplier.available` 来自当前组织真实上架申请，不由前端角色切换决定。
- 存储异常直接返回错误，不会伪装成0或空数据。

### 5.2 卡时账户

```http
GET /api/v1/member/card-hours
GET /api/v1/member/kai-hours
```

`/card-hours` 返回卡时账本与充值可用性；`/kai-hours` 返回标准化账户投影。公开人民币充值默认关闭，响应会说明试运营卡时仅由平台双人审批发放。

### 5.3 提交目录资源人工交付申请

```http
POST /api/v1/catalog-purchase-intents
```

请求头必须包含登录Cookie、同源、CSRF和幂等键。

示例：

```json
{
  "resourceId": "resource-gpu-example",
  "quantity": 1,
  "durationHours": 24,
  "deliveryDate": "2026-08-25",
  "note": "需要 Ubuntu 22.04 与 CUDA 环境",
  "sshPublicKey": "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAA... kai@example"
}
```

字段：

| 字段 | 必填 | 规则 |
|---|---:|---|
| `resourceId` | 是 | 必须是当前目录中存在的资源 |
| `quantity` | 是 | 1–10000整数 |
| `durationHours` | 按计时资源 | 小时数，由目录计价单位决定 |
| `deliveryDate` | 否 | 期望交付日期 |
| `note` | 否 | 最多500字符 |
| `sshPublicKey` | 按人工SSH交付开关 | 仅接受单行Ed25519或RSA≥2048公钥；原文≤12KB；禁止私钥、options和多行 |

成功响应的关键部分：

```json
{
  "record": {
    "id": "demand_..."
  },
  "replayed": false,
  "manualDelivery": {
    "mode": "MANUAL_SSH",
    "status": "PENDING_MANUAL_DELIVERY",
    "sshPublicKeyFingerprint": "SHA256:..."
  },
  "purchaseDetails": {
    "href": "/member/purchases/demand_...",
    "demandId": "demand_...",
    "status": "PENDING_MANUAL_DELIVERY"
  },
  "priceSnapshot": {
    "assetCode": "KAI_CREDIT_HOUR",
    "settlementAsset": "CARD_HOUR",
    "estimatedCardHours": "1437.13",
    "estimatedCardHourMicros": 1437125749,
    "conversionRate": {
      "cardHours": "1",
      "cny": "1.002"
    }
  }
}
```

重要边界：

- 成功仅表示人工交付申请已登记。
- 不代表锁定库存、付款、扣卡时、成交或自动开通。
- SSH公钥原文不会进入公共需求、价格快照或买家详情，只返回指纹。
- 资源、供应商、规格和参考卡时会保存为不可变快照，目录以后改价不会篡改历史申请。

### 5.4 查询当前组织的算力申请

```http
GET /api/v1/member/purchase-intents
```

```json
{
  "records": [],
  "count": 0
}
```

只返回当前会话 `activeOrganization` 的记录。

### 5.5 查询算力申请详情

```http
GET /api/v1/member/purchase-intents/:demandId
```

返回提交时的资源、供应商、GPU规格、数量、租期、参考卡时、SSH公钥指纹和人工交付状态。

- 不返回SSH公钥原文。
- 不返回买家内部账户/组织ID、幂等键、payload hash或管理员备注。
- 跨组织访问与记录不存在统一返回404。

## 6. 供应商接口

### 6.1 查询人工上架申请

```http
GET /api/v1/supply/offers
```

只返回当前供应上下文的上架申请。

### 6.2 提交人工上架申请

```http
POST /api/v1/supply/offers
```

权限：登录交易账户、供应视图、同源、CSRF和幂等键。

示例：

```json
{
  "supplierType": "COMPANY",
  "resourceType": "GPU_SERVER",
  "quantity": 1,
  "quantityUnit": "NODE",
  "pricingUnit": "NODE_HOUR",
  "productName": "8×H100 GPU服务器",
  "specification": "Ubuntu 22.04，8×H100，2TB内存，7TB数据盘",
  "region": "实际机房待确认",
  "deliveryForm": "平台人工协调SSH交付",
  "availabilityStartAt": null,
  "availabilityEndAt": null,
  "notes": "可扩容项目需另行确认"
}
```

枚举：

| 字段 | 可选值 |
|---|---|
| `supplierType` | `INDIVIDUAL`、`COMPANY`、`IDC`、`CLOUD_VENDOR` |
| `resourceType` | `GPU_CARD`、`GPU_SERVER`、`CPU_SERVER`、`MAC_COMPUTE`、`TOKEN_CAPACITY`、`MODEL_INSTANCE`、`NAS_STORAGE`、`RACK_CAPACITY`、`CLOUD_RESOURCE` |
| `quantityUnit` | `CARD`、`NODE`、`SERVER`、`M_TOKENS_PER_HOUR`、`MODEL_INSTANCE`、`TIB`、`RACK`、`KW`、`QUOTA_UNIT` |
| `pricingUnit` | `CARD_HOUR`、`NODE_HOUR`、`SERVER_HOUR`、`TOKEN_CAPACITY_HOUR`、`MODEL_INSTANCE_HOUR`、`TIB_HOUR`、`RACK_MONTH`、`KW_MONTH`、`QUOTA_HOUR` |

创建后初始状态为 `SUBMITTED`，只代表已进入人工审核：

```text
DRAFT → SUBMITTED → UNDER_VERIFICATION → VERIFIED / REJECTED → PUBLISHED
```

`VERIFIED` 只代表申请审核通过；`PUBLISHED` 才代表管理员已人工发布。两者都不等于库存锁定、成交、运行中或产生收益。

### 6.3 供应控制台摘要

```http
GET /api/v1/supply/dashboard
```

该接口属于旧供应试运营域。新账户控制台首页优先使用 `/api/v1/member/account-console-summary` 中的 `supplier` 投影。

### 6.4 Hosting V2 供应接口

以下接口默认关闭，仅在 `KAI_HOSTING_V2_SETUP=1` 或对应Hosting能力通过验收后使用：

```text
GET|PUT  /api/v2/supply/profile
POST     /api/v2/supply/profile/submit
GET      /api/v2/supply/policy
GET      /api/v2/supply/dashboard
GET|POST /api/v2/supply/offers
POST     /api/v2/supply/offers/:offerId/status
GET      /api/v2/supply/contracts
GET      /api/v2/supply/contracts/:contractId
GET      /api/v2/supply/earnings
POST     /api/v2/supply/agent-challenges
GET      /api/v2/supply/agent-challenges/:challengeId
POST     /api/v2/supply/agent-challenges/:challengeId/revoke
```

不得把这些接口当作当前人工上架闭环的前置条件。

## 7. 管理员接口

管理员接口全部要求独立密码管理员会话和明确权限。普通用户、供应商、财务审批账户或仅知道URL的访问者不能读取管理员数据。

### 7.1 查询上架申请

```http
GET /api/v1/admin/supply-offers
```

权限：`SUPPLY_INTAKE_REVIEW`

用于管理员查看用户提交的主体、资源类型、规格、数量、交付方式、状态和备注。

### 7.2 创建上架审核工作项

```http
POST /api/v1/admin/supply-offers
```

权限：`SUPPLY_INTAKE_REVIEW`

该接口创建后台审核工作项，不会自动发布、成交或调用Host Agent。

### 7.3 查询人工交付队列

```http
GET /api/v1/admin/manual-deliveries
```

权限：`FULFILLMENT_READ`

列表默认只返回买家主体、资源、状态、时间和SSH公钥指纹，不返回公钥原文。

### 7.4 按需查看SSH公钥

```http
GET /api/v1/admin/manual-deliveries/:demandId/ssh-public-key
```

权限：独立密码管理员 + `FULFILLMENT_READ`

- 响应强制 `Cache-Control: no-store`。
- 每次查看均写入 `MANUAL_DELIVERY_KEY_REVEALED` 审计事件。
- 审计只记录需求与查看行为，不记录公钥原文。
- 供应商当前没有读取该公钥的接口；由管理员在线下人工转交并完成授权。

### 7.5 管理员接口分组

| 分组 | 路径前缀 | 典型权限/用途 |
|---|---|---|
| 运营总览 | `/api/v1/admin/dashboard` | 运营汇总 |
| 买方需求 | `/api/v1/admin/demands` | 需求审阅 |
| 供应上架 | `/api/v1/admin/supply-offers` | `SUPPLY_INTAKE_REVIEW` |
| 人工交付 | `/api/v1/admin/manual-deliveries`、`/delivery` | `FULFILLMENT_READ` |
| 验真与匹配 | `/api/v1/admin/verifications`、`/matches` | 内部审核 |
| 订单与计量 | `/api/v1/admin/orders`、`/metering` | 旧交易域，只读或受门禁 |
| 卡时试发 | `/api/v2/admin/card-hours/trial-grants` | 双人审批 |
| Hosting治理 | `/api/v2/admin/hosting/*` | 费率、争议、停止、清理、退役 |
| 审计与权限 | `/api/v1/admin/audit-events`、`/roles`、`/principals` | 独立管理员治理 |

管理员接口不会在本文档中展示密码、密钥、内部风控字段或生产凭据。

## 8. Hosting V2交易接口（默认关闭）

### 8.1 公共真实报价

```http
GET /api/v2/offers
```

只有 `KAI_HOSTING_V2=1` 时可用。返回经过Hosting V2存储发布的真实报价，不等于静态供应商目录。

### 8.2 合同接口

```text
GET|POST /api/v2/contracts
GET      /api/v2/contracts/:contractId
POST     /api/v2/contracts/:contractId/ssh-key
POST     /api/v2/contracts/:contractId/start
POST     /api/v2/contracts/:contractId/stop
POST     /api/v2/contracts/:contractId/accept
POST     /api/v2/contracts/:contractId/cancel
POST     /api/v2/contracts/:contractId/dispute
```

创建合同除要求 `KAI_HOSTING_V2=1` 外，还要求交易能力和财务轨就绪。当前生产默认 fail-closed，调用可能返回503。前端不得通过静态目录绕过该门禁。

合同写入字段中的账户、组织、设备、费率、锁定金额、状态和ID均由服务端计算，客户端传入会返回400。

## 9. Host Agent与内部运维接口

以下接口只允许受信任的Host Agent或平台内部服务调用，不对浏览器或第三方开发者开放：

```text
POST /api/v2/agent/register
POST /api/v2/agent/devices/:deviceId/heartbeat
POST /api/v2/agent/devices/:deviceId/commands/poll
POST /api/v2/agent/devices/:deviceId/commands/:commandId/complete

GET  /api/v1/ops/resources
GET  /api/v1/ops/delivery-packages
GET  /api/v1/ops/metering-orders
```

Agent身份、签名、防重放、递增序列、命令租约和设备归属由服务端校验。禁止在浏览器中保存Agent密钥。

## 10. 功能开关与生产可用性

当前部署示例中的默认值：

| 开关 | 默认 | 影响 |
|---|---:|---|
| `KAI_MANUAL_DELIVERY_INTAKE` | `0` | 是否在适用目录询价中收集SSH公钥并建立人工交付侧车 |
| `KAI_ACCOUNT_CONSOLE_V2` | `0` | 是否启用统一买家/供应商账户控制台外壳 |
| `KAI_HOSTING_V2` | `0` | 是否开放Hosting V2真实市场读取 |
| `KAI_HOSTING_V2_SETUP` | `0` | 是否开放Hosting设备、Agent与报价配置页 |
| `KAI_ALIPAY_ENABLED` | `0` | 是否开放支付宝人民币购买卡时 |

接口存在不代表生产已经开放。调用方应依据接口返回的真实就绪状态处理，不得通过前端常量推断能力已启用。

## 11. 接入示例：浏览器提交人工算力申请

### 第一步：登录

浏览器打开：

```text
https://cloud.kai.com/api/auth/kai/start?returnTo=/gpu
```

### 第二步：获取市场CSRF令牌

```js
const sessionResponse = await fetch("/api/session", {
  credentials: "same-origin",
});
const { session } = await sessionResponse.json();
```

### 第三步：提交申请

```js
const response = await fetch("/api/v1/catalog-purchase-intents", {
  method: "POST",
  credentials: "same-origin",
  headers: {
    "content-type": "application/json",
    "x-kai-csrf": session.csrfToken,
    "idempotency-key": crypto.randomUUID(),
  },
  body: JSON.stringify({
    resourceId: "resource-gpu-example",
    quantity: 1,
    durationHours: 24,
    deliveryDate: "2026-08-25",
    note: "需要 Ubuntu 22.04 与 CUDA 环境",
    sshPublicKey: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAA... kai@example",
  }),
});

const result = await response.json();
if (!response.ok) {
  throw new Error(`${result.error.code}: ${result.error.message}`);
}
```

### 第四步：读取当前组织申请

```js
const purchases = await fetch("/api/v1/member/purchase-intents", {
  credentials: "same-origin",
}).then((response) => response.json());
```

## 12. 安全与隐私边界

以下内容不得出现在公共接口、买家列表、普通日志或URL中：

- SSH公钥原文、任何私钥、密码和令牌。
- 管理员内部备注、风控标签、证据文件地址和临时下载链接。
- 其他组织的账户ID、组织ID、邮箱、电话和成员关系。
- 幂等payload hash、内部审计元数据、管理员权限配置。
- 支付密钥、支付宝验签密钥、Agent设备私钥。

买家只看到自己提交的SSH公钥指纹；原文仅能由具备权限的独立管理员按需查看。详情接口对跨组织和不存在记录统一返回404，避免枚举其他组织数据。

## 13. 旧版、测试与禁止新接入的接口

以下接口仍存在于代码中，用于兼容、回归或受控试运营，不应成为新前端或外部集成的依赖：

- `/api/v1/orders/*`
- `/api/v1/checkouts`
- `/api/v1/supply/trial-orders`
- `/api/v1/supply/orders/*`
- `/api/v1/delivery-*`
- `/api/v1/capacity-lots/*`
- `/api/v1/swap-quotes/*`
- `/api/v1/settlements/:id/test-record`
- `/api/v1/orders/:id/test-*`
- `/api/v1/lab/gpu-loop`
- `/api/auth/local`
- `/api/auth/email/local-inbox`

生产环境中的旧GPU成交写入受统一门禁保护。新成交能力只能以通过生产验收的 `/api/v2/contracts` 为正式入口。

## 14. 路由总览

### 14.1 公开与认证

| 方法 | 路径 |
|---|---|
| GET | `/api/live`、`/api/ready`、`/api/health` |
| GET | `/api/market`、`/api/session` |
| GET | `/api/auth/kai/start`、`/api/auth/kai/callback`、`/api/auth/session` |
| POST | `/api/auth/logout`、`/api/auth/organization` |
| POST | `/api/auth/email/request`、`/api/auth/email/verify` |
| GET/POST | `/api/requests`、`/api/quotes` |

### 14.2 买家与卡时

| 方法 | 路径 |
|---|---|
| POST | `/api/v1/catalog-purchase-intents` |
| GET | `/api/v1/member/account-console-summary` |
| GET | `/api/v1/member/purchase-intents` |
| GET | `/api/v1/member/purchase-intents/:demandId` |
| GET | `/api/v1/member/card-hours`、`/api/v1/member/kai-hours`、`/api/v1/member/personal-summary` |
| POST | `/api/v1/member/card-hours/referral`、`/api/v1/member/card-hours/topups` |

### 14.3 供应与上架

| 方法 | 路径 |
|---|---|
| GET/POST | `/api/v1/supply/offers`、`/api/v1/supply/pools` |
| GET/POST | `/api/v1/supply/trial-orders` |
| POST | `/api/v1/supply/agent-enrollments`、`/api/v1/supply/agent-enrollments/:id/heartbeats` |
| POST | `/api/v1/supply/verification-jobs`、`/:id/evidence`、`/:id/complete` |
| GET | `/api/v1/supply/dashboard`、`/api/v1/supply/verification-jobs/:id` |
| GET/POST | `/api/v1/supply/pools/:id/availability-windows` |
| POST | `/api/v1/supply/pools/:id/members-batch`、`/:id/publication-plans` |

### 14.4 管理后台

```text
/api/v1/admin/dashboard
/api/v1/admin/search
/api/v1/admin/principals
/api/v1/admin/roles
/api/v1/admin/audit-events
/api/v1/admin/demands
/api/v1/admin/supply-offers
/api/v1/admin/manual-deliveries
/api/v1/admin/manual-deliveries/:demandId/ssh-public-key
/api/v1/admin/delivery
/api/v1/admin/verifications
/api/v1/admin/matches
/api/v1/admin/orders
/api/v1/admin/payments
/api/v1/admin/metering
/api/v1/admin/settlements
/api/v1/admin/refund-cases
/api/v1/admin/work-items
/api/v2/admin/card-hours/trial-grants
/api/v2/admin/supply/profiles
/api/v2/admin/hosting/*
```

### 14.5 Hosting V2与Agent

```text
/api/v2/offers
/api/v2/contracts
/api/v2/contracts/:contractId/*
/api/v2/supply/*
/api/v2/agent/register
/api/v2/agent/devices/:deviceId/heartbeat
/api/v2/agent/devices/:deviceId/commands/poll
/api/v2/agent/devices/:deviceId/commands/:commandId/complete
```

## 15. 后续公共API建议

如果需要向供应商、企业客户或合作伙伴正式开放API，建议另建 `/api/public/v1`，不要直接暴露现有网站内部接口。正式公共API至少需要：

1. 独立 Client ID/Client Secret 或签名密钥。
2. 明确的scope，例如 `catalog:read`、`purchase:write`、`supply:write`。
3. OpenAPI 3.1规范和版本兼容策略。
4. 每个客户独立限流、审计和密钥撤销。
5. Webhook签名、重放保护和事件版本。
6. 沙箱环境与测试资源。
7. 公开SLA、错误码目录和弃用周期。

在这些条件完成前，本文件应视为“KAI Cloud网站内部接口说明”，而不是第三方公共API承诺。

## 附录A：当前代码完整路由清单

下表由 `app/api/**/route.ts` 代码目录核对整理。它只证明路由存在，不代表生产开关、权限、数据库和上游服务已经就绪。

### A.1 认证、公共市场与健康检查

| 方法 | 路径 |
|---|---|
| POST | `/api/auth/admin/password` |
| GET | `/api/auth/email/local-inbox` |
| POST | `/api/auth/email/request` |
| POST | `/api/auth/email/verify` |
| GET | `/api/auth/kai/callback` |
| GET | `/api/auth/kai/start` |
| POST | `/api/auth/local` |
| POST | `/api/auth/logout` |
| POST | `/api/auth/organization` |
| GET | `/api/auth/session` |
| GET, POST | `/api/drafts` |
| GET | `/api/health` |
| GET | `/api/live` |
| GET | `/api/market` |
| GET, POST | `/api/quotes` |
| GET | `/api/ready` |
| GET, POST | `/api/requests` |
| GET | `/api/session` |

### A.2 v1买家、市场、交易兼容与运营接口

| 方法 | 路径 |
|---|---|
| POST | `/api/v1/catalog-purchase-intents` |
| POST | `/api/v1/checkouts` |
| GET | `/api/v1/commission-accruals` |
| POST | `/api/v1/delivery-packages/:id/claim` |
| POST | `/api/v1/delivery-packages/:id/connection-tests` |
| POST | `/api/v1/delivery-packages/:id/reviews` |
| POST | `/api/v1/delivery-tasks/:id/packages` |
| POST | `/api/v1/integrations/payment-events` |
| GET, POST | `/api/v1/lab/gpu-loop` |
| GET | `/api/v1/market/listings` |
| GET | `/api/v1/member/account-console-summary` |
| POST | `/api/v1/member/card-hours/referral` |
| GET | `/api/v1/member/card-hours` |
| POST | `/api/v1/member/card-hours/topups` |
| GET | `/api/v1/member/kai-hours` |
| GET | `/api/v1/member/personal-summary` |
| GET | `/api/v1/member/purchase-intents` |
| GET | `/api/v1/member/purchase-intents/:demandId` |
| GET | `/api/v1/ops/delivery-packages` |
| GET | `/api/v1/ops/metering-orders` |
| GET | `/api/v1/ops/resources` |
| GET | `/api/v1/orders` |
| GET | `/api/v1/orders/:id` |
| POST | `/api/v1/orders/:id/acceptances` |
| POST | `/api/v1/orders/:id/delivery-start` |
| POST | `/api/v1/orders/:id/payment-intents` |
| GET | `/api/v1/orders/:id/payment-status` |
| GET | `/api/v1/orders/:id/refund-status` |
| POST | `/api/v1/orders/:id/refunds` |
| POST | `/api/v1/orders/:id/supplier-confirmation` |
| POST | `/api/v1/orders/:id/test-meter-complete` |
| POST | `/api/v1/orders/:id/test-payment` |
| POST | `/api/v1/orders/:id/test-service-start` |
| POST | `/api/v1/payments/alipay/notify` |
| GET | `/api/v1/payments/alipay/readiness` |
| GET | `/api/v1/product-versions` |
| GET | `/api/v1/referral-attributions` |
| GET, POST | `/api/v1/referral-codes` |
| GET, POST | `/api/v1/resources` |
| POST | `/api/v1/resources/:id/verification-runs` |
| POST | `/api/v1/settlements/:id/test-record` |
| GET | `/api/v1/standardization/quotes` |
| GET, POST | `/api/v1/swap-quotes` |
| POST | `/api/v1/swap-quotes/:id/status-events` |
| GET, POST | `/api/v1/capacity-lots` |
| POST | `/api/v1/capacity-lots/:id/listings` |
| POST | `/api/v1/capacity-lots/:id/withdraw` |

### A.3 v1供应接口

| 方法 | 路径 |
|---|---|
| POST | `/api/v1/supply/agent-enrollments` |
| POST | `/api/v1/supply/agent-enrollments/:id/heartbeats` |
| GET | `/api/v1/supply/dashboard` |
| POST | `/api/v1/supply/mac-inventory/batch` |
| POST | `/api/v1/supply/members/:id/components-batch` |
| GET, POST | `/api/v1/supply/offers` |
| POST | `/api/v1/supply/orders/:id/cleanup` |
| POST | `/api/v1/supply/orders/:id/connection-check` |
| GET | `/api/v1/supply/orders/:id` |
| POST | `/api/v1/supply/orders/:id/service-complete` |
| POST | `/api/v1/supply/orders/:id/service-start` |
| POST | `/api/v1/supply/orders/:id/ssh-key` |
| GET, POST | `/api/v1/supply/pools` |
| GET, POST | `/api/v1/supply/pools/:id/availability-windows` |
| POST | `/api/v1/supply/pools/:id/members-batch` |
| POST | `/api/v1/supply/pools/:id/publication-plans` |
| GET, POST | `/api/v1/supply/trial-orders` |
| POST | `/api/v1/supply/verification-jobs` |
| GET | `/api/v1/supply/verification-jobs/:id` |
| POST | `/api/v1/supply/verification-jobs/:id/complete` |
| POST | `/api/v1/supply/verification-jobs/:id/evidence` |

### A.4 v1管理员接口

| 方法 | 路径 |
|---|---|
| GET | `/api/v1/admin/audit-events` |
| GET | `/api/v1/admin/capacity-lots` |
| GET | `/api/v1/admin/commissions` |
| GET | `/api/v1/admin/dashboard` |
| GET | `/api/v1/admin/delivery` |
| GET, POST | `/api/v1/admin/demands` |
| GET | `/api/v1/admin/exceptions` |
| GET | `/api/v1/admin/listings` |
| GET | `/api/v1/admin/manual-deliveries` |
| GET | `/api/v1/admin/manual-deliveries/:demandId/ssh-public-key` |
| GET, POST | `/api/v1/admin/matches` |
| GET | `/api/v1/admin/metering` |
| GET | `/api/v1/admin/orders` |
| GET | `/api/v1/admin/payments` |
| GET | `/api/v1/admin/pools` |
| GET | `/api/v1/admin/principals` |
| GET, POST | `/api/v1/admin/refund-cases` |
| POST | `/api/v1/admin/refund-cases/:id/decision` |
| POST | `/api/v1/admin/refund-cases/:id/retry` |
| GET | `/api/v1/admin/roles` |
| GET | `/api/v1/admin/search` |
| GET | `/api/v1/admin/settlements` |
| GET, POST | `/api/v1/admin/standardization/snapshots` |
| GET, POST | `/api/v1/admin/supply-offers` |
| GET | `/api/v1/admin/swaps` |
| GET | `/api/v1/admin/verifications` |
| GET | `/api/v1/admin/withdrawals` |
| GET, POST | `/api/v1/admin/work-items` |
| PATCH | `/api/v1/admin/work-items/:id` |

### A.5 v2管理员与供应治理接口

| 方法 | 路径 |
|---|---|
| GET, POST | `/api/v2/admin/card-hours/trial-grants` |
| POST | `/api/v2/admin/card-hours/trial-grants/:grantId/decision` |
| GET | `/api/v2/admin/hosting/cleanup-incidents` |
| POST | `/api/v2/admin/hosting/cleanup-incidents/:contractId/retry` |
| POST | `/api/v2/admin/hosting/devices/:deviceId/retirement` |
| POST | `/api/v2/admin/hosting/devices/:deviceId/retirement/finalize` |
| GET | `/api/v2/admin/hosting/disputes` |
| POST | `/api/v2/admin/hosting/disputes/:contractId/proposals` |
| POST | `/api/v2/admin/hosting/disputes/proposals/:proposalId/decision` |
| GET, POST | `/api/v2/admin/hosting/fees` |
| GET | `/api/v2/admin/hosting/golden-loop/:contractId` |
| GET | `/api/v2/admin/hosting/stop-incidents` |
| POST | `/api/v2/admin/hosting/stop-incidents/:contractId/retry` |
| GET | `/api/v2/admin/supply/profiles` |
| POST | `/api/v2/admin/supply/profiles/:organizationId/review` |

### A.6 v2 Hosting、Agent与合同接口

| 方法 | 路径 |
|---|---|
| POST | `/api/v2/agent/register` |
| POST | `/api/v2/agent/devices/:deviceId/heartbeat` |
| POST | `/api/v2/agent/devices/:deviceId/commands/poll` |
| POST | `/api/v2/agent/devices/:deviceId/commands/:commandId/complete` |
| GET, POST | `/api/v2/contracts` |
| GET | `/api/v2/contracts/:contractId` |
| POST | `/api/v2/contracts/:contractId/accept` |
| POST | `/api/v2/contracts/:contractId/cancel` |
| POST | `/api/v2/contracts/:contractId/dispute` |
| POST | `/api/v2/contracts/:contractId/ssh-key` |
| POST | `/api/v2/contracts/:contractId/start` |
| POST | `/api/v2/contracts/:contractId/stop` |
| GET | `/api/v2/offers` |
| GET, POST | `/api/v2/supply/agent-challenges` |
| GET | `/api/v2/supply/agent-challenges/:challengeId` |
| POST | `/api/v2/supply/agent-challenges/:challengeId/revoke` |
| GET | `/api/v2/supply/contracts` |
| GET | `/api/v2/supply/contracts/:contractId` |
| GET | `/api/v2/supply/dashboard` |
| GET, POST | `/api/v2/supply/devices/:deviceId/retirement` |
| POST | `/api/v2/supply/devices/:deviceId/verify` |
| GET | `/api/v2/supply/earnings` |
| GET, POST | `/api/v2/supply/offers` |
| POST | `/api/v2/supply/offers/:offerId/status` |
| GET | `/api/v2/supply/policy` |
| GET, PUT | `/api/v2/supply/profile` |
| POST | `/api/v2/supply/profile/submit` |
