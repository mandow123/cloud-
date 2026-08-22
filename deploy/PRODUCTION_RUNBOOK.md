# KAI Cloud 生产运维基线

本目录提供可复现的单机生产基线，不会自行修改服务器。当前业务仍未接入真实供应商库存与正式身份体系；真实资料上线前还必须完成身份认证、授权和数据合规审查。

## 服务目标

- 业务数据库备份：每小时第 15 分钟执行一次。
- 默认本机保留：48 个小时副本、30 个每日副本、不保留每月副本；任何恢复包都不得超过 30 天。
- 目标 RPO：不超过 1 小时；只有备份已同步到异地主机或开启版本控制的对象存储时，该目标才覆盖整机故障。
- 目标 RTO：不超过 30 分钟。
- 行情更新：每天北京时间 06:00，失败时继续提供最后一个通过校验的快照并触发告警。

## 不可变发布要求

`KAI_IMAGE` 必须使用镜像 digest，`KAI_RELEASE_SHA` 必须对应已经通过测试的 Git 提交：

```text
registry.example.com/kai-cloud-market@sha256:<64 hexadecimal characters>
```

禁止使用 `latest`、`current` 或普通版本 tag。应用、备份任务和行情更新任务必须引用同一个已验证 digest。发布记录应同时保存：Git 提交、镜像 digest、数据库迁移版本和构建测试结果。

Compose 会把 `KAI_IMAGE` 以 `KAI_IMAGE_REFERENCE` 传入应用容器，供启动门禁核对自身镜像口径。两者必须是同一个 `repository@sha256:<64 位小写十六进制>` 引用；全零 digest 也会被拒绝。

## 本机私有镜像仓库与构建晋级

`deploy/compose.registry.yml` 提供只绑定 `127.0.0.1:5443` 的持久化 OCI Registry。它固定使用 Docker Official Image `registry:3.1.1@sha256:1be55279f18a2fe1a74edf2664cac61c1bea305b7b4642dab412e7affdcb3e33`；该 manifest-list digest 于 2026-08-03 通过 Docker Hub 官方 API 核对，上游对应 CNCF Distribution v3.1.1。不得改成可变 tag，也不得把 5443 开到安全组或公网监听。

引导步骤必须由获批的目标主机管理员执行：

1. 创建 `/opt/kai-cloud-registry/{data,certs,auth}`。`data` 使用 `1000:1000` 和 `0750`；`certs`、`auth` 使用 `root:1000` 和 `0750`。
2. 由受信 CA 签发包含 `IP:127.0.0.1`（以及需要时 `DNS:localhost`）SAN 的 TLS 证书，分别安装为 `certs/registry.crt` 与 `certs/registry.key`。证书可读权限不高于 `0444`，私钥必须为 `0440 root:1000`。证书和私钥不得提交仓库。
3. 使用 Apache `htpasswd -B` 交互生成 bcrypt 文件 `auth/htpasswd`，权限 `0440 root:1000`。文件必须在启动前存在；禁止占位账号、命令行明文密码或把密码写进 env 文件。
4. 将 `deploy/kai-cloud-registry.env.example` 复制为 `/etc/kai-cloud/kai-cloud-registry.env`，权限 `0640 root:root`。把注册表 CA 复制到 Docker 的 `127.0.0.1:5443` 信任目录并重启 Docker；不得使用 `insecure-registries` 绕过 TLS。
5. 从仓库根目录运行 `docker compose --env-file /etc/kai-cloud/kai-cloud-registry.env -f deploy/compose.registry.yml config --quiet`，人工核对只出现 loopback 端口和专用数据目录，再运行 `up -d --wait`。通过 `curl --cacert ... --user <账号> https://127.0.0.1:5443/v2/` 验证未认证为 `401`、正确认证为 `200`。
6. 使用 `docker login 127.0.0.1:5443 --username <账号> --password-stdin`，密码仅从受控密码管理器经标准输入传入；晋级脚本从不接收或输出仓库凭据。

构建晋级必须在干净 Git 提交上执行。脚本用 `git archive HEAD` 作为构建上下文、把完整提交 SHA 写入 OCI revision label、推送唯一的完整 SHA tag，然后重新拉取并核对 RepoDigest、revision label 与 `linux/amd64` 或 `linux/arm64`：

```bash
# 后续发布必须传当前 release env；首次发布方式见下文。
npm run ops:image:promote -- \
  --repository 127.0.0.1:5443/kai-cloud-market \
  --platform linux/amd64 \
  --output-dir /var/lib/kai-cloud-releases \
  --previous-env /etc/kai-cloud/kai-cloud-release.env
```

首次发布用 `--initial-release` 代替 `--previous-env`。输出只包含 `KAI_IMAGE=repository@sha256:...`、提交 SHA、平台和既有 3051/30 天策略，不包含密码；同时生成不可覆盖的 JSON 记录，保存 current 与 previous digest。管理员核对后才可原子替换 `/etc/kai-cloud/kai-cloud-release.env`。在目标主机加载该文件后运行 `npm run ops:image:validate`，门禁会拒绝本机不存在的镜像、RepoDigest 不匹配、revision 不匹配或 OS/架构不匹配。

仓库磁盘达到 70% 时预警、85% 时停止新的晋级并人工处理。清理前必须保留当前和上一已验证 digest/tag、两份发布记录及其恢复演练证据。Registry 垃圾回收是 stop-the-world 操作：先停止 Registry 并为 `/opt/kai-cloud-registry/data` 创建已校验备份，再用固定 digest 镜像运行 `registry garbage-collect --dry-run`；人工确认 mark 集仍含 current/previous 后，才允许在 Registry 仍停止的情况下执行正式 GC。GC 期间禁止 push，禁止直接删除 `data` 子目录；完成后重启并重新拉取、验证 current 和 previous 两个 digest。任何一步失败都从仓库数据备份恢复，不能继续应用发布。

## 主机目录与权限

建议状态根目录为 `/opt/kai-cloud-3051`：

```text
/opt/kai-cloud-3051/db       # 仅应用与备份任务可写
/opt/kai-cloud-3051/market   # 更新任务可写，应用和备份任务只读
/opt/kai-cloud-3051/backups  # 仅备份任务可写
```

