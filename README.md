# KAI Cloud

中国 Token 学院算力市场。它用统一的资源分类、交易方式和计价单位呈现 GPU、Token/模型、整机柜/容量与云厂商资源，并提供行情、筛选比较、租赁/置换需求和需求方/供应方工作台。

## 当前边界

- 公开目录包含参考信息与样本；可下单资源以后台审核的库存、报价及交付条件为准。
- 需求、报价、资源草稿、账号与组织授权通过后端 API 持久化到 SQLite；主题和关注列表保存在当前设备。
- 已有 KAI Identity 浏览器登录、独立密码管理员、组织成员授权、卡时账本、受控充值和人工交付链路。功能存在不代表已通过生产验收。
- 当前稳定化阶段关闭新收银单，保留存量回调与核单。真实支付验收等待数据库恢复方案完成；自动资源开通、Managed GPU 与新数据库迁移不在本轮范围。

## 稳定主线与交付状态

`codex/cloud-stable` 从生产基线 `d47875e6c6c8044cf4e421f430ac854c79a5f4a0` 建立。修复通过独立 PR 和 CI，旧 main、开发分支及标签保持不变。默认分支和部署版本分别以 GitHub 设置和不可变发布记录为准，不能由当前检出的代码推断线上状态。

交付按 S1 安全、S2 身份/行情、S3 支付候选分批；每批记录“开发完成、候选、已部署、已验收”。发布必须使用完整 SHA 和镜像 digest。规则及当前验收边界见 [稳定化发布规则](docs/CLOUD_STABILIZATION.md)。

Git 保存源码和脱敏发布证据，不保存环境密钥、数据库、日志或内部交接文档。现有同盘一致性备份用于恢复演练，不等于异地灾备。

## 本地运行

需要 Node.js 24.15 或更高版本。

```bash
npm ci
npm run dev
npm run build
npm test
```

站点使用 vinext、React、TypeScript 和 Tailwind CSS，并保留 Sites 所需的 Cloudflare Worker 兼容构建结构。

本地开发默认把 SQLite 文件写入 `.market-cache/marketplace/`；生产基线、备份恢复和每日 06:00 行情更新说明见 `deploy/PRODUCTION_RUNBOOK.md`。
