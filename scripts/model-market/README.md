# KAI Cloud 日度模型行情流水线

该流水线把人工审核的官方模型注册表作为完整基线，仅把经 jsDelivr 读取的 LiteLLM 机器目录用于同型号精确匹配的交叉校验。次级价格只有在相对官方审核价偏差不超过 25% 时才会更新；缺失、抓取失败或异常偏差都会保留最近一次安全值并标记为陈旧或待复核。

```powershell
node scripts/model-market/cli.mjs stage
node scripts/model-market/cli.mjs promote
```

`stage` 生成 `.market-cache/model-market.pending.json`。`promote` 只接受 60 分钟内、至少 30 条且覆盖 12 个厂商的完整分模型报价，然后原子更新 `data/model-market.snapshot.json`。综合指标始终是基期 100 的固定篮子指数，不计算跨模型人民币均价，历史最多保留 90 天。