创建目录时固定为容器运行 UID/GID 1000，权限 `0750`。不要把三个目录重新合并，也不要把宿主机根目录或 `/opt` 整体挂入容器。

从旧版单目录迁移时，先通过旧数据库的一致性备份生成恢复包，再恢复到新目录。SQLite 启用 WAL 时，禁止只复制 `kai-cloud.sqlite`；主文件、WAL 与 SHM 的普通文件复制不构成可靠备份。

## 配置和安装

1. 将 `deploy/kai-cloud-release.env.example` 复制到 `/etc/kai-cloud/kai-cloud-release.env`，替换真实 digest 和发布 SHA，权限设为 `0640 root:root`。该文件供应用 Compose 发布和 systemd 运维任务共同读取。
2. 将 `deploy/kai-cloud-app.env.example` 复制到 `/etc/kai-cloud/kai-cloud-app.env`，权限同样为 `0640 root:root`。使用受信随机源生成 32 字节随机值，建议以 64 位小写十六进制写入 `KAI_CURSOR_SECRET`（例如在受控主机运行 `openssl rand -hex 32`），不得使用示例值；`KAI_PUBLIC_ORIGIN` 必须是最终 HTTPS 域名。初次发布保持 `KAI_ENABLE_HSTS=0`；只有真实域名、证书续期、HTTP 到 HTTPS 跳转和关键业务流程均验证通过后，才改为 `KAI_ENABLE_HSTS=1` 并重启应用。应用密钥文件不能被备份或行情更新 unit 读取。
3. 将以下脚本安装到 `/usr/local/lib/kai-cloud/`，权限 `0644 root:root`：

   - `kai-cloud-market-update-run.sh`
   - `kai-cloud-backup-run.sh`
   - `kai-cloud-ops-alert.sh`

4. 将三个 service unit 和两个 timer 安装到 `/etc/systemd/system/`：

   - `kai-cloud-market-update.service`
   - `kai-cloud-market-update.timer`
   - `kai-cloud-backup.service`
   - `kai-cloud-backup.timer`
   - `kai-cloud-ops-alert@.service`

5. 在目标 Ubuntu 主机执行 `systemd-analyze verify`。首次安装和升级的任务顺序不同，必须按下方对应流程操作；恢复演练通过前不得启用 timer。

`flock` 防止同一任务重入，`timeout` 将总运行时间限制为 300 秒。备份脚本还必须在 `${KAI_STATE_ROOT}/backups/.kai-cloud-backup.lock` 取得共享锁；因此即使升级时残留了不同名称的旧 unit，也不能同时清理同一状态目录。迁移到带端口后缀的 unit 时，应先执行 `systemctl disable --now` 停用旧 backup timer，确认只有一个 timer 指向该 `KAI_STATE_ROOT`，再启用新 timer。两个任务都使用只读根文件系统、非 root 用户、能力全移除、资源上限和日志轮转。行情更新容器完全看不到业务数据库目录。

## 声明式应用启动

受支持的启动路径必须先加载两份环境文件并执行部署门禁，再启动并等待健康检查：

```bash
(
  set -a
  . /etc/kai-cloud/kai-cloud-release.env
  . /etc/kai-cloud/kai-cloud-app.env
  set +a

  npm run ops:deploy:validate -- --current-env
  docker compose \
    --env-file /etc/kai-cloud/kai-cloud-release.env \
    --env-file /etc/kai-cloud/kai-cloud-app.env \
    -f deploy/compose.production.yml config --quiet
  docker compose \
    --env-file /etc/kai-cloud/kai-cloud-release.env \
    --env-file /etc/kai-cloud/kai-cloud-app.env \
    -f deploy/compose.production.yml up -d --wait app
)
```

门禁会拒绝：不足 32 UTF-8 字节或已知占位值的 `KAI_CURSOR_SECRET`、非规范 HTTPS 公网 origin、非完整 40/64 位小写十六进制发布 SHA、可变 tag 或占位 digest、关闭的 HTTPS/代理标志、非 `0`/`1` 的 HSTS 标志，以及不安全或不存在的状态目录。镜像自己的 entrypoint 会在 `server.js` 之前重复相同校验；任一条件不满足时容器以非零状态退出，`up --wait` 不会报告成功。不要把跳过 `ops:deploy:validate -- --current-env`、删除 entrypoint 或不等待健康检查的命令当作受支持的发布路径。

应用端口只绑定 `127.0.0.1:3051`。私网 3054 必须运行 `kai-cloud-edge-http-3054.service`，由它覆盖而不是继承请求中的 `Host`、`Forwarded` 与 `X-Forwarded-*`，并向应用固定签发 `X-Forwarded-Proto: https`。因此生产配置固定启用 `KAI_TRUST_PROXY=1`，并同时设置 `KAI_REQUIRE_HTTPS_WRITES=1`；任何绕过反向代理的明文写请求都会被拒绝。不得在公网边界继续使用旧的 `kai-cloud-edge-3054.socket` 原始 TCP 转发，否则应用无法确认 TLS 已在上游终止，安全 Cookie 和会员写入会保持关闭。容器内业务数据库和行情目录固定分别挂载到 `/app/db` 与 `/app/market`，不得合并或改成应用根目录。容器还具有 1 CPU、512MB 内存、256 PIDs、只读根文件系统、日志轮转和 `/api/live` 存活检查。`/api/ready` 用于发布和反向代理就绪判断，不应替代存活检查。

切换前必须用同一份 Nginx 配置在临时回环端口演练 `/api/live` 与 `/api/session`，确认会话响应设置 `__Host-` 安全 Cookie。正式切换时停止并禁用 `kai-cloud-edge-3054.socket`，再启用 `kai-cloud-edge-http-3054.service`。若公网健康检查、登录回调或会员写入任一失败，立即停止新服务并重新启用原 socket；应用容器、数据库与审计数据无需回滚。人工询价的未完成需求只写入旧版会忽略的 `marketplace_request_staging_v1` 侧表，公开市场主表继续保持 v4 约束和 v4 迁移元数据；因此旧应用可以直接启动，且不会看见尚未完成侧车记录的需求。发布前必须运行对应的 SQLite/D1 v4 回退兼容测试，禁止再次通过提升市场主版本来实现私有暂存。

