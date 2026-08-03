/**
 * KAI Cloud deterministic initialization catalog.
 *
 * This module intentionally stays dependency-free so it can be imported by
 * both the Next.js application and `node --test` without a TypeScript loader.
 * Every supplier, listing and quote below is a platform initialization sample.
 */

export const MARKET_REFERENCE_NOTICE =
  "市场参考报价 · 具体以询价确认为准";

export const RESOURCE_CATEGORIES = Object.freeze([
  "gpu",
  "token_model",
  "rack_capacity",
  "cloud_vendor",
]);

export const DEAL_MODES = Object.freeze(["rental", "service", "swap"]);

export const PRICING_UNITS = Object.freeze([
  "卡时",
  "服务器时",
  "百万 Token",
  "模型实例时",
  "预留容量时",
  "机柜月",
  "kW 月",
]);

export const DELIVERY_FORMS = Object.freeze([
  "裸金属",
  "容器实例",
  "API 服务",
  "专属集群",
  "整机柜",
  "云主机",
]);

export const RESOURCE_SORTS = Object.freeze([
  "featured",
  "price_asc",
  "price_desc",
  "updated_desc",
  "sample_desc",
]);

export const categoryLabels = Object.freeze({
  gpu: "GPU 算力",
  token_model: "Token / 模型",
  rack_capacity: "整机柜 / 容量",
  cloud_vendor: "云厂商资源",
});

export const dealModeLabels = Object.freeze({
  rental: "租赁",
  service: "服务采购",
  swap: "置换",
});

export const regions = Object.freeze([
  Object.freeze({ id: "beijing", name: "北京", hub: "华北", latencyNote: "京津冀低时延" }),
  Object.freeze({ id: "shanghai", name: "上海", hub: "华东", latencyNote: "长三角骨干接入" }),
  Object.freeze({ id: "guangdong", name: "广东", hub: "华南", latencyNote: "粤港澳节点覆盖" }),
  Object.freeze({ id: "zhejiang", name: "浙江", hub: "华东", latencyNote: "互联网业务优化" }),
  Object.freeze({ id: "sichuan", name: "四川", hub: "西南", latencyNote: "成渝算力枢纽" }),
  Object.freeze({ id: "inner-mongolia", name: "内蒙古", hub: "北部", latencyNote: "大规模训练集群" }),
]);

export const regionNames = Object.freeze(regions.map((region) => region.name));

export const suppliers = Object.freeze([
  Object.freeze({
    id: "supplier-xinglan",
    name: "星澜智算",
    shortName: "星澜智算",
    description: "多地域 GPU 裸金属资源供应方。",
    categoryFocus: Object.freeze(["gpu", "cloud_vendor"]),
  }),
  Object.freeze({
    id: "supplier-yunxiu",
    name: "云岫算力",
    shortName: "云岫算力",
    description: "弹性云算力与预留容量供应方。",
    categoryFocus: Object.freeze(["gpu", "cloud_vendor"]),
  }),
  Object.freeze({
    id: "supplier-beichen",
    name: "北辰算网",
    shortName: "北辰算网",
    description: "高性能互联训练集群供应方。",
    categoryFocus: Object.freeze(["gpu", "rack_capacity"]),
  }),
  Object.freeze({
    id: "supplier-nanwan",
    name: "南湾模型服务",
    shortName: "南湾模型",
    description: "模型实例与 Token API 服务供应方。",
    categoryFocus: Object.freeze(["token_model"]),
  }),
  Object.freeze({
    id: "supplier-qianfan",
    name: "千帆机柜",
    shortName: "千帆机柜",
    description: "高密机柜与液冷容量供应方。",
    categoryFocus: Object.freeze(["rack_capacity"]),
  }),
  Object.freeze({
    id: "supplier-juxin",
    name: "炬芯云联",
    shortName: "炬芯云联",
    description: "推理集群与混合云供应方。",
    categoryFocus: Object.freeze(["token_model", "cloud_vendor"]),
  }),
  Object.freeze({
    id: "supplier-hetu",
    name: "河图算力",
    shortName: "河图算力",
    description: "西南绿色算力与机柜供应方。",
    categoryFocus: Object.freeze(["gpu", "rack_capacity"]),
  }),
  Object.freeze({
    id: "supplier-kunlun",
    name: "昆仑联算",
    shortName: "昆仑联算",
    description: "跨区域容量协调供应方。",
    categoryFocus: Object.freeze(["token_model", "rack_capacity", "cloud_vendor"]),
  }),
]);

const supplierById = new Map(suppliers.map((supplier) => [supplier.id, supplier]));

