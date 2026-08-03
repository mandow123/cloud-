# KAI Cloud

中国 Token 学院算力市场。它用统一的资源分类、交易方式和计价单位呈现 GPU、Token/模型、整机柜/容量与云厂商资源，并提供行情、筛选比较、租赁/置换需求和需求方/供应方工作台。

## 当前边界

- 资源、供应商与库存是平台初始化样本，尚未接入真实供应商库存、承诺报价或自动成交系统。
- 需求、报价、资源草稿和匿名会话会通过后端 API 持久化到当前实例的 SQLite 数据库；主题和关注列表只保存在当前设备。
- 当前仅提供无密码匿名会话，不具备正式身份认证与授权边界。请勿录入真实个人资料、联系方式或商业秘密；匿名业务记录按最近活动时间最多保留 30 天。
- 不包含支付、合同、资源自动开通或真实供应商连接。

## 本地运行

需要 Node.js 24.15 或更高版本。

```bash
npm install
npm run dev
npm run build
npm test
```

站点使用 vinext、React、TypeScript 和 Tailwind CSS，并保留 Sites 所需的 Cloudflare Worker 兼容构建结构。

本地开发默认把 SQLite 文件写入 `.market-cache/marketplace/`；生产基线、备份恢复和每日 06:00 行情更新说明见 `deploy/PRODUCTION_RUNBOOK.md`。