Hosting V2 试运营固定使用管理员双人审批发放卡时，`KAI_ALIPAY_ENABLED` 必须保持 `0`；即使主机残留完整商户凭据也不能创建付款单。申请账号使用唯一 Root，审批账号使用独立的 `KAI_ADMIN_APPROVER_USERNAME` 与 `KAI_ADMIN_APPROVER_PASSWORD_HASH`，两个用户名、密码和实际操作者都必须不同；审批账号只获得卡时审批和只读审计权限。先设置 `KAI_HOSTING_V2_SETUP=1`、`KAI_HOSTING_V2=0` 进入预上线配置模式，仅完成供应商审核、费率、Agent 配对、设备验真和挂牌草稿；公开市场、租用、开通、启动、扣减和结算仍由服务端拒绝。设备退场接口使用独立开关 `KAI_HOSTING_DEVICE_RETIREMENT`，默认必须保持 `0`，完成 Root 应急撤权和受控退场演练后才可在 Setup 或交易模式下开启。配置模式只允许 Agent 执行验真，以及既有实例的停止与清理收尾，不能领取新的开通或启动命令。启用 `KAI_HOSTING_V2=1` 前必须配置 KAI Identity、不可变交付镜像和供应协议版本，并在隔离入口完成供应商审批、有效费率、在线 Host Agent、三分钟计量及清理演练。`/api/ready` 会逐项报告供应身份、Agent、费率、卡时账本、镜像、协议、计量、清理和支付宝关闭状态，任一关键项失败时新版本不得接入流量。

Telemetry-only Agent 使用独立开关 `KAI_AGENT_TELEMETRY_V1`，默认固定为 `0`。只有完成 `0032_hosting_agent_capability_modes.sql` 后才可独立置为 `1`，不需要开启 Hosting V2 Setup 或交易；它只开放绑定已审核个人 GPU 供应申请的登记与心跳，不开放验真、挂牌、实例开通或任何控制命令。回退时先把开关恢复为 `0`：停止签发和登记新遥测设备，但保留既有设备心跳、序列及审计记录；旧应用会忽略新增的 nullable/default 列，无需破坏性回滚数据库。

人工 SSH 交付应另建 `KAI_ADMIN_FULFILLMENT_USERNAME` / `KAI_ADMIN_FULFILLMENT_PASSWORD_HASH` 对应的交付管理员。该账号仅获得交付读取、交付处理和审计读取能力，不能发布市场、操作支付或结算；用户名和密码都必须与 Root、财务审批账号不同。Root 仅作为应急回退，不作为日常交付账号。公钥原文只能由授权管理员在交付工单中按需展开，供应商与买家面板只显示指纹和各自可见的真实状态。

账户控制台使用独立开关 `KAI_ACCOUNT_CONSOLE_V2`，默认必须为 `0`。启用后，`/member*` 与 `/supply*` 共用账户控制台外壳，但买家和供应商仍分别读取当前登录会话的 `activeOrganization` 数据；供应资格未通过时不显示设备、挂牌、订单或收益入口。该批次没有数据库迁移，需回退时把 `KAI_ACCOUNT_CONSOLE_V2=0` 并按标准流程重启应用，即恢复旧页面；不要同时改动 Hosting V2、支付或 Agent 开关。

购买目录使用独立开关 `KAI_BUY_CATALOG_V2`，默认必须为 `0`。启用后，`/buy` 公开展示经过服务端资格筛选的供应商套餐，并把历史报价资料分离为只能提交撮合需求的市场线索；登录后的询价仍由 `KAI_MANUAL_DELIVERY_INTAKE` 单独控制。该目录不会锁库存、扣卡时、创建合同或调用 Agent。需回退时把 `KAI_BUY_CATALOG_V2=0` 并重启应用，`/buy` 将返回现有 GPU 目录；不要同时开启 Hosting V2 交易或支付开关。

每次状态推进都必须运行生产 Hosting 闸门，并把单行 JSON 结果存入发布记录。四个阶段不可跳级：

```bash
KAI_HOSTING_VERIFY_STAGE=SETUP npm run ops:hosting:verify
KAI_HOSTING_VERIFY_STAGE=AGENT_CONNECTED npm run ops:hosting:verify
KAI_HOSTING_VERIFY_STAGE=INTERNAL_TRIAL npm run ops:hosting:verify
KAI_HOSTING_VERIFY_STAGE=MARKET npm run ops:hosting:verify
```

`SETUP` 要求公开交易关闭且尚无在线 Agent；`AGENT_CONNECTED` 要求至少一台真实 Agent 在线，但仍保持公开交易关闭；`INTERNAL_TRIAL` 要求所有交易依赖就绪且没有 DRAINING、清理失败或清理中的订单；`MARKET` 在此基础上还要求公开 `/api/v2/offers` 至少存在一条经过验真、可成交的 GPU 报价。发布时应同时设置 `KAI_HOSTING_VERIFY_RELEASE=<完整提交 SHA>`，防止校验到旧容器。脚本只读取公开 JSON，不接收 Cookie、密钥或管理员凭据。

KAI Identity 上游修复后，在 Cloud 源码目录运行 `npm run ops:identity:validate`。只有工具返回 `OIDC_DISCOVERY_READY` 才能继续登录验收；308、任意重定向、非 JSON、Issuer 或端点不一致都视为未修复。该检查不携带 Client ID、Cookie、授权码或其他凭据。随后用全新隐私窗口发起一次完整登录，确认授权码被 Cloud 回调兑换并建立普通用户会话。

重构后的 Identity 固定使用 `https://auth.kai.com/api/auth` 和机密 Web Client。管理员只在服务器创建 `0600 root:root` 的 JSON 文件，字段严格为 `clientId`、`clientSecret`；密钥不得进入聊天、工单、Shell 参数或日志。运行 `npm run ops:identity:configure -- --env-file /etc/kai-cloud/kai-cloud-app.env --credential-file /root/kai-cloud-identity-client.json --confirm CONFIGURE_KAI_IDENTITY_WEB_CLIENT` 会先校验新 Discovery，再原子替换四项 OIDC 配置并生成带 UTC 时间的 `.pre-identity-*` 回退文件。之后仍必须依次运行生产环境门禁、`ops:identity:validate`、Compose 健康启动和真实浏览器回调验收。任一步失败都恢复该回退文件并重新创建应用容器，不能用 SPA Client、伪造 Secret 或关闭服务端换码认证绕过。