export const serviceAliases = Object.freeze([
  Object.freeze({
    slug: "compute-swap",
    label: "算力置换",
    description: "以现有算力换取目标资源。",
    category: "cloud_vendor",
    dealMode: "swap",
    pricingUnit: "服务器时",
    keywords: Object.freeze(["算力交换", "资源置换"]),
  }),
  Object.freeze({
    slug: "compute-rental",
    label: "算力租赁",
    description: "按服务器时租用通用算力。",
    category: "cloud_vendor",
    dealMode: "rental",
    pricingUnit: "服务器时",
    keywords: Object.freeze(["云算力租赁", "服务器租赁"]),
  }),
  Object.freeze({
    slug: "gpu-swap",
    label: "GPU置换",
    description: "按卡时估值撮合 GPU 资源。",
    category: "gpu",
    dealMode: "swap",
    pricingUnit: "卡时",
    keywords: Object.freeze(["GPU 置换", "显卡置换"]),
  }),
  Object.freeze({
    slug: "gpu-rental",
    label: "GPU租赁",
    description: "按卡时租用 GPU 资源。",
    category: "gpu",
    dealMode: "rental",
    pricingUnit: "卡时",
    keywords: Object.freeze(["GPU 租赁", "显卡租赁"]),
  }),
  Object.freeze({
    slug: "token-hour-service",
    label: "Token小时服务",
    description: "按百万 Token 结算模型调用。",
    category: "token_model",
    dealMode: "service",
    pricingUnit: "百万 Token",
    keywords: Object.freeze(["Token 服务", "推理 Token"]),
  }),
  Object.freeze({
    slug: "model-hour-service",
    label: "模型小时服务",
    description: "按独占模型实例小时结算。",
    category: "token_model",
    dealMode: "service",
    pricingUnit: "模型实例时",
    keywords: Object.freeze(["模型实例", "模型租用"]),
  }),
  Object.freeze({
    slug: "model-capacity-hour-service",
    label: "模型容量小时服务",
    description: "按预留模型吞吐容量小时结算。",
    category: "token_model",
    dealMode: "service",
    pricingUnit: "预留容量时",
    keywords: Object.freeze(["模型容量", "吞吐预留"]),
  }),
  Object.freeze({
    slug: "compute-capacity-hour-service",
    label: "算力容量小时服务",
    description: "按预留算力容量小时采购服务。",
    category: "rack_capacity",
    dealMode: "service",
    pricingUnit: "预留容量时",
    keywords: Object.freeze(["容量小时", "预留算力"]),
  }),
  Object.freeze({
    slug: "compute-capacity-rental",
    label: "算力容量租赁",
    description: "按 kW 月租用高密算力容量。",
    category: "rack_capacity",
    dealMode: "rental",
    pricingUnit: "kW 月",
    keywords: Object.freeze(["容量租赁", "功率租赁"]),
  }),
  Object.freeze({
    slug: "compute-capacity-swap",
    label: "算力容量置换",
    description: "按预留容量小时进行双边置换。",
    category: "rack_capacity",
    dealMode: "swap",
    pricingUnit: "预留容量时",
    keywords: Object.freeze(["容量置换", "预留容量交换"]),
  }),
]);

const UPDATED_AT = "2026-08-01T04:00:00.000Z";
const VALID_UNTIL = "2026-08-08T15:59:59.000Z";

function createQuote({
  pricingUnit,
  rangeMin,
  rangeMax,
  median,
  taxIncluded,
  energyIncluded,
  networkIncluded,
  scopeNote,
  sampleCount,
  updatedAt = UPDATED_AT,
  validUntil = VALID_UNTIL,
}) {
  return Object.freeze({
    currency: "CNY",
    pricingUnit,
    rangeMin,
    rangeMax,
    median,
    taxIncluded,
    energyIncluded,
    networkIncluded,
    scopeNote,
    sampleCount,
    validUntil,
    updatedAt,
    disclaimer: MARKET_REFERENCE_NOTICE,
  });
}

function createListing(definition) {
  const supplier = supplierById.get(definition.supplierId);
  if (!supplier) {
    throw new Error(`Unknown supplier: ${definition.supplierId}`);
  }
  return Object.freeze({
    ...definition,
    dealModes: Object.freeze([...definition.dealModes]),
    specs: Object.freeze({ ...definition.specs }),
    tags: Object.freeze([...definition.tags]),
    supplierName: supplier.name,
    quote: createQuote({
      ...definition.quote,
      pricingUnit: definition.pricingUnit,
    }),
  });
}

