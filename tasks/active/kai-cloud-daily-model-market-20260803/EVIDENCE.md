# Evidence

| Time | Criterion or claim | Source/action | Observable result | Strength |
|---|---|---|---|---|
| 2026-08-03 | 当前无自动行情更新 | 本地源码检查 | 数据全部来自固定 catalog，无 DB、cron、scheduled handler | Strong |
| 2026-08-03 | 当前综合 Token 名称可能误导 | 本地源码检查 | market-token-million 将跨模型行情显示为“百万 Token”人民币值 | Strong |
| 2026-08-03 | 主流模型范围可落为明确注册表 | 官方一手来源研究 | 覆盖国内外 15+ 厂商，包含旗舰、均衡、低成本、多模态与嵌入/代码代表型号 | Strong |
| 2026-08-03 | 官方来源适合分级采集 | 官方一手来源研究 | A 级静态/Markdown 可自动，B 级动态大表需差异复核，C 级先人工审核 | Strong |
| 2026-08-03 | 两种采集机制能安全阻断异常 | 隔离原型与独立验证 | JSON schema 适配器和审核注册表+SHA-256 原型，离线测试 11/11 PASS | Strong |
| 2026-08-03 | 汇率可由官方日度源计算 | ECB 日度 XML | 2026-07-31 USD/CNY 兜底 6.751328，可在抓取失败时保留上一值 | Strong |
| 2026-08-03 | 主流模型快照完整生成 | 真实源 stage/promote | 55 个价格档、16 家厂商、43 个具体模型；52 条有价、3 条 null；固定篮子指数基期 100 | Strong |
| 2026-08-03 | 来源链路逐条可验证 | 注册表与正式 snapshot 对照测试 | 55/55 均保留官方复核页；聚合更新单列 LiteLLM 数值来源，25% 差异闸门生效 | Strong |
| 2026-08-03 | 网站已接入分模型行情 | SSR 与本地 HTTP 验证 | /market 返回 200，含分项报价、每日 06:00、来源状态与非成交价声明 | Strong |
| 2026-08-03 | 日度调度已启用 | Codex 本地自动化配置 | 05:40 只生成候选；06:00 通过 lint/type/build/39 tests 后才私有发布；失败保留上一版 | Strong |
| 2026-08-03 | 回归质量门全部通过 | lint、tsc、build、node:test | lint 0 error、tsc 0 error、构建成功、全量测试 39/39 PASS | Strong |
| 2026-08-03 | 发布闸门抵抗自报计数与来源字段腐化 | 独立验证器执行反证 | 35/36 伪完整候选、非法来源状态/URL、freshness 冲突、priced review_required 均被拒绝，旧快照字节不变 | Strong |
| 2026-08-03 | 未来离线回退不再错标来源 | 新增 previous aggregate 越界反例 | 回退官方基线后强制 official_page 与官方 URL，不继承旧聚合标签；测试 PASS | Strong |
| 2026-08-03 | 精确交付树通过最终验收 | 独立验证器检查 commit f0e66b1 | lint、TypeScript、build、46/46 tests PASS；16 厂商/43 模型/55 档，priced review_required=0 | Strong |
| 2026-08-03 | 私有线上版本发布成功 | Sites version 2 deployment | 部署状态 succeeded；custom access，1 user、0 groups、0 external visitors | Strong |