生产调度使用 systemd；Compose 中 `market-update` 和 `backup` 的 `ops` profile 只用于受控人工验证。

## 首次安装与升级顺序

首次安装时数据库尚不存在，不能把“先备份”作为启动前置条件。正确顺序是：

1. 创建 `/opt/kai-cloud-*/{db,market,backups}`，设置 UID/GID 1000 与 `0750` 权限，并安装环境文件、脚本和 systemd units。
2. 人工运行一次行情更新，确认 `market/model-market.snapshot.json` 已生成且校验通过。
3. 仅在回环端口启动应用，不接入外部流量；必须使用上一节的部署门禁和 `up -d --wait app`。
4. 请求 `/api/ready`，让应用创建或迁移数据库，并确认返回就绪、schema 版本正确、行情不过期。
5. 此时才人工执行第一次备份，再把恢复包还原到全新的隔离目录并完成 `quick_check`、外键、迁移版本和业务冒烟验证。
6. 只有恢复演练成功后，才启用 backup/update timers，并把 HTTPS 反向代理流量切入应用。

升级已有实例时顺序相反：必须在替换应用前创建并异地同步一致性备份、验证恢复包，再用隔离数据库副本启动新 digest 的 canary。迁移、`/api/ready` 和业务冒烟通过后才允许短暂停写、替换应用并切换流量。不得用首次安装的“启动后首次备份”顺序处理已有生产数据。

### 0032 预部署门禁

包含 Telemetry-only Agent 数据投影的新镜像无论 `KAI_AGENT_TELEMETRY_V1` 是 `0` 还是 `1`，都依赖 `0032_hosting_agent_capability_modes.sql` 新增的列和索引。必须先用候选 digest 对真实持久化数据库做只读分类，不能无条件执行迁移：

```bash
docker compose -f deploy/compose.production.yml run --rm app \
  node scripts/ops/verify-hosting-agent-capability-schema.mjs \
  --allow-uninitialized
```

- 返回 `status=ok` 且 `hostingInitialized=false`：共享数据库已有其他业务，但 Hosting 完全未初始化。**不得执行 0032**；直接按首次安装流程启动新镜像，让应用一次性创建完整 Hosting schema。启动后必须再次执行不带参数的只读门禁，并确认 `/api/ready` 通过，才能接入流量。
- 返回 `status=ok` 且 `hostingInitialized=true`：0032 已就绪，无需重复迁移；继续只读复核和新镜像冒烟。
- 返回 `HOSTING_AGENT_CAPABILITY_SCHEMA_NOT_READY` 且状态明确为完整 v14 Hosting schema、仅缺少 0032 的四列和两个索引：走下述“已有 Hosting 升级”分支。
- 返回 `HOSTING_AGENT_CAPABILITY_SCHEMA_PARTIAL`、版本标记异常、索引异常或任何其他错误：立即停止发布并从已验证恢复包排查，禁止执行 0032 或人工补列。

已有完整 v14 Hosting 的升级步骤：

1. 完成一致性备份、异地同步和恢复验证，并先在恢复副本执行相同迁移与门禁。
2. 进入短暂停写，停止当前应用容器；不得让旧、新两个 SQLite 写实例并行。
3. 使用候选 digest 和真实持久化数据库挂载执行受控迁移：

```bash
docker compose -f deploy/compose.production.yml run --rm app \
  node scripts/ops/verify-hosting-agent-capability-schema.mjs \
  --apply --confirm APPLY_0032_HOSTING_AGENT_CAPABILITY_MODES
```

4. 再以只读模式执行同一门禁；它必须确认 schema marker 仍为 v14、两个表的 `application_id` / `capability_mode` 列以及两个查询索引全部存在：

```bash
docker compose -f deploy/compose.production.yml run --rm app \
  node scripts/ops/verify-hosting-agent-capability-schema.mjs
```

5. 只有门禁返回单行 `status=ok` 且 `hostingInitialized=true` 后才可启动新镜像、请求 `/api/ready` 并执行业务冒烟。门禁失败时不得切换镜像；恢复上一 digest 前无需删除新增列，因为 0032 保持 marker v14 且旧应用会忽略这些向后兼容列。任何部分迁移都会 fail-closed，必须从已验证恢复包恢复后重试，禁止人工补列绕过门禁。

### 0033 七相卡时充值预部署门禁

新镜像即使 `KAI_QIXIANG_PAY_ENABLED=0` 也会读取 0033 增加的充值通道与收银台快照列，因此必须在切换镜像前执行只读门禁。先把候选提交克隆或解包到 `/opt/kai-cloud-release-sources/<完整提交 SHA>`，整个目录必须是 `root:root` 且不能由组或其他用户写；以 root 核对 `git rev-parse HEAD`、干净工作树和候选 release env 文件名中的 SHA 完全相同。然后只用系统 `install` 从该 root-owned 候选源安装本提交中受审的两个固定副本，不得通过 `sudo` 执行普通用户工作区中的 runner 或引用其中的 Compose：

```sh
(
  set -eu
  : "${KAI_CANDIDATE_RELEASE_ENV:?set the generated candidate release env path}"
  KAI_CANDIDATE_SHA=${KAI_CANDIDATE_RELEASE_ENV##*/kai-cloud-release-}
  KAI_CANDIDATE_SHA=${KAI_CANDIDATE_SHA%.env}
  printf '%s\n' "$KAI_CANDIDATE_SHA" | grep -Eq '^[0-9a-f]{40}$'
  KAI_CANDIDATE_SOURCE="/opt/kai-cloud-release-sources/$KAI_CANDIDATE_SHA"
  test "$(sudo git -C "$KAI_CANDIDATE_SOURCE" rev-parse HEAD)" = "$KAI_CANDIDATE_SHA"
  test -z "$(sudo git -C "$KAI_CANDIDATE_SOURCE" status --porcelain --untracked-files=all)"
  test -z "$(sudo find "$KAI_CANDIDATE_SOURCE" -xdev \( ! -user root -o ! -group root -o -perm /022 \) -print -quit)"
  sudo install -d -o root -g root -m 0755 /usr/local/lib/kai-cloud /etc/kai-cloud
  sudo install -o root -g root -m 0755 \
    "$KAI_CANDIDATE_SOURCE/scripts/ops/run-production-schema-gate.sh" \
    /usr/local/lib/kai-cloud/run-production-schema-gate.sh
  sudo install -o root -g root -m 0644 \
    "$KAI_CANDIDATE_SOURCE/deploy/compose.production.yml" \
    /etc/kai-cloud/kai-cloud-schema-gate.compose.yml
)
```

