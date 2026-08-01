# KAI Cloud

中国 Token 学院算力市场的首版演示站。它用统一的资源分类、交易方式和计价单位呈现 GPU、Token/模型、整机柜/容量与云厂商资源，并提供行情、筛选比较、租赁/置换需求和需求方/供应方会员工作台。

## 当前边界

- 所有资源、供应商、行情和报价均为确定性的虚构演示数据。
- 表单与会员操作只保存在当前浏览器，不会发送真实需求。
- 不包含真实认证、数据库、支付、合同、资源开通或供应商连接。

## 本地运行

需要 Node.js 22.13 或更高版本。

```bash
npm install
npm run dev
npm run build
npm test
```

站点使用 vinext、React、TypeScript 和 Tailwind CSS，并保留 Sites 所需的 Cloudflare Worker 兼容构建结构。