export const resourceListings = Object.freeze([
  createListing({
    id: "gpu-h100-sxm-8-bj",
    title: "H100 SXM 80GB · 8 卡训练节点",
    category: "gpu",
    dealModes: ["rental"],
    pricingUnit: "卡时",
    region: "北京",
    supplierId: "supplier-xinglan",
    deliveryForm: "裸金属",
    summary: "8×H100 SXM，NVLink 互联，适合大模型训练。",
    specs: { GPU: "8×H100 SXM 80GB", CPU: "双路 64 核", 网络: "400Gbps IB" },
    capacity: "平台初始化样本：12 台 / 96 卡，供应方接入后核验",
    sla: "目标 SLA 99.9%，供应方接入后确认",
    deliveryLeadTime: "确认后 4 小时",
    tags: ["H100", "NVLink", "训练"],
    featured: true,
    quote: { rangeMin: 27.8, rangeMax: 34.6, median: 31.2, taxIncluded: true, energyIncluded: true, networkIncluded: true, scopeNote: "含税、电费及基础公网流量；存储另计。", sampleCount: 18 },
  }),
  createListing({
    id: "gpu-h800-8-sh",
    title: "H800 80GB · 8 卡算力服务器",
    category: "gpu",
    dealModes: ["rental", "service"],
    pricingUnit: "卡时",
    region: "上海",
    supplierId: "supplier-yunxiu",
    deliveryForm: "裸金属",
    summary: "面向训练与批量推理的 H800 独占节点。",
    specs: { GPU: "8×H800 80GB", CPU: "双路 56 核", 网络: "200Gbps IB" },
    capacity: "平台初始化样本：20 台 / 160 卡，供应方接入后核验",
    sla: "目标 SLA 99.9%，供应方接入后确认",
    deliveryLeadTime: "确认后 8 小时",
    tags: ["H800", "独占", "训练"],
    featured: true,
    quote: { rangeMin: 21.6, rangeMax: 28.4, median: 24.9, taxIncluded: true, energyIncluded: true, networkIncluded: false, scopeNote: "含税与电费；跨地域专线按量另计。", sampleCount: 23 },
  }),
  createListing({
    id: "gpu-a800-swap-gd",
    title: "A800 80GB · 8 卡资源置换",
    category: "gpu",
    dealModes: ["swap"],
    pricingUnit: "卡时",
    region: "广东",
    supplierId: "supplier-beichen",
    deliveryForm: "专属集群",
    summary: "可用 A800 卡时置换异地 H 系列或推理资源。",
    specs: { GPU: "8×A800 80GB", 互联: "NVLink", 最小批次: "2,000 卡时" },
    capacity: "平台初始化样本：48,000 卡时，供应方接入后核验",
    sla: "人工撮合，以双方确认为准",
    deliveryLeadTime: "意向确认后 2 个工作日",
    tags: ["A800", "置换", "可补差"],
    featured: false,
    quote: { rangeMin: 15.2, rangeMax: 20.8, median: 18.1, taxIncluded: false, energyIncluded: true, networkIncluded: false, scopeNote: "置换估值含电费，不含税与跨区网络，可协商补差。", sampleCount: 11 },
  }),
  createListing({
    id: "gpu-l40s-8-zj",
    title: "L40S 48GB · 8 卡推理节点",
    category: "gpu",
    dealModes: ["service"],
    pricingUnit: "服务器时",
    region: "浙江",
    supplierId: "supplier-juxin",
    deliveryForm: "容器实例",
    summary: "适合图像生成、视频推理及轻量微调。",
    specs: { GPU: "8×L40S 48GB", 容器: "Kubernetes 独占", 镜像: "主流框架预装" },
    capacity: "平台初始化样本：32 个实例，供应方接入后核验",
    sla: "目标 SLA 99.95%，供应方接入后确认",
    deliveryLeadTime: "确认后 30 分钟",
    tags: ["L40S", "推理", "容器"],
    featured: true,
    quote: { rangeMin: 78, rangeMax: 106, median: 92, taxIncluded: true, energyIncluded: true, networkIncluded: true, scopeNote: "含税、电费及每实例 100GB 日公网流量。", sampleCount: 27 },
  }),
  createListing({
    id: "gpu-a100-8-sc",
    title: "A100 80GB · 8 卡训练节点",
    category: "gpu",
    dealModes: ["rental"],
    pricingUnit: "卡时",
    region: "四川",
    supplierId: "supplier-hetu",
    deliveryForm: "裸金属",
    summary: "绿色能源园区 A100 独占训练资源。",
    specs: { GPU: "8×A100 80GB", CPU: "双路 64 核", 网络: "200Gbps RoCE" },
    capacity: "平台初始化样本：18 台 / 144 卡，供应方接入后核验",
    sla: "目标 SLA 99.5%，供应方接入后确认",
    deliveryLeadTime: "确认后 12 小时",
    tags: ["A100", "训练", "西南"],
    featured: false,
    quote: { rangeMin: 10.6, rangeMax: 14.8, median: 12.7, taxIncluded: true, energyIncluded: true, networkIncluded: false, scopeNote: "含税与电费；公网及专线带宽另计。", sampleCount: 19 },
  }),
  createListing({
    id: "gpu-h20-swap-nm",
    title: "H20 96GB · 推理卡时置换",
    category: "gpu",
    dealModes: ["swap", "service"],
    pricingUnit: "卡时",
    region: "内蒙古",
    supplierId: "supplier-kunlun",
    deliveryForm: "专属集群",
    summary: "批量 H20 推理卡时，可置换 Token 或模型实例。",
    specs: { GPU: "H20 96GB", 形态: "8 卡节点", 最小批次: "5,000 卡时" },
    capacity: "平台初始化样本：120,000 卡时，供应方接入后核验",
    sla: "人工撮合，以双方确认为准",
    deliveryLeadTime: "意向确认后 3 个工作日",
    tags: ["H20", "置换", "推理"],
    featured: false,
    quote: { rangeMin: 12.9, rangeMax: 17.5, median: 15.3, taxIncluded: false, energyIncluded: true, networkIncluded: false, scopeNote: "置换估值含电费，不含税、存储及跨区网络。", sampleCount: 9 },
  }),

  createListing({
    id: "token-deepseek-bj",
    title: "DeepSeek 类推理 Token 服务",
    category: "token_model",
    dealModes: ["service"],
    pricingUnit: "百万 Token",
    region: "北京",
    supplierId: "supplier-nanwan",
    deliveryForm: "API 服务",
    summary: "兼容常用接口格式的文本推理服务。",
    specs: { 模型: "推理模型 671B MoE", 上下文: "64K", 并发: "可预留" },
    capacity: "平台初始化样本：日容量 90 亿 Token，供应方接入后核验",
    sla: "目标 SLA 99.9%，供应方接入后确认",
    deliveryLeadTime: "确认后 15 分钟",
    tags: ["Token", "API", "文本生成"],
    featured: true,
    quote: { rangeMin: 3.8, rangeMax: 6.2, median: 4.9, taxIncluded: true, energyIncluded: true, networkIncluded: true, scopeNote: "输入与输出 Token 综合参考报价，含税及标准公网；具体以询价确认为准。", sampleCount: 42 },
  }),
  createListing({
    id: "token-qwen-sh",
    title: "通义类 72B 推理 Token 服务",
    category: "token_model",
    dealModes: ["service"],
    pricingUnit: "百万 Token",
    region: "上海",
    supplierId: "supplier-juxin",
    deliveryForm: "API 服务",
    summary: "面向中文业务的高并发文本推理服务。",
    specs: { 模型: "中文 72B", 上下文: "32K", 限流: "600 RPM 起" },
    capacity: "平台初始化样本：日容量 45 亿 Token，供应方接入后核验",
    sla: "目标 SLA 99.95%，供应方接入后确认",
    deliveryLeadTime: "确认后 15 分钟",
    tags: ["Token", "中文", "API"],
    featured: true,
    quote: { rangeMin: 4.6, rangeMax: 7.4, median: 5.8, taxIncluded: true, energyIncluded: true, networkIncluded: true, scopeNote: "输入输出综合参考报价，含税、电费和标准公网；具体以询价确认为准。", sampleCount: 36 },
  }),
  createListing({
    id: "model-llama-70b-gd",
    title: "70B 模型独占实例",
    category: "token_model",
    dealModes: ["service"],
    pricingUnit: "模型实例时",
    region: "广东",
    supplierId: "supplier-nanwan",
    deliveryForm: "容器实例",
    summary: "独占推理实例，支持私有权重与弹性副本。",
    specs: { 模型规模: "70B", GPU: "4×H20", 上下文: "32K" },
    capacity: "平台初始化样本：24 个实例，供应方接入后核验",
    sla: "目标 SLA 99.9%，供应方接入后确认",
    deliveryLeadTime: "确认后 2 小时",
    tags: ["模型实例", "独占", "私有权重"],
    featured: false,
    quote: { rangeMin: 52, rangeMax: 76, median: 64, taxIncluded: true, energyIncluded: true, networkIncluded: false, scopeNote: "含税、电费和基础存储；公网流量另计。", sampleCount: 17 },
  }),
  createListing({
    id: "token-embedding-zj",
    title: "中文向量化 Token 服务",
    category: "token_model",
    dealModes: ["service"],
    pricingUnit: "百万 Token",
    region: "浙江",
    supplierId: "supplier-juxin",
    deliveryForm: "API 服务",
    summary: "检索与知识库场景的低时延向量化服务。",
    specs: { 维度: "1,024", 单批: "2,048 条", P95: "样本值 120ms" },
    capacity: "平台初始化样本：日容量 120 亿 Token，供应方接入后核验",
    sla: "目标 SLA 99.9%，供应方接入后确认",
    deliveryLeadTime: "接入后确认",
    tags: ["Embedding", "RAG", "API"],
    featured: false,
    quote: { rangeMin: 0.18, rangeMax: 0.42, median: 0.29, taxIncluded: true, energyIncluded: true, networkIncluded: true, scopeNote: "含税、电费和标准公网，不含向量库。", sampleCount: 31 },
  }),
  createListing({
    id: "model-vision-sc",
    title: "视觉语言模型独占实例",
    category: "token_model",
    dealModes: ["service"],
    pricingUnit: "模型实例时",
    region: "四川",
    supplierId: "supplier-kunlun",
    deliveryForm: "容器实例",
    summary: "适合图片理解与文档抽取的独占实例。",
    specs: { 模型: "视觉语言 32B", GPU: "2×L40S", 并发: "32 路" },
    capacity: "平台初始化样本：40 个实例，供应方接入后核验",
    sla: "目标 SLA 99.5%，供应方接入后确认",
    deliveryLeadTime: "确认后 1 小时",
    tags: ["多模态", "OCR", "模型实例"],
    featured: false,
    quote: { rangeMin: 26, rangeMax: 39, median: 32.5, taxIncluded: true, energyIncluded: true, networkIncluded: true, scopeNote: "含税、电费和每日 50GB 公网流量。", sampleCount: 14 },
  }),
  createListing({
    id: "model-capacity-nm",
    title: "大模型吞吐预留容量",
    category: "token_model",
    dealModes: ["service"],
    pricingUnit: "预留容量时",
    region: "内蒙古",
    supplierId: "supplier-kunlun",
    deliveryForm: "专属集群",
    summary: "按每秒 1,000 Token 的预留吞吐单元计费。",
    specs: { 容量单元: "1,000 Token/s", 模型: "70B", 调度: "专属队列" },
    capacity: "平台初始化样本：80 个容量单元，供应方接入后核验",
    sla: "目标 SLA 99.9%，供应方接入后确认",
    deliveryLeadTime: "确认后 1 个工作日",
    tags: ["容量预留", "吞吐", "专属队列"],
    featured: true,
    quote: { rangeMin: 18, rangeMax: 27, median: 22.5, taxIncluded: true, energyIncluded: true, networkIncluded: false, scopeNote: "含税、电费和集群内网络；公网出口另计。", sampleCount: 16 },
  }),

  createListing({
    id: "rack-20kw-bj",
    title: "20kW 风冷整机柜",
    category: "rack_capacity",
    dealModes: ["rental"],
    pricingUnit: "机柜月",
    region: "北京",
    supplierId: "supplier-qianfan",
    deliveryForm: "整机柜",
    summary: "双路供电与基础网络接入的标准整机柜。",
    specs: { 功率: "20kW", 机位: "42U", PUE: "样本值 ≤1.35" },
    capacity: "平台初始化样本：18 柜，供应方接入后核验",
    sla: "目标 SLA 99.99%，供应方接入后确认",
    deliveryLeadTime: "确认后 5 个工作日",
    tags: ["整机柜", "风冷", "双路供电"],
    featured: true,
    quote: { rangeMin: 19800, rangeMax: 24600, median: 22100, taxIncluded: true, energyIncluded: false, networkIncluded: false, scopeNote: "含税与机位服务；电费、带宽按实际用量另计。", sampleCount: 13 },
  }),
  createListing({
    id: "rack-30kw-sh",
    title: "30kW 高密机柜容量",
    category: "rack_capacity",
    dealModes: ["rental"],
    pricingUnit: "kW 月",
    region: "上海",
    supplierId: "supplier-qianfan",
    deliveryForm: "整机柜",
    summary: "面向 GPU 服务器的高密风液混合机柜容量。",
    specs: { 功率: "30kW", 冷却: "风液混合", PUE: "样本值 ≤1.30" },
    capacity: "平台初始化样本：420kW，供应方接入后核验",
    sla: "目标 SLA 99.99%，供应方接入后确认",
    deliveryLeadTime: "确认后 7 个工作日",
    tags: ["高密", "机柜", "华东"],
    featured: true,
    quote: { rangeMin: 910, rangeMax: 1180, median: 1040, taxIncluded: true, energyIncluded: false, networkIncluded: false, scopeNote: "含税与容量占用；电费、机柜及网络另计。", sampleCount: 15 },
  }),
  createListing({
    id: "rack-40kw-liquid-gd",
    title: "40kW 液冷容量置换",
    category: "rack_capacity",
    dealModes: ["swap"],
    pricingUnit: "预留容量时",
    region: "广东",
    supplierId: "supplier-qianfan",
    deliveryForm: "整机柜",
    summary: "可用液冷容量置换异地高密机柜或 GPU 卡时。",
    specs: { 功率: "40kW/柜", 冷却: "冷板液冷", 最小批次: "10,000 kW·h" },
    capacity: "平台初始化样本：240,000 kW·h，供应方接入后核验",
    sla: "人工撮合，以双方确认为准",
    deliveryLeadTime: "意向确认后 5 个工作日",
    tags: ["液冷", "置换", "高密"],
    featured: false,
    quote: { rangeMin: 0.82, rangeMax: 1.18, median: 0.99, taxIncluded: false, energyIncluded: false, networkIncluded: false, scopeNote: "仅作容量置换估值，不含税、电费、机柜及网络。", sampleCount: 8 },
  }),
  createListing({
    id: "rack-edge-10kw-zj",
    title: "10kW 边缘机柜托管服务",
    category: "rack_capacity",
    dealModes: ["service"],
    pricingUnit: "机柜月",
    region: "浙江",
    supplierId: "supplier-beichen",
    deliveryForm: "整机柜",
    summary: "靠近用户侧的低时延边缘机柜托管。",
    specs: { 功率: "10kW", 机位: "24U", 网络: "BGP 多线" },
    capacity: "平台初始化样本：26 柜，供应方接入后核验",
    sla: "目标 SLA 99.9%，供应方接入后确认",
    deliveryLeadTime: "确认后 3 个工作日",
    tags: ["边缘", "托管", "低时延"],
    featured: false,
    quote: { rangeMin: 12600, rangeMax: 16900, median: 14800, taxIncluded: true, energyIncluded: true, networkIncluded: false, scopeNote: "含税及 10kW 包月电力；公网带宽另计。", sampleCount: 12 },
  }),
  createListing({
    id: "rack-25kw-sc",
    title: "25kW 冷板液冷机柜",
    category: "rack_capacity",
    dealModes: ["rental", "service"],
    pricingUnit: "kW 月",
    region: "四川",
    supplierId: "supplier-hetu",
    deliveryForm: "整机柜",
    summary: "成渝节点冷板液冷高密容量，支持按 kW 起租。",
    specs: { 功率: "25kW 起", 冷却: "冷板液冷", PUE: "样本值 ≤1.22" },
    capacity: "平台初始化样本：600kW，供应方接入后核验",
    sla: "目标 SLA 99.9%，供应方接入后确认",
    deliveryLeadTime: "确认后 7 个工作日",
    tags: ["液冷", "绿色算力", "按 kW"],
    featured: true,
    quote: { rangeMin: 720, rangeMax: 940, median: 830, taxIncluded: true, energyIncluded: false, networkIncluded: false, scopeNote: "含税与液冷基础设施；电费、机位和带宽另计。", sampleCount: 21 },
  }),
  createListing({
    id: "rack-capacity-swap-nm",
    title: "训练集群预留容量置换",
    category: "rack_capacity",
    dealModes: ["swap", "service"],
    pricingUnit: "预留容量时",
    region: "内蒙古",
    supplierId: "supplier-kunlun",
    deliveryForm: "专属集群",
    summary: "以 8 卡服务器容量小时为单位的跨区置换。",
    specs: { 容量单元: "1 台 8 卡服务器", 网络: "200Gbps IB", 最小批次: "1,000 容量时" },
    capacity: "平台初始化样本：36,000 容量时，供应方接入后核验",
    sla: "人工撮合，以双方确认为准",
    deliveryLeadTime: "意向确认后 3 个工作日",
    tags: ["容量置换", "训练", "专属集群"],
    featured: false,
    quote: { rangeMin: 108, rangeMax: 148, median: 128, taxIncluded: false, energyIncluded: true, networkIncluded: false, scopeNote: "置换估值含电费，不含税、存储与跨区网络。", sampleCount: 10 },
  }),

  createListing({
    id: "cloud-h100-8-bj",
    title: "弹性 H100 8 卡云主机",
    category: "cloud_vendor",
    dealModes: ["rental"],
    pricingUnit: "服务器时",
    region: "北京",
    supplierId: "supplier-xinglan",
    deliveryForm: "云主机",
    summary: "按小时弹性的 H100 8 卡云主机资源。",
    specs: { GPU: "8×H100 80GB", 系统盘: "500GB SSD", 网络: "100Gbps" },
    capacity: "平台初始化样本：22 台，供应方接入后核验",
    sla: "目标 SLA 99.95%，供应方接入后确认",
    deliveryLeadTime: "确认后 10 分钟",
    tags: ["云主机", "H100", "弹性"],
    featured: true,
    quote: { rangeMin: 246, rangeMax: 306, median: 276, taxIncluded: true, energyIncluded: true, networkIncluded: false, scopeNote: "含税、电费和系统盘；公网流量按量另计。", sampleCount: 29 },
  }),
  createListing({
    id: "cloud-l40s-burst-sh",
    title: "L40S 突发推理云资源",
    category: "cloud_vendor",
    dealModes: ["service"],
    pricingUnit: "卡时",
    region: "上海",
    supplierId: "supplier-yunxiu",
    deliveryForm: "云主机",
    summary: "支持分钟级扩缩的 L40S 推理资源池。",
    specs: { GPU: "L40S 48GB", 扩缩: "1–64 卡", 镜像: "推理框架预装" },
    capacity: "平台初始化样本：峰值 320 卡，供应方接入后核验",
    sla: "目标 SLA 99.9%，供应方接入后确认",
    deliveryLeadTime: "确认后 5 分钟",
    tags: ["突发", "L40S", "推理"],
    featured: true,
    quote: { rangeMin: 9.8, rangeMax: 14.2, median: 12, taxIncluded: true, energyIncluded: true, networkIncluded: true, scopeNote: "含税、电费及每卡时 5GB 公网流量。", sampleCount: 33 },
  }),
  createListing({
    id: "cloud-h800-reserved-gd",
    title: "H800 集群预留容量",
    category: "cloud_vendor",
    dealModes: ["rental"],
    pricingUnit: "预留容量时",
    region: "广东",
    supplierId: "supplier-beichen",
    deliveryForm: "专属集群",
    summary: "以 8 卡节点为容量单元的月度预留云资源。",
    specs: { 容量单元: "1 台 8×H800", 网络: "200Gbps IB", 起订: "720 容量时" },
    capacity: "平台初始化样本：30 个容量单元，供应方接入后核验",
    sla: "目标 SLA 99.95%，供应方接入后确认",
    deliveryLeadTime: "确认后 1 个工作日",
    tags: ["预留容量", "H800", "集群"],
    featured: false,
    quote: { rangeMin: 156, rangeMax: 204, median: 180, taxIncluded: true, energyIncluded: true, networkIncluded: false, scopeNote: "含税、电费和集群内网络；公网与存储另计。", sampleCount: 18 },
  }),
  createListing({
    id: "cloud-a800-inference-zj",
    title: "A800 8 卡推理云服务器",
    category: "cloud_vendor",
    dealModes: ["rental", "service"],
    pricingUnit: "服务器时",
    region: "浙江",
    supplierId: "supplier-juxin",
    deliveryForm: "云主机",
    summary: "适合稳定推理负载的 8 卡独占云服务器。",
    specs: { GPU: "8×A800 80GB", 内存: "1TB", 本地盘: "15TB NVMe" },
    capacity: "平台初始化样本：16 台，供应方接入后核验",
    sla: "目标 SLA 99.9%，供应方接入后确认",
    deliveryLeadTime: "确认后 20 分钟",
    tags: ["云服务器", "A800", "推理"],
    featured: false,
    quote: { rangeMin: 126, rangeMax: 168, median: 147, taxIncluded: true, energyIncluded: true, networkIncluded: false, scopeNote: "含税、电费及本地盘；公网流量另计。", sampleCount: 24 },
  }),
  createListing({
    id: "cloud-hybrid-capacity-sc",
    title: "混合云 GPU 预留容量",
    category: "cloud_vendor",
    dealModes: ["service"],
    pricingUnit: "预留容量时",
    region: "四川",
    supplierId: "supplier-hetu",
    deliveryForm: "专属集群",
    summary: "专线接入的 4 卡 GPU 混合云容量单元。",
    specs: { 容量单元: "1 台 4×A100", 接入: "专线/VPN", 调度: "专属资源池" },
    capacity: "平台初始化样本：48 个容量单元，供应方接入后核验",
    sla: "目标 SLA 99.9%，供应方接入后确认",
    deliveryLeadTime: "确认后 2 个工作日",
    tags: ["混合云", "预留", "专线"],
    featured: false,
    quote: { rangeMin: 49, rangeMax: 68, median: 58.5, taxIncluded: true, energyIncluded: true, networkIncluded: false, scopeNote: "含税、电费和平台服务；专线与公网出口另计。", sampleCount: 15 },
  }),
  createListing({
    id: "cloud-capacity-swap-nm",
    title: "跨区域云算力置换池",
    category: "cloud_vendor",
    dealModes: ["swap"],
    pricingUnit: "服务器时",
    region: "内蒙古",
    supplierId: "supplier-kunlun",
    deliveryForm: "云主机",
    summary: "通用 GPU 云服务器时与 Token 服务双向置换。",
    specs: { 基准单元: "1 台 8 卡服务器", 可换资源: "GPU / Token / 模型实例", 最小批次: "500 服务器时" },
    capacity: "平台初始化样本：18,000 服务器时，供应方接入后核验",
    sla: "人工撮合，以双方确认为准",
    deliveryLeadTime: "意向确认后 3 个工作日",
    tags: ["云算力", "置换", "跨区域"],
    featured: true,
    quote: { rangeMin: 92, rangeMax: 134, median: 113, taxIncluded: false, energyIncluded: true, networkIncluded: false, scopeNote: "置换估值含电费，不含税、存储和跨区网络，可补差。", sampleCount: 12 },
  }),
]);