运行器会再次拒绝符号链接、错误 owner/mode、可被组或其他用户写入的发布目录、应用 env 中重复的 release-owned 键、继承的宿主环境以及任何未列入白名单的命令。候选 env 只能包含晋级工具生成的 10 个发布字段：文件内 SHA 必须等于文件名 SHA，镜像必须是非零不可变 digest，平台、状态目录、容器前缀和备份保留策略必须符合本机固定策略；任何额外、重复、缺失或异常字段都会在 Compose 前阻断。`KAI_CANDIDATE_RELEASE_ENV` 必须指向晋级脚本生成的、尚未替换现网配置的候选 release env；运行器以清洁环境调用 Compose，先读取应用 env、再由候选 release env 最终确定镜像、提交和状态目录。禁止把包含密钥的应用 env 当 shell 文件加载：

```sh
(
  set -eu
  : "${KAI_CANDIDATE_RELEASE_ENV:?set the generated candidate release env path}"
  sudo /usr/local/lib/kai-cloud/run-production-schema-gate.sh "$KAI_CANDIDATE_RELEASE_ENV" \
    node scripts/ops/verify-qixiang-card-hour-schema.mjs --allow-uninitialized
)
```

- `cardHourInitialized=false` 表示共享数据库中卡时系统完全未初始化：不得单独执行 0033，由新应用首次启动创建完整结构。
- `QIXIANG_CARD_HOUR_SCHEMA_NOT_READY` 且确认是完整旧 v3、仅缺 0033 时，必须先执行下面的统一迁移前备份门禁，并在隔离副本演练。该备份发生在 0033 的第一笔写入之前；不得把后续 0036 章节中的备份当作 0033 的恢复点：

```sh
(
  set -eu
  KAI_BACKUP_UNIT=kai-cloud-backup.service
  if sudo systemctl cat kai-cloud-backup-3051.service >/dev/null 2>&1; then
    KAI_BACKUP_UNIT=kai-cloud-backup-3051.service
  elif ! sudo systemctl cat "$KAI_BACKUP_UNIT" >/dev/null 2>&1; then
    printf '%s\n' "KAI Cloud backup unit is not installed" >&2
    exit 1
  fi
  sudo systemctl start "$KAI_BACKUP_UNIT"
)
```

只有同步备份成功、恢复包 manifest/哈希/`quick_check`/外键检查通过且已在隔离目录完成恢复验证后，才能执行 0033 写迁移：

```sh
(
  set -eu
  : "${KAI_CANDIDATE_RELEASE_ENV:?set the generated candidate release env path}"
  sudo /usr/local/lib/kai-cloud/run-production-schema-gate.sh "$KAI_CANDIDATE_RELEASE_ENV" \
    node scripts/ops/verify-qixiang-card-hour-schema.mjs \
    --apply --confirm APPLY_0033_QIXIANG_CARD_HOUR_TOPUPS
)
```

- 任何部分表、部分列、marker 异常或外键检查错误必须停止发布，不得手工补列。
- 常规回退先设置 `KAI_QIXIANG_PAY_ENABLED=0` 停止新单；只要查单凭据仍可信，就保持 `KAI_QIXIANG_PAY_RECONCILIATION_ENABLED=1`，让存量 `PENDING`、`PROCESSING` 或 `RECONCILIATION_REQUIRED` 订单继续受控核对。只有查单凭据或上游发生安全事件时才把两个开关都设为 `0`，并立即把存量订单转入管理员人工核对。

### 0036 充值申诉侧车预部署门禁

0036 只新增申诉与不可变事件侧车，不会修改付款、卡时钱包、账本、退款或支付状态。发布前必须先做备份，再运行独立只读验证器；验证器同时逐字比对 SQLite `drizzle/0036_card_hour_topup_appeals.sql` 与 D1 `.openai/drizzle/0036_card_hour_topup_appeals.sql`，任何镜像差异都阻断发布：

```sh
(
  set -eu
  KAI_BACKUP_UNIT=kai-cloud-backup.service
  if sudo systemctl cat kai-cloud-backup-3051.service >/dev/null 2>&1; then
    KAI_BACKUP_UNIT=kai-cloud-backup-3051.service
  elif ! sudo systemctl cat "$KAI_BACKUP_UNIT" >/dev/null 2>&1; then
    printf '%s\n' "KAI Cloud backup unit is not installed" >&2
    exit 1
  fi
  sudo systemctl start "$KAI_BACKUP_UNIT"
  : "${KAI_CANDIDATE_RELEASE_ENV:?set the generated candidate release env path}"
  sudo /usr/local/lib/kai-cloud/run-production-schema-gate.sh "$KAI_CANDIDATE_RELEASE_ENV" \
    node scripts/ops/verify-card-hour-topup-appeals-schema.mjs --allow-uninitialized
)
```

- `cardHourInitialized=false` 表示卡时库尚未初始化，由新应用首次启动创建完整结构，不单独应用 0036。
- 只有完整 marker v3、两个申诉表及其索引/触发器全不存在时，才可先在备份副本演练，再显式应用：

```sh
(
  set -eu
  : "${KAI_CANDIDATE_RELEASE_ENV:?set the generated candidate release env path}"
  sudo /usr/local/lib/kai-cloud/run-production-schema-gate.sh "$KAI_CANDIDATE_RELEASE_ENV" \
    node scripts/ops/verify-card-hour-topup-appeals-schema.mjs \
    --apply --confirm APPLY_0036_CARD_HOUR_TOPUP_APPEALS
  sudo /usr/local/lib/kai-cloud/run-production-schema-gate.sh "$KAI_CANDIDATE_RELEASE_ENV" \
    node scripts/ops/verify-card-hour-topup-appeals-schema.mjs
)
```

