# Decisions

| Time | Decision | Mode | Evidence | Alternatives | Consequences |
|---|---|---|---|---|---|
| 2026-08-03 | 先探索再实现，采用 Hybrid | AUTO→HYBRID | 数据源异构且需形成部署产品 | 仅静态改文案；直接写单一爬虫 | 必须至少比较两种采集机制并用测试选择 |
| 2026-08-03 | “综合行情”只能做基期 100 指数 | HYBRID | 模型、版本和 Token 类型不可直接按人民币混合 | 所有模型算均价 | 具体价格必须下沉到可比模型桶 |
| 2026-08-03 | 采用分级来源注册表 | HYBRID | 官方源有静态 Markdown、动态大表和无稳定公开价三类 | 一个通用 HTML 爬虫 | A 级自动；B 级变更需复核；C 级保留空价或人工审核 |
| 2026-08-03 | 日度数据采用候选快照→原子发布 | HYBRID | 隔离原型 11/11 通过，异常批次可输出零条可发布值 | 逐行覆盖线上数据 | 05:40 采集，06:00 只切换完整且新鲜的快照 |
| 2026-08-03 | 版本化 JSON 作为首期行情存储 | HYBRID | Sites 暂无可调用的 Cron/D1 调度配置，源码快照具备审计与回滚 | 未配置的 Worker Cron；直接写 D1 | 由本地定时自动化生成、验证并私有发布；后续有供应商实时报盘再迁移 D1/事件流 |
| 2026-08-03 | 聚合数值来源与官方复核页分开展示 | PRECISION | 首轮验证发现聚合更新后的数值仍链接官方页，存在来源误读风险 | 保持一个来源标签 | 当日聚合值明确标为 LiteLLM，并同时提供独立官方复核页；测试逐条校验 |
| 2026-08-03 | 采用采集与发布分离的双定时任务 | PRECISION | 候选需要在 06:00 前留出校验窗口，且发布必须运行完整质量门 | 06:00 单任务边采边发 | 05:40 采集；06:00 只发布新鲜完整候选；失败不覆盖线上成功版本 |

## Mode switch

- Prior mode: AUTO
- New mode: HYBRID
- Reason and evidence: 官方价格源、模型覆盖与标准化方法需要探索，同时必须落地成可验证的网站能力。
- Preserved objective: 每天 06:00 发布覆盖主流模型的可信日度快照。
- Paused or abandoned paths: 暂不选择单一网页爬虫或静态手工报价。
- Next action: 并行验证官方 API、官方定价页和人工审核注册表三种机制。

## Mode switch 2

- Prior mode: HYBRID
- New mode: PRECISION
- Reason and evidence: 两种采集原型已比较，注册表、快照、闸门和页面方案均已选定，剩余工作为客观验收与私有部署。
- Preserved objective: 每天 06:00 发布覆盖主流模型的可信日度快照。
- Paused or abandoned paths: 暂不迁移 D1，不把第三方聚合值伪装成官方直采值。
- Next action: 独立验证通过后提交并部署 Sites 私有版本。
