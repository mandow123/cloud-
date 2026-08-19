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
/opt/kai-cloud-3051/uploads  # 活动作品对象；应用可写，备份任务只读
/opt/kai-cloud-3051/backups  # 仅备份任务可写
```

创建目录时固定为容器运行 UID/GID 1000，权限 `0750`。首次安装可由主机管理员运行 `sudo env KAI_STATE_ROOT=/opt/kai-cloud-3051 deploy/kai-cloud-prepare-state.sh`；脚本会拒绝 `/opt/kai-cloud[-suffix]` 之外的路径和符号链接。不要把四个目录重新合并，也不要把宿主机根目录或 `/opt` 整体挂入容器。

从旧版单目录迁移时，先通过旧数据库的一致性备份生成恢复包，再恢复到新目录。SQLite 启用 WAL 时，禁止只复制 `kai-cloud.sqlite`；主文件、WAL 与 SHM 的普通文件复制不构成可靠备份。

## 配置和安装

1. 将 `deploy/kai-cloud-release.env.example` 复制到 `/etc/kai-cloud/kai-cloud-release.env`，替换真实 digest 和发布 SHA，权限设为 `0640 root:root`。该文件供应用 Compose 发布和 systemd 运维任务共同读取。
2. 将 `deploy/kai-cloud-app.env.example` 复制到 `/etc/kai-cloud/kai-cloud-app.env`，权限同样为 `0640 root:root`。使用受信随机源生成 32 字节随机值，建议以 64 位小写十六进制写入 `KAI_CURSOR_SECRET`（例如在受控主机运行 `openssl rand -hex 32`），不得使用示例值；`KAI_PUBLIC_ORIGIN` 必须是最终 HTTPS 域名。初次发布保持 `KAI_ENABLE_HSTS=0`；只有真实域名、证书续期、HTTP 到 HTTPS 跳转和关键业务流程均验证通过后，才改为 `KAI_ENABLE_HSTS=1` 并重启应用。应用密钥文件不能被备份或行情更新 unit 读取。
3. 将以下脚本安装到 `/usr/local/lib/kai-cloud/`，权限 `0644 root:root`：

   - `kai-cloud-market-update-run.sh`
   - `kai-cloud-backup-run.sh`
   - `kai-cloud-prepare-state.sh`（仅安装/恢复时由 root 人工执行，不进入 timer）
   - `kai-cloud-ops-alert.sh`

4. 将三个 service unit 和两个 timer 安装到 `/etc/systemd/system/`：

   - `kai-cloud-market-update.service`
   - `kai-cloud-market-update.timer`
   - `kai-cloud-backup.service`
   - `kai-cloud-backup.timer`
   - `kai-cloud-ops-alert@.service`

5. 在目标 Ubuntu 主机执行 `systemd-analyze verify`。首次安装和升级的任务顺序不同，必须按下方对应流程操作；恢复演练通过前不得启用 timer。

`flock` 防止同一任务重入，`timeout` 将总运行时间限制为 300 秒。两个任务都使用只读根文件系统、非 root 用户、能力全移除、资源上限和日志轮转。行情更新容器完全看不到业务数据库目录。

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

应用端口只绑定 `127.0.0.1:3051`。因此生产配置固定启用 `KAI_TRUST_PROXY=1`，并同时设置 `KAI_REQUIRE_HTTPS_WRITES=1`；任何绕过反向代理的明文写请求都会被拒绝。容器内业务数据库和行情目录固定分别挂载到 `/app/db` 与 `/app/market`，不得合并或改成应用根目录。容器还具有 1 CPU、512MB 内存、256 PIDs、只读根文件系统、日志轮转和 `/api/live` 存活检查。`/api/ready` 用于发布和反向代理就绪判断，不应替代存活检查。

生产调度使用 systemd；Compose 中 `market-update` 和 `backup` 的 `ops` profile 只用于受控人工验证。

## 首次安装与升级顺序

首次安装时数据库尚不存在，不能把“先备份”作为启动前置条件。正确顺序是：

1. 创建 `/opt/kai-cloud-*/{db,market,uploads,backups}`，设置 UID/GID 1000 与 `0750` 权限，并安装环境文件、脚本和 systemd units。不得漏建 `uploads`，否则应用启动门禁和备份任务都会失败关闭。
2. 人工运行一次行情更新，确认 `market/model-market.snapshot.json` 已生成且校验通过。
3. 仅在回环端口启动应用，不接入外部流量；必须使用上一节的部署门禁和 `up -d --wait app`。
4. 请求 `/api/ready`，让应用创建或迁移数据库，并确认返回就绪、schema 版本正确、行情不过期。
5. 此时才人工执行第一次备份，再把恢复包还原到全新的隔离目录并完成 `quick_check`、外键、迁移版本和业务冒烟验证。
6. 只有恢复演练成功后，才启用 backup/update timers，并把 HTTPS 反向代理流量切入应用。

升级已有实例时顺序相反：必须在替换应用前创建并异地同步一致性备份、验证恢复包，再用隔离数据库副本启动新 digest 的 canary。迁移、`/api/ready` 和业务冒烟通过后才允许短暂停写、替换应用并切换流量。不得用首次安装的“启动后首次备份”顺序处理已有生产数据。

## 备份格式

`npm run ops:backup` 创建以下原子目录：

```text
kai-cloud-backup-<UTC timestamp>-<random>/
  kai-cloud.sqlite
  activity.sqlite
  model-market.snapshot.json
  uploads/
    submissions/<user>/<object>
  manifest.json