const marketDefinitions = Object.freeze([
  { id: "market-gpu-card-hour", category: "gpu", label: "GPU 卡时综合行情", pricingUnit: "卡时", region: "全国六大节点", base: 19.8, seed: 3, samples: 68 },
  { id: "market-token-million", category: "token_model", label: "KAI 模型调用成本指数（历史样本）", pricingUnit: "百万 Token", region: "全国六大节点", base: 5.3, seed: 7, samples: 91 },
  { id: "market-rack-kw-month", category: "rack_capacity", label: "高密容量综合行情", pricingUnit: "kW 月", region: "全国六大节点", base: 925, seed: 11, samples: 47 },
  { id: "market-cloud-server-hour", category: "cloud_vendor", label: "云算力综合行情", pricingUnit: "服务器时", region: "全国六大节点", base: 152, seed: 17, samples: 74 },
]);

function roundMarketValue(value) {
  if (Math.abs(value) >= 100) return Math.round(value);
  if (Math.abs(value) >= 10) return Math.round(value * 10) / 10;
  return Math.round(value * 100) / 100;
}

function createMarketSeries(definition) {
  const start = Date.UTC(2026, 4, 4);
  const points = Array.from({ length: 90 }, (_, index) => {
    const cycle = Math.sin((index + definition.seed) * 0.23) * 0.035;
    const micro = (((index * definition.seed) % 13) - 6) * 0.0017;
    const trend = (index - 44.5) * 0.00028;
    const p50 = roundMarketValue(definition.base * (1 + cycle + micro + trend));
    const spread = 0.085 + ((index + definition.seed) % 5) * 0.006;
    const p25 = roundMarketValue(p50 * (1 - spread));
    const p75 = roundMarketValue(p50 * (1 + spread));
    return Object.freeze({
      date: new Date(start + index * 86_400_000).toISOString().slice(0, 10),
      p25,
      p50,
      p75,
      sampleCount: definition.samples + ((index * definition.seed) % 17) - 8,
    });
  });

  return Object.freeze({
    id: definition.id,
    category: definition.category,
    label: definition.label,
    pricingUnit: definition.pricingUnit,
    region: definition.region,
    points: Object.freeze(points),
    updatedAt: UPDATED_AT,
    disclaimer: MARKET_REFERENCE_NOTICE,
  });
}

