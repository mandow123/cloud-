# Task

- ID: kai-cloud-daily-model-market-20260803
- Title: KAI Cloud 日度模型行情生产线
- Original objective: 将当前演示型 Token/模型行情升级为每天北京时间 06:00 发布的新快照，并按具体主流模型区分输入、缓存输入、输出、实例与预留容量口径；综合行情只作为基期 100 的趋势指数。
- Success criteria: 覆盖国内外主流模型厂商与代表模型；06:00 日度调度和失败重试可验证；具体模型价格不可被错误混合；页面展示来源、口径、更新时间和陈旧状态；构建、测试与独立验收通过。
- Hard constraints: 不伪造实时价格；只使用公开且允许访问的官方来源或清晰标记的演示/待接入来源；不暴露密钥；保持 Cloudflare Worker 兼容；保留现有品牌视觉和其他业务流程。
- Soft constraints: 覆盖尽量全面但优先可维护性；页面保持数据终端风格；每日快照在 06:00 CST 原子切换。
- Authorized systems and actions: 可修改 D:\cloud.kai.com 源码、测试、站点数据结构、持久化声明和私有 Sites 版本；可读取公开官方价格页面并构建适配器。
- Prohibited actions: 不绕过登录、验证码、反爬或访问控制；不抓取未授权私有报价；不公开供应商原始保密报价；不绑定 cloud.kai.com。
- Risks and rollback: 官方页面结构或条款变化会导致抓取失败；错误价格可能误导采购。通过来源级健康检查、上一快照回退、陈旧标记、人工禁用和 Sites 版本回滚降低风险。