验证必须确认 marker v4-v6、两个表、三个索引、两个不可变触发器、两条外键和 `PRAGMA foreign_key_check` 均正常。D1 只能从镜像中完全相同的 0036 文件走受控迁移流水线。回退时先将支付与核对开关都设为 `0`，不得删除侧车表；应用只能回退到支持 marker v4-v6 的镜像。若迁移后尚无任何新写入且必须恢复数据库，只能由当班负责人从迁移前已验证备份整体恢复，禁止手工删表或改 marker。

### 0037 申诉站内通知预部署门禁

0037 新增按组织隔离的申诉已读回执，不修改付款、卡时、账本或申诉状态。它必须在 0036 完成、卡时 marker 为 v4 后显式应用；验证器会逐字比对 SQLite 与 D1 迁移镜像，并拒绝任何部分表、部分索引或外键异常：

```sh
(
  set -eu
  : "${KAI_CANDIDATE_RELEASE_ENV:?set the generated candidate release env path}"
  sudo /usr/local/lib/kai-cloud/run-production-schema-gate.sh "$KAI_CANDIDATE_RELEASE_ENV" \
    node scripts/ops/verify-card-hour-topup-appeal-reads-schema.mjs \
    --apply --confirm APPLY_0037_CARD_HOUR_TOPUP_APPEAL_READS
  sudo /usr/local/lib/kai-cloud/run-production-schema-gate.sh "$KAI_CANDIDATE_RELEASE_ENV" \
    node scripts/ops/verify-card-hour-topup-appeal-reads-schema.mjs
)
```

门禁必须确认 marker v5、已读回执表、组织时间索引、申诉外键和 `PRAGMA foreign_key_check` 全部正常；随后才能执行 0038。D1 必须使用镜像中完全相同的 0037 文件走受控迁移流水线。回退不得删表或回退 marker；只有迁移后尚无新写入且发生无法修复的结构异常时，才允许由当班负责人整体恢复迁移前备份。

### 0038 支付核单租约预部署门禁

0038 新增持久化核单租约和到期索引，保证回调、会员回跳页和多实例并发时同一付款单只有一个服务端查单请求。它必须在 0037 完成、卡时 marker 为 v5 后应用；不得跳过 marker 或手工建表：

```sh
(
  set -eu
  : "${KAI_CANDIDATE_RELEASE_ENV:?set the generated candidate release env path}"
  sudo /usr/local/lib/kai-cloud/run-production-schema-gate.sh "$KAI_CANDIDATE_RELEASE_ENV" \
    node scripts/ops/verify-card-hour-topup-reconciliation-schema.mjs \
    --apply --confirm APPLY_0038_CARD_HOUR_TOPUP_RECONCILIATION
  sudo /usr/local/lib/kai-cloud/run-production-schema-gate.sh "$KAI_CANDIDATE_RELEASE_ENV" \
    node scripts/ops/verify-card-hour-topup-reconciliation-schema.mjs
)
```

门禁必须确认 SQLite/D1 迁移逐字一致、marker 为 v6、租约表、请求幂等表、两个索引、订单外键和 `foreign_key_check` 全部正常。新单开关保持 `0`，直到此门禁和 `/api/ready` 都通过。

- 七相旧版协议的查单接口要求把商户密钥放入查询参数，因此只有 `KAI_QIXIANG_PAY_RECONCILIATION_ENABLED=1` 且全部门禁就绪时，专用服务端客户端才可调用固定的 `https://api.payqixiang.cn/api.php`：禁止重定向、代理、浏览器调用、完整 URL 日志和错误原文回显。签名通知本身不得直接入账；必须主动查单确认 `status=1`，并逐项核对 PID、商户订单号、七相订单号、通道、商品名、金额和扩展参数。浏览器回跳页只调用本平台鉴权接口，由服务端抢占持久化租约后查单；浏览器不接触密钥，也不读取回跳参数作为成功依据。退款保持人工待处理，未取得可验证退款协议前不得宣称退款成功。

启用七相新订单必须按顺序执行，任何一步失败都保持 `KAI_QIXIANG_PAY_ENABLED=0`：

生产配置必须使用 `scripts/ops/configure-qixiang-pay-env.mjs`，禁止用文本编辑器或 Shell 替换密钥。先在七相后台轮换商户密钥并作废曾进入聊天、日志或工单的旧密钥；配置器和运行时门禁都会拒绝已撤销密钥的 SHA-256 指纹。将以下精确 JSON 字段写入 `/root/kai-qixiang-production.json`，文件必须是 `0600 root:root`，父目录不能由非 root 写入：`pid`、`key`、`approvalReference`、`credentialVersion`、`credentialRotatedAt`、`riskReference`、`queryCredentialId`、`queryCredentialVersion`、`queryCredentialRotatedAt`、`channel`、`organizations`。两个时间必须是七相后台实际轮换时刻的 UTC ISO 8601 值，不能使用部署时间冒充轮换时间；`channel` 固定为 `ALIPAY`，`organizations` 必须逐项等于本次获批且仍为 `ACTIVE` 的组织 ID。当前首批必须核对工具输出 `organizationCount=7`。

第一阶段只启用主动查单。应用环境必须仍为 `KAI_QIXIANG_PAY_ENABLED=0`、`KAI_QIXIANG_PAY_RECONCILIATION_ENABLED=0`：

```sh
sudo node /opt/kai-cloud-release-sources/<受审完整提交>/scripts/ops/configure-qixiang-pay-env.mjs \
  --env-file /etc/kai-cloud/kai-cloud-app.env \
  --credential-file /root/kai-qixiang-production.json \
  --mode reconciliation \
  --confirm CONFIGURE_QIXIANG_PRODUCTION_PAYMENT
sudo docker compose -p kai-cloud-3051 \
  -f /opt/kai-cloud-release-sources/<受审完整提交>/deploy/compose.production.yml \
  --env-file /etc/kai-cloud/kai-cloud-app.env \
  --env-file /etc/kai-cloud/kai-cloud-release.env up -d --wait app
curl -fsS https://cloud.kai.com/api/ready | jq -e \
  '.capabilities.qixiangPayCardHourTopup | .reconciliationAvailable == true and .reconciliationEnabled == true and .available == false and .enabled == false'
```