export const marketSeries = Object.freeze(marketDefinitions.map(createMarketSeries));

export const marketSnapshots = Object.freeze(
  marketSeries.map((series) => {
    const latest = series.points.at(-1);
    const previous7 = series.points.at(-8);
    const previous30 = series.points.at(-31);
    return Object.freeze({
      id: series.id,
      category: series.category,
      label: series.label,
      pricingUnit: series.pricingUnit,
      region: series.region,
      p25: latest.p25,
      p50: latest.p50,
      p75: latest.p75,
      sampleCount: latest.sampleCount,
      change7d: Math.round(((latest.p50 / previous7.p50) - 1) * 10_000) / 100,
      change30d: Math.round(((latest.p50 / previous30.p50) - 1) * 10_000) / 100,
      updatedAt: series.updatedAt,
      disclaimer: series.disclaimer,
    });
  }),
);

function normalizeSearchTerm(value) {
  return String(value ?? "")
    .trim()
    .toLocaleLowerCase("zh-CN")
    .replace(/[\s/_-]+/g, "");
}

export function findServiceAlias(input) {
  const term = normalizeSearchTerm(input);
  if (!term) return undefined;
  return serviceAliases.find((alias) => {
    const candidates = [alias.label, alias.slug, ...alias.keywords];
    return candidates.some((candidate) => normalizeSearchTerm(candidate) === term);
  });
}

