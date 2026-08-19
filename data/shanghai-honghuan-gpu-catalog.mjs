/**
 * Supplier-provided GPU offers for Shanghai Honghuan Network Technology Co., Ltd.
 *
 * Source: user-provided supplier quote image and machine specifications.
 * Observed: 2026-08-19.
 * Prices remain stored as the supplier's CNY source values and receive the
 * platform-wide 50% supplier listing markup exactly once before public card-hour
 * conversion. Public purchase actions remain manual inquiries.
 */

import {
  SUPPLIER_LISTING_PRICE_MULTIPLIER,
  applySupplierListingMarkup,
} from "../lib/pricing-policy.mjs";

const SUPPLIER_ID = "supplier-shanghai-honghuan";
const SUPPLIER_NAME = "上海鸿欢网络科技有限公司";
const SUPPLIER_LOGO_URL = "/assets/suppliers/shanghai-honghuan.jpg";
const SOURCE_DOCUMENT = "GPU 算力租赁价格表（供应商提供图片）";
const OBSERVED_AT = "2026-08-19";
const UPDATED_AT = "2026-08-19T04:00:00.000Z";
const VALID_UNTIL = "2026-09-19T03:59:59.000Z";

function publicCardHours(sourceCny) {
  return `${(applySupplierListingMarkup(sourceCny) / 1.002).toFixed(2)} KAI 标准卡时`;
}

function createListing({
  slug,
  title,
  gpu,
  sourceHourlyCny,
  sourceDailyCny,
  summary,
  specs,
  tags,
  featured = false,
}) {
  const listedHourlyCny = applySupplierListingMarkup(sourceHourlyCny);
  return Object.freeze({
    id: `gpu-honghuan-${slug}`,
    title,
    category: "gpu",
    dealModes: Object.freeze(["rental", "service"]),
    pricingUnit: "卡时",
    region: "全国",
    supplierId: SUPPLIER_ID,
    supplierName: SUPPLIER_NAME,
    supplierLogoUrl: SUPPLIER_LOGO_URL,
    deliveryForm: "云主机",
    summary,
    specs: Object.freeze({
      GPU: gpu,
      "小时挂牌": `${publicCardHours(sourceHourlyCny)} / GPU 小时`,
      "24 小时挂牌": `${publicCardHours(sourceDailyCny)} / 24 小时`,
      "实际机房地域": "询价时确认；全国仅表示可申请服务范围",
      ...specs,
    }),
    capacity: "供应商确认可售；即时库存与可交付数量在询价后人工确认",
    sla: "人工交付；服务等级、故障赔付与数据清理规则以正式报价确认",
    deliveryLeadTime: "询价确认后人工交付",
    tags: Object.freeze([...tags, "可申请购买", "人工交付"]),
    featured,
    quote: Object.freeze({
      currency: "CNY",
      pricingUnit: "卡时",
      rangeMin: listedHourlyCny,
      rangeMax: listedHourlyCny,
      median: listedHourlyCny,
      taxIncluded: false,
      energyIncluded: false,
      networkIncluded: false,
      scopeNote: "供应商报价按统一供应挂牌策略上调 50%；页面固定换算为 KAI 标准卡时。税费、电力、网络、公网 IP、扩容与交付条件需在人工询价时确认。",
      sampleCount: 1,
      validUntil: VALID_UNTIL,
      updatedAt: UPDATED_AT,
      disclaimer: "市场参考报价 · 具体以询价确认为准",
    }),
    source: Object.freeze({
      kind: "SUPPLIER_PROVIDED_QUOTE",
      supplierName: SUPPLIER_NAME,
      documentTitle: SOURCE_DOCUMENT,
      observedAt: OBSERVED_AT,
      verificationStatus: "SUPPLIER_PROVIDED",
      notice: "供应商提供的可售报价；全国仅用于服务范围筛选，实际机房地域、网络、即时库存、税费和最终交付条件需人工确认。",
      note: "登录后提交询价与 SSH 公钥，由管理员协调供应商人工交付。",
      originalCurrency: "CNY",
      publicConversionRate: "KAI-SCH-1.002",
      listingPriceMultiplier: SUPPLIER_LISTING_PRICE_MULTIPLIER,
    }),
  });
}