```

两个数据库分别通过 `VACUUM INTO` 创建一致性副本。活动作品先完成原子文件写入再提交数据库元数据，因此备份先快照 `activity.sqlite`、再复制只读上传树；并发新作品最多作为无引用的额外对象进入恢复包，不会让已快照记录丢失文件。完成前目录以 `.partial-` 开头，任何失败都不会发布为正式恢复包。正式 manifest 包含：

- 两个 SQLite 数据库、行情快照以及每个上传对象的 SHA-256 和字节数；
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
restore-candidate/db/activity.sqlite
restore-candidate/market/model-market.snapshot.json
restore-candidate/uploads/...
restore-candidate/backups/
restore-candidate/backup-manifest.json
restore-candidate/restore-verification.json
```

上线前的恢复演练必须完成：

1. 从异地存储下载恢复包到隔离目录。
2. 校验 manifest、两个数据库、行情快照和每个上传对象的 SHA-256；上传清单不得有遗漏、额外文件、符号链接或路径穿越。
3. 对两个数据库验证 `quick_check=ok`、无外键违规、迁移版本和记录数一致。
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

需要恢复数据的冷回滚必须切换完整状态根目录，禁止把单个 SQLite 主文件或 `uploads` 单独覆盖回现网：

1. 停止写流量并执行 `docker compose ... stop app`，记录当前 `KAI_STATE_ROOT`、镜像 digest 与恢复包路径。
2. 把恢复包放在受控只读位置，执行 `verify-restore.mjs` 恢复到尚不存在且符合规则的新目录，例如 `/opt/kai-cloud-3051-restore-20260819`。
3. 对新目录执行 `chown -R 1000:1000`，目录权限设为 `0750`、普通文件设为 `0640`；人工确认它不是符号链接，并保留原状态根不动。
4. 用新状态根和待回退 digest 在隔离回环端口启动 canary，核对两个数据库、活动作品读取、登录、投票、排行榜和奖励余额；失败时停掉 canary，不得修改原状态根。
5. 通过 canary 后，原子替换 `/etc/kai-cloud/kai-cloud-release.env` 中的 `KAI_STATE_ROOT`、`KAI_IMAGE` 与 `KAI_RELEASE_SHA`，再次运行完整部署门禁，再启动正式应用并切流。
6. 观察期内不得删除原状态根和回滚恢复包。若回滚后检查失败，停止写流量并把 release env 原子切回原状态根与原 digest，而不是在两个目录之间复制文件。

`kai-cloud-backup/1` 旧恢复包仍可校验，但它不含活动库和上传对象，验证结果会标记 `legacyBackup=true`；有活动数据后不得将其作为完整灾备或回滚依据。

## 验收命令

本地脚本自测：

```bash
npm run ops:self-test
npm run ops:deploy:validate
```

`ops:deploy:validate` 内含弱密钥、可变镜像、非法发布 SHA、HTTP/带路径 origin、关闭安全标志和危险目录的负向用例。目标主机发布时还必须在加载真实环境文件后执行 `npm run ops:deploy:validate -- --current-env`；该模式会同时检查 `/opt/kai-cloud-*/{db,market,uploads,backups}` 为已存在、非符号链接的独立目录，并检查本机镜像 RepoDigest、OCI revision label 和 OS/架构与 release env 完全一致。

发布候选至少还要通过：

```bash
npm run lint
npx tsc --noEmit
npm test
docker compose -f deploy/compose.production.yml config
systemd-analyze verify deploy/*.service deploy/*.timer
```

`systemd-analyze verify` 应在目标 Ubuntu 环境执行；Windows 上的结果不能替代目标主机校验。