export function getResourceById(id) {
  return resourceListings.find((listing) => listing.id === id);
}

function queryValue(input, keys) {
  if (input instanceof URLSearchParams) {
    for (const key of keys) {
      const value = input.get(key);
      if (value) return value;
    }
    return undefined;
  }
  if (typeof input === "string") {
    const query = input.includes("?") ? input.slice(input.indexOf("?") + 1) : input;
    return queryValue(new URLSearchParams(query), keys);
  }
  if (input && typeof input === "object") {
    for (const key of keys) {
      const value = input[key];
      const scalar = Array.isArray(value) ? value[0] : value;
      if (scalar !== undefined && scalar !== null && String(scalar).trim()) {
        return String(scalar);
      }
    }
  }
  return undefined;
}

export function parseResourceQuery(input = {}) {
  const categoryValue = queryValue(input, ["category"]);
  const dealModeValue = queryValue(input, ["deal", "dealMode"]);
  const regionValue = queryValue(input, ["region"]);
  const deliveryValue = queryValue(input, ["delivery", "deliveryForm"]);
  const unitValue = queryValue(input, ["unit", "pricingUnit"]);
  const qValue = queryValue(input, ["q", "query"]);
  const sortValue = queryValue(input, ["sort"]);

  return {
    ...(RESOURCE_CATEGORIES.includes(categoryValue) ? { category: categoryValue } : {}),
    ...(DEAL_MODES.includes(dealModeValue) ? { dealMode: dealModeValue } : {}),
    ...(regionNames.includes(regionValue) ? { region: regionValue } : {}),
    ...(DELIVERY_FORMS.includes(deliveryValue) ? { deliveryForm: deliveryValue } : {}),
    ...(PRICING_UNITS.includes(unitValue) ? { pricingUnit: unitValue } : {}),
    ...(qValue?.trim() ? { q: qValue.trim() } : {}),
    sort: RESOURCE_SORTS.includes(sortValue) ? sortValue : "featured",
  };
}