export const shanghaiHonghuanGpuListings = Object.freeze([
  createListing({
    slug: "a100-sxm4-80gb-1",
    title: "A100 SXM4 80GB · 单卡",
    gpu: "NVIDIA A100 SXM4 80GB × 1",
    sourceHourlyCny: 19,
    sourceDailyCny: 456,
    summary: "上海鸿欢网络科技有限公司提供的 A100 SXM4 单卡云主机。",
    specs: { 硬盘: "256GB", 地域与网络: "询价时确认" },
    tags: ["A100", "SXM4", "80GB", "单卡"],
  }),
  createListing({
    slug: "a100-sxm4-80gb-2",
    title: "A100 SXM4 80GB · 双卡",
    gpu: "NVIDIA A100 SXM4 80GB × 2",
    sourceHourlyCny: 36,
    sourceDailyCny: 864,
    summary: "上海鸿欢网络科技有限公司提供的 A100 SXM4 双卡云主机。",
    specs: { 硬盘: "256GB", 地域与网络: "询价时确认" },
    tags: ["A100", "SXM4", "80GB", "双卡"],
  }),
  createListing({
    slug: "h100-sxm-80gb-1",
    title: "H100 SXM 80GB · 单卡",
    gpu: "NVIDIA H100 SXM 80GB × 1",
    sourceHourlyCny: 60,
    sourceDailyCny: 1440,
    summary: "H100 单卡规格，支持按需确认双卡与四卡方案。",
    specs: { CPU: "28 核", 内存: "200GB", 存储: "100GB，可扩容（另行报价）", 可选卡数: "单卡 / 双卡 / 四卡；四卡价格需询价确认" },
    tags: ["H100", "SXM", "80GB", "单卡", "四卡可询价"],
    featured: true,
  }),
  createListing({
    slug: "h100-sxm-80gb-2",
    title: "H100 SXM 80GB · 双卡",
    gpu: "NVIDIA H100 SXM 80GB × 2",
    sourceHourlyCny: 109,
    sourceDailyCny: 2616,
    summary: "H100 双卡规格，支持按需确认单卡与四卡方案。",
    specs: { CPU: "28 核", 内存: "200GB", 存储: "100GB，可扩容（另行报价）", 可选卡数: "单卡 / 双卡 / 四卡；四卡价格需询价确认" },
    tags: ["H100", "SXM", "80GB", "双卡", "四卡可询价"],
    featured: true,
  }),
  createListing({
    slug: "h200-nvl-1",
    title: "H200 NVL · 单卡",
    gpu: "NVIDIA H200 NVL × 1（供应商标称 140GB；环境观测约 144GB）",
    sourceHourlyCny: 59,
    sourceDailyCny: 1416,
    summary: "H200 NVL 单卡环境，可通过 SSH 由平台协调人工交付。",
    specs: { 宿主机CPU: "系统观测 512 线程", 宿主机内存: "环境观测约 2.2TB", 套餐硬盘: "256GB；当前环境可写约 50GB，交付时复核", CUDA: "13.0", Python: "3.12", PyTorch: "尚未安装" },
    tags: ["H200", "NVL", "单卡", "CUDA 13", "SSH"],
    featured: true,
  }),
  createListing({
    slug: "h200-nvl-2",
    title: "H200 NVL · 双卡",
    gpu: "NVIDIA H200 NVL 140GB × 2",
    sourceHourlyCny: 92,
    sourceDailyCny: 2208,
    summary: "上海鸿欢网络科技有限公司提供的 H200 NVL 双卡方案。",
    specs: { 硬盘: "256GB", CPU与内存: "询价时确认", 软件环境: "交付时确认" },
    tags: ["H200", "NVL", "140GB", "双卡"],
    featured: true,
  }),
  createListing({
    slug: "b200-179gb-1",
    title: "B200 179GB · 单卡",
    gpu: "NVIDIA B200 179GB × 1",
    sourceHourlyCny: 96,
    sourceDailyCny: 2304,
    summary: "上海鸿欢网络科技有限公司提供的 B200 单卡方案。",
    specs: { 硬盘: "256GB", CPU与内存: "询价时确认" },
    tags: ["B200", "179GB", "单卡"],
    featured: true,
  }),
  createListing({
    slug: "b200-179gb-2",
    title: "B200 179GB · 双卡",
    gpu: "NVIDIA B200 179GB × 2",
    sourceHourlyCny: 186,
    sourceDailyCny: 4464,
    summary: "双卡 B200 云主机，存储支持按需扩容。",
    specs: { CPU: "40 核", 内存: "400GB", 存储: "100GB，可扩容（另行报价）" },
    tags: ["B200", "179GB", "双卡", "400GB 内存"],
    featured: true,
  }),
  createListing({
    slug: "b200-179gb-4",
    title: "B200 179GB · 四卡",
    gpu: "NVIDIA B200 179GB × 4",
    sourceHourlyCny: 366,
    sourceDailyCny: 8784,
    summary: "上海鸿欢网络科技有限公司提供的 B200 四卡方案。",
    specs: { 硬盘: "256GB", CPU与内存: "询价时确认" },
    tags: ["B200", "179GB", "四卡"],
    featured: true,
  }),
  createListing({
    slug: "b300-269gb-1",
    title: "B300 269GB · 单卡",
    gpu: "NVIDIA B300 269GB × 1（供应商标称）",
    sourceHourlyCny: 204,
    sourceDailyCny: 4896,
    summary: "供应商标称 269GB 显存的 B300 单卡方案，具体型号与显存交付时复核。",
    specs: { 硬盘: "256GB", CPU与内存: "询价时确认", 规格状态: "供应商标称，交付前复核" },
    tags: ["B300", "269GB", "单卡"],
    featured: true,
  }),
]);

export const shanghaiHonghuanSupplier = Object.freeze({
  id: SUPPLIER_ID,
  name: SUPPLIER_NAME,
  shortName: "上海鸿欢",
  description: "供应商提供 GPU 算力报价；实际机房地域、库存与交付条件需询价确认。",
  categoryFocus: Object.freeze(["gpu"]),
});
