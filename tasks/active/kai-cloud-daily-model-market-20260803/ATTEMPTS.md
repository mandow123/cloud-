# Attempts

## Attempt 1

- Time: 2026-08-03
- Mode: HYBRID
- Action: 使用 Node 原生 fetch 读取 LiteLLM 机器可读模型价格目录。
- Why it might work: JSON 结构完整，能快速验证主流厂商覆盖。
- Actual result: TLS 连接在读取时被对端重置（ECONNRESET）。
- Failure category: external dependency / network
- Evidence: Node fetch failed after about 20 seconds.
- Hypothesis eliminated: 单次无重试请求不够可靠。
- Unexpected clue or reusable partial result: 生产采集器必须具备超时、指数退避和最后成功快照回退。
- Materially different alternatives: curl 传输；官方 API 分源适配；离线 fixture。
- Selected next path and why it differs: 尝试独立传输工具，区分网络与运行时问题。

## Attempt 2

- Time: 2026-08-03
- Mode: HYBRID
- Action: 通过 curl 重试并将响应管道交给 Node 解析。
- Why it might work: curl 具有成熟的网络重试能力。
- Actual result: PowerShell 到 Node 的内联引号被改写，脚本未能解析。
- Failure category: tool / escaping
- Evidence: Node eval SyntaxError；未触及数据内容。
- Hypothesis eliminated: 复杂内联脚本不适合作为可维护采集路径。
- Unexpected clue or reusable partial result: 采集器应落为受测试的独立模块，不能依赖长内联命令。
- Materially different alternatives: 独立 .mjs 模块；PowerShell 原生 JSON；官方单源适配器。
- Selected next path and why it differs: 用 PowerShell 原生 JSON 做一次诊断。

## Attempt 3

- Time: 2026-08-03
- Mode: HYBRID
- Action: 使用 PowerShell ConvertFrom-Json 解析完整模型目录。
- Why it might work: 避免 Node 内联转义问题。
- Actual result: 源文件包含仅大小写不同的键，PowerShell 将其视为重复键并拒绝整个对象。
- Failure category: environment / parser semantics
- Evidence: duplicated keys error for BAAI/baai model ids.
- Hypothesis eliminated: PowerShell 5 的大小写不敏感对象解析不适合该上游目录。
- Unexpected clue or reusable partial result: Node JSON.parse 能保留大小写不同的键，应成为生产解析器。
- Materially different alternatives: 独立 Node 模块带重试；LiteLLM Catalog API；按厂商官方页面解析。
- Selected next path and why it differs: 实现独立 Node 采集模块，带网络重试、结构校验、fixture 和发布闸门。