export function filterResources(resourcesToFilter = resourceListings, filters = {}) {
  const parsed = parseResourceQuery(filters);
  const alias = parsed.q ? findServiceAlias(parsed.q) : undefined;
  const q = normalizeSearchTerm(parsed.q);

  return resourcesToFilter.filter((listing) => {
    if (parsed.category && listing.category !== parsed.category) return false;
    if (parsed.dealMode && !listing.dealModes.includes(parsed.dealMode)) return false;
    if (parsed.region && listing.region !== parsed.region) return false;
    if (parsed.deliveryForm && listing.deliveryForm !== parsed.deliveryForm) return false;
    if (parsed.pricingUnit && listing.pricingUnit !== parsed.pricingUnit) return false;
    if (alias) {
      if (listing.category !== alias.category) return false;
      if (!listing.dealModes.includes(alias.dealMode)) return false;
      if (listing.pricingUnit !== alias.pricingUnit) return false;
    } else if (q) {
      const searchable = normalizeSearchTerm([
        listing.title,
        listing.summary,
        listing.supplierName,
        listing.region,
        listing.deliveryForm,
        ...listing.tags,
        ...Object.values(listing.specs),
      ].join(" "));
      if (!searchable.includes(q)) return false;
    }
    return true;
  });
}

export function sortResources(resourcesToSort = resourceListings, sort = "featured") {
  const sortKey = RESOURCE_SORTS.includes(sort) ? sort : "featured";
  return [...resourcesToSort].sort((left, right) => {
    let result = 0;
    if (sortKey === "price_asc") result = left.quote.median - right.quote.median;
    if (sortKey === "price_desc") result = right.quote.median - left.quote.median;
    if (sortKey === "updated_desc") result = right.quote.updatedAt.localeCompare(left.quote.updatedAt);
    if (sortKey === "sample_desc") result = right.quote.sampleCount - left.quote.sampleCount;
    if (sortKey === "featured") result = Number(right.featured) - Number(left.featured);
    return result || left.id.localeCompare(right.id, "zh-CN");
  });
}