产品、发布与财务复核第一阶段的 `/api/ready`、固定查单端点和 7 个组织后，第二阶段只能从 `PAY=0/RECON=1` 且所有非密钥配置和密钥完全未漂移的状态单独开启新单；配置器不会重写凭据轮换时间：

```sh
sudo node /opt/kai-cloud-release-sources/<受审完整提交>/scripts/ops/configure-qixiang-pay-env.mjs \
  --env-file /etc/kai-cloud/kai-cloud-app.env \
  --credential-file /root/kai-qixiang-production.json \
  --mode payment \
  --confirm CONFIGURE_QIXIANG_PRODUCTION_PAYMENT
sudo docker compose -p kai-cloud-3051 \
  -f /opt/kai-cloud-release-sources/<受审完整提交>/deploy/compose.production.yml \
  --env-file /etc/kai-cloud/kai-cloud-app.env \
  --env-file /etc/kai-cloud/kai-cloud-release.env up -d --wait app
curl -fsS https://cloud.kai.com/api/ready | jq -e \
  '.capabilities.qixiangPayCardHourTopup | .reconciliationAvailable == true and .reconciliationEnabled == true and .available == true and .enabled == true'
```

每次配置都会输出不含密钥的 `backupFile`。任一验证失败，使用同目录临时文件、持久化同步和原子重命名恢复对应阶段前配置，再重新创建应用容器（将 `<backupFile>` 替换为工具刚输出的绝对路径）：

```sh
sudo sh -eu -c '
backup=$1; target=$2; directory=${target%/*}
test -f "$backup" && test ! -L "$backup"
test "$(stat -c "%u:%g:%a" "$backup")" = "0:0:640"
temporary=$(mktemp "$directory/.kai-cloud-env-rollback.XXXXXX")
trap '\''rm -f "$temporary"'\'' EXIT
install -o root -g root -m 0640 "$backup" "$temporary"
sync -f "$temporary"
mv -f "$temporary" "$target"
sync -f "$directory"
trap - EXIT
' sh <backupFile> /etc/kai-cloud/kai-cloud-app.env
```

恢复后验证支付开关、`/api/ready` 和存量订单核对状态。全部上线记录完成后删除 `/root/kai-qixiang-production.json`，不得把凭据文件加入常规备份、源码或工单。

1. 将经审批的变更单号写入 `KAI_QIXIANG_PAY_APPROVAL_REFERENCE`；用 `KAI_QIXIANG_PAY_CREDENTIAL_VERSION` 或 UTC ISO 8601 的 `KAI_QIXIANG_PAY_CREDENTIAL_ROTATED_AT` 登记当前商户凭据生命周期。密钥只允许写入服务器密钥配置，不得输出到日志、就绪接口或工单正文。
2. 七相旧查单协议会把密钥放入 GET URL，必须由责任人书面接受该残余风险：设置 `KAI_QIXIANG_PAY_LEGACY_QUERY_RISK_ACCEPTED=1`、`KAI_QIXIANG_PAY_LEGACY_QUERY_RISK_REFERENCE=RISK-...`，以非密钥的 `KAI_QIXIANG_PAY_QUERY_CREDENTIAL_ID=QRY-...` 登记查单凭据，并用查单凭据版本或轮换时间登记生命周期。未完成这些字段时生产校验器与应用就绪门禁都保持关闭。
3. 配置首测组织 ID 与单一支付通道。下单和查单目标固定为 `https://api.payqixiang.cn/mapi.php`、`https://api.payqixiang.cn/api.php`；客户端禁止重定向且不记录完整 URL。主动查单按凭据每进程限制为每分钟 12 次，连续 3 次传输/格式失败后熔断 60 秒；网络出口还必须只允许该固定 HTTPS 主机。上游仍可能记录 GET 查询串，因此书面风险接受不能省略，查单凭据必须可独立识别并按计划轮换。
4. 先保持支付与核对开关均为 `0`，按顺序完成 0033、0036、0037、0038 与新镜像发布；确认回调地址可从公网访问。
5. 先只将 `KAI_QIXIANG_PAY_RECONCILIATION_ENABLED=1` 并重启，确认 `/api/ready` 中 `qixiangPayCardHourTopup.reconciliationAvailable=true`、`enabled=false`；再由当班发布人与财务复核后将 `KAI_QIXIANG_PAY_ENABLED=1`，确认支付能力 `available=true` 后才允许发起新订单。
6. 首测账户前后端均固定为 5.00 卡时 / ¥5.01。真实支付属于资金动作，必须由授权人员现场确认后执行；验证成功通知必须再经主动查单后只入账一次，重复通知、重复回跳或重复查单不得重复加卡时。漏回调由回跳页的服务端核单恢复；持续未知或字段不一致才进入管理员申诉核对。完成验收前不得移除组织白名单、单通道和 5.00 卡时限制。

常规停止只把 `KAI_QIXIANG_PAY_ENABLED` 改回 `0`，新单立即停止、存量核单继续。安全事件才同时关闭 `KAI_QIXIANG_PAY_RECONCILIATION_ENABLED`；不得删除存量付款单、租约、账本或申诉数据，待处理订单必须转入管理员队列人工核对。

## 备份格式

`npm run ops:backup` 创建以下原子目录：

```text
kai-cloud-backup-<UTC timestamp>-<random>/
  kai-cloud.sqlite
  model-market.snapshot.json
  manifest.json
```

数据库通过 `VACUUM INTO` 创建一致性副本。完成前目录以 `.partial-` 开头，任何失败都不会发布为正式恢复包。正式 manifest 包含：

- 两个文件的 SHA-256 和字节数；
- `PRAGMA quick_check` 与 `PRAGMA foreign_key_check` 结果；
- `user_version`、表清单和关键表记录数；
- 行情 schema、发布时间、报价数和指数值；
- 发布号和保留策略。

保留清理只删除名称与 manifest 都符合本格式、且位于备份根目录直接子级的旧恢复包，不跟随符号链接。小时、每日与每月层级之外还存在不可放宽的 30 天年龄上限；配置值超过 30 天会被拒绝。