export function filterAndSortResources(resourcesToFilter = resourceListings, filters = {}) {
  const parsed = parseResourceQuery(filters);
  return sortResources(filterResources(resourcesToFilter, parsed), parsed.sort);
}

export function formatPrice(value, pricingUnit, options = {}) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "—";
  const compact = options.compact === true;
  const withCurrency = options.withCurrency !== false;
  const formatted = new Intl.NumberFormat("zh-CN", {
    style: withCurrency ? "currency" : "decimal",
    currency: "CNY",
    currencyDisplay: "narrowSymbol",
    notation: compact ? "compact" : "standard",
    minimumFractionDigits: amount < 100 && !Number.isInteger(amount) ? 2 : 0,
    maximumFractionDigits: amount < 100 ? 2 : 0,
  }).format(amount);
  return `${formatted} / ${pricingUnit}`;
}

export function normalizeQuote(listingOrQuote, context = {}) {
  const listing = listingOrQuote?.quote ? listingOrQuote : undefined;
  const quote = listing?.quote ?? listingOrQuote;
  if (!quote || quote.currency !== "CNY" || !PRICING_UNITS.includes(quote.pricingUnit)) {
    throw new TypeError("normalizeQuote requires a valid CNY quote");
  }
  return Object.freeze({
    sourceListingId: context.sourceListingId ?? listing?.id ?? null,
    supplierId: context.supplierId ?? listing?.supplierId ?? null,
    supplierName: context.supplierName ?? listing?.supplierName ?? "待确认供应方",
    title: context.title ?? listing?.title ?? "标准化报价",
    currency: "CNY",
    pricingUnit: quote.pricingUnit,
    normalizedRangeMin: quote.rangeMin,
    normalizedRangeMax: quote.rangeMax,
    normalizedMedian: quote.median,
    displayRange: `${formatPrice(quote.rangeMin, quote.pricingUnit)} – ${formatPrice(quote.rangeMax, quote.pricingUnit)}`,
    displayMedian: formatPrice(quote.median, quote.pricingUnit),
    taxIncluded: quote.taxIncluded,
    energyIncluded: quote.energyIncluded,
    networkIncluded: quote.networkIncluded,
    scopeNote: quote.scopeNote,
    sampleCount: quote.sampleCount,
    validUntil: quote.validUntil,
    updatedAt: quote.updatedAt,
    normalizedAt: quote.updatedAt,
    methodology: "按相同区域、交付形态与计价单位标准化；市场参考报价，具体以询价确认为准。",
    disclaimer: MARKET_REFERENCE_NOTICE,
  });
}

function stableSerialize(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`).join(",")}}`;
}

function fnv1a(input) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36).toUpperCase().padStart(7, "0").slice(-7);
}

/**
 * @param {string} kind
 * @param {unknown} seed
 */
export function createInitializationRequestId(kind, seed = "kai-cloud-initialization") {
  if (!DEAL_MODES.includes(kind)) {
    throw new TypeError(`Unsupported request kind: ${kind}`);
  }
  const prefix = kind === "swap" ? "SWP" : kind === "service" ? "SRV" : "RNT";
  return `KAI-${prefix}-INIT-${fnv1a(`${kind}:${stableSerialize(seed)}`)}`;
}

export const initializationRentalRequests = Object.freeze([
  Object.freeze({
    id: createInitializationRequestId("rental", "gpu-h100-beijing-64"),
    requestType: "rental",
    dealMode: "rental",
    listingId: "gpu-h100-sxm-8-bj",
    category: "gpu",
    pricingUnit: "卡时",
    quantity: 64,
    durationHours: 720,
    region: "北京",
    expectedStartDate: "2026-08-08",
    companyName: "KAI 访客需求方",
    contactName: "未填写",
    contactMethod: "未填写",
    notes: "8 卡节点，训练周期约 30 天。",
    status: "quoted",
    createdAt: "2026-07-30T09:20:00.000Z",
  }),
  Object.freeze({
    id: createInitializationRequestId("service", "token-api-shanghai-2000"),
    requestType: "rental",
    dealMode: "service",
    listingId: "token-qwen-sh",
    category: "token_model",
    pricingUnit: "百万 Token",
    quantity: 2000,
    durationHours: 168,
    region: "上海",
    expectedStartDate: "2026-08-05",
    companyName: "KAI 访客需求方",
    contactName: "未填写",
    contactMethod: "未填写",
    notes: "需要稳定并发与用量报表。",
    status: "reviewing",
    createdAt: "2026-07-31T02:15:00.000Z",
  }),
]);

export const initializationSwapRequests = Object.freeze([
  Object.freeze({
    id: createInitializationRequestId("swap", "a800-for-h20-initialization"),
    requestType: "swap",
    offer: Object.freeze({ category: "gpu", description: "A800 80GB 资源", pricingUnit: "卡时", quantity: 12000, region: "广东" }),
    need: Object.freeze({ category: "gpu", description: "H20 96GB 推理资源", pricingUnit: "卡时", quantity: 16000, region: "内蒙古" }),
    cashAdjustmentAllowed: true,
    cashAdjustmentLimit: 50000,
    companyName: "KAI 访客需求方",
    contactName: "未填写",
    contactMethod: "未填写",
    notes: "可接受分批交付，补差上限待双方确认。",
    status: "matched",
    createdAt: "2026-07-29T06:40:00.000Z",
  }),
]);

export const initializationNormalizedQuotes = Object.freeze(
  [resourceListings[0], resourceListings[6], resourceListings[12]].map((listing) =>
    normalizeQuote(listing),
  ),
);