本机备份完成后，必须由独立的基础设施任务把完整目录同步到异地不可变存储，并对上传后的 SHA-256 再校验。异地存储也必须配置不超过 30 天的生命周期，不得借由复制备份绕过匿名业务数据的保留边界。访问密钥不得写入仓库、Compose 文件或 systemd unit。

## 隔离恢复演练

恢复命令必须指定一个尚不存在的目录：

```bash
node scripts/ops/verify-restore.mjs \
  --backup /absolute/path/to/kai-cloud-backup-... \
  --restore-dir /absolute/new/path/to/restore-candidate
```

脚本绝不覆盖已有目录。输出结构可直接作为隔离 canary 的 `KAI_STATE_ROOT`：

```text
restore-candidate/db/kai-cloud.sqlite
restore-candidate/market/model-market.snapshot.json
restore-candidate/backup-manifest.json
restore-candidate/restore-verification.json
```

上线前的恢复演练必须完成：

1. 从异地存储下载恢复包到隔离目录。
2. 校验 manifest 与两个文件的 SHA-256。
3. 验证 `quick_check=ok`、无外键违规、迁移版本和记录数一致。
4. 使用恢复目录在新端口启动同一 digest 的 canary；不得与生产实例共享数据库文件。
5. 请求 `/api/live` 与 `/api/ready`，并在恢复副本上执行一次“需求 → 报价 → 需求方查看”冒烟流程。
6. 重启 canary 后再次确认数据存在。
7. 记录备份时间、故障假设、恢复完成时间、实际 RPO/RTO 和操作者。

任一校验失败都不得切换流量。失败的恢复目录保留用于调查，确认路径后再人工清理。

## TLS 与网络边界

3051 不得直接暴露公网。上线前必须满足：

1. `cloud.kai.com` DNS 指向受控入口。
2. Caddy、Nginx 或云负载均衡器监听 443，并反向代理到 `127.0.0.1:3051`。
3. 80 仅用于跳转到 HTTPS；TLS 最低 1.2，开启自动续期和到期告警。
4. 云安全组只开放 80/443；SSH 限制到管理来源；3051 不对公网开放。
5. 通过真实域名验证页面、表单和 API，确认 TLS 续期与 HTTP 跳转后，再把 `KAI_ENABLE_HSTS=1`；不要在证书或域名尚未稳定时提前启用或预加载 HSTS。
6. 反向代理以 `/api/ready` 判断新版本是否可接流量，并保留可信代理地址配置，避免伪造转发头。
7. 在反向代理对 `/api/session` 设置每个代理实际观察到的客户端地址每分钟 30 次、突发 10 次的限流；对所有 `POST /api/*` 设置每分钟 20 次、突发 5 次的限流。超限返回 `429` 和 `Retry-After`，不得转发到应用。代理必须覆盖而不是追加外部传入的转发头；限流键和日志不得包含 Cookie、会话令牌、请求正文或供应商报价。

## 告警与监控

systemd 失败会调用 `kai-cloud-ops-alert@.service`。默认写入 journal；如需飞书、短信或监控平台通知，在主机安装可执行文件：

```text
/usr/local/lib/kai-cloud/notify-failure
```

它只接收失败 unit 名称，凭据保存在主机密钥管理中。告警至少覆盖：

- backup/update unit 非零退出或 300 秒超时；
- 最近一次有效备份超过 65 分钟；
- 行情快照超过 26 小时；
- `/api/live` 连续两次失败；
- `/api/ready` 非就绪、数据库迁移不匹配；
- 磁盘使用率 70% 预警、85% 严重；
- 容器重启、内存接近上限、TLS 证书不足 21 天。

当前版本的 API 守卫会为 API 请求输出结构化日志，字段包含请求 ID、方法、路由、状态、耗时和 release；不记录表单正文、Cookie、会话令牌、CSRF 值或供应商原始报价。容器标准输出启用轮转，运维任务写入 journal 并带失败钩子。反向代理限流日志也只记录必要的时间、路由类别、状态和去标识化来源；静态页面与代理层的完整访问日志不属于应用 API 日志覆盖范围，不得混为一谈。

## 发布与回滚门禁

发布顺序：

1. 完成异地备份并验证恢复包。
2. 在数据库副本上执行迁移和自动化测试。
3. 用新 digest、新端口和隔离数据启动 canary。
4. 通过 `/api/ready`、业务冒烟和资源观察。
5. 短暂停写后切换反向代理；单个 SQLite 文件不得同时存在两个写实例。
6. 更新 `/etc/kai-cloud/kai-cloud-release.env`，确保应用和两个定时任务使用同一 digest 与 release SHA；应用环境另由 `kai-cloud-app.env` 提供，不能复制到运维 unit。
7. 保留上一个已验证 digest、完整 SHA tag、晋级 JSON 记录和对应恢复包，观察期结束后再按保留策略清理；Registry GC 前必须再次确认 current/previous 都可按 digest 拉取。

只有数据库迁移明确向后兼容时，才允许只回退应用 digest。若 schema 不兼容，必须恢复发布前恢复包或使用经过验证的前向修复迁移。回滚也要在隔离端口完成就绪和业务冒烟，不能依赖一个未挂载持久化目录的停止容器。

## 验收命令

本地脚本自测：

```bash
npm run ops:self-test
npm run ops:deploy:validate
```

`ops:deploy:validate` 内含弱密钥、可变镜像、非法发布 SHA、HTTP/带路径 origin、关闭安全标志和危险目录的负向用例。目标主机发布时还必须在加载真实环境文件后执行 `npm run ops:deploy:validate -- --current-env`；该模式会同时检查 `/opt/kai-cloud-*/{db,market,backups}` 为已存在、非符号链接的独立目录，并检查本机镜像 RepoDigest、OCI revision label 和 OS/架构与 release env 完全一致。

发布候选至少还要通过：

```bash
npm run lint
npx tsc --noEmit
npm test
docker compose -f deploy/compose.production.yml config
systemd-analyze verify deploy/*.service deploy/*.timer
```

`systemd-analyze verify` 应在目标 Ubuntu 环境执行；Windows 上的结果不能替代目标主机校验。
