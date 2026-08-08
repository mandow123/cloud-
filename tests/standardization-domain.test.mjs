import assert from "node:assert/strict";
import test from "node:test";
import {
  KAI_STANDARD_UNIT_CATALOG,
  baseUnitsToNativeDecimal,
  deriveKaiSchMicros,
  divideHalfEven,
  microKaiToDecimal,
  parseAppendStandardizationSnapshot,
  sampleIsIndexEligible,
} from "../lib/standardization.ts";

test("unit catalog covers the full declared system without inventing planned market products", () => {
  assert.equal(KAI_STANDARD_UNIT_CATALOG.length, 12);
  assert.deepEqual(KAI_STANDARD_UNIT_CATALOG.map((item) => item.label), [
    "GPU 卡时", "服务器时", "物理核时", "vCPU 时", "语模时", "推理模型实例时",
    "视模时", "百万 Token 容量时", "TiB 时", "柜时", "标准柜月（720 柜时）", "kW 柜时",
  ]);
  const rackMonth = KAI_STANDARD_UNIT_CATALOG.find((item) => item.unitCode === "STANDARD_RACK_MONTH_720");
  assert.deepEqual(rackMonth, {
    unitCode: "STANDARD_RACK_MONTH_720",
    label: "标准柜月（720 柜时）",
    status: "PLANNED",
    comparisonOnly: true,
  });
  assert.equal(KAI_STANDARD_UNIT_CATALOG.some((item) => "productVersionId" in item), false);
});

test("KAI-SCH v1 uses exact BigInt half-even arithmetic and decimal strings", () => {
  assert.equal(divideHalfEven(BigInt(5), BigInt(2)), BigInt(2));
  assert.equal(divideHalfEven(BigInt(7), BigInt(2)), BigInt(4));
  assert.equal(microKaiToDecimal(BigInt(1_500_000)), "1.500000");
  assert.equal(baseUnitsToNativeDecimal(BigInt(28_800), BigInt(3_600)), "8.000000");
  assert.equal(deriveKaiSchMicros({
    nativeCapacityBaseUnits: BigInt(3_600),
    nativePriceBasisBaseUnits: BigInt(3_600),
    nativeIndexPriceCnyMicros: BigInt(30_000_000),
    benchmarkP50CnyMicros: BigInt(20_000_000),
  }), BigInt(1_500_000));
});

test("snapshot input requires explicit index eligibility and excludes promotions fail-closed", () => {
  const parsed = parseAppendStandardizationSnapshot({
    asOf: "2026-08-08T00:00:00.000Z",
    expiresAt: "2026-08-09T00:00:00.000Z",
    samples: [{
      sampleId: "sample-0001",
      productCode: "GPU_COMPUTE",
      productVersionId: "PV-GPU-H100-SXM5-80GB",
      region: "全国",
      unitPriceCnyMicros: "20000000",
      benchmark: true,
      promotional: false,
      marketIndexEligible: true,
      sourceSystem: "EXCHANGE",
      observedAt: "2026-08-08T00:00:00.000Z",
    }],
  });
  assert.equal(sampleIsIndexEligible(parsed.samples[0]), true);
  assert.equal(sampleIsIndexEligible({ ...parsed.samples[0], promotional: true }), false);
  assert.equal(sampleIsIndexEligible({ ...parsed.samples[0], marketIndexEligible: false }), false);
  assert.equal(sampleIsIndexEligible({ ...parsed.samples[0], sourceSystem: "SUPPLY_PILOT" }), false);
  assert.throws(() => parseAppendStandardizationSnapshot({
    ...parsed,
    samples: [{ ...parsed.samples[0], marketIndexEligible: undefined }],
  }), /资格字段/u);
  assert.throws(() => parseAppendStandardizationSnapshot({
    ...parsed,
    samples: [{
      ...parsed.samples[0],
      productVersionId: "PV-GPU-A100-SXM4-80GB",
      benchmark: true,
    }],
  }), /H100 SXM5 80GB/u);
  assert.throws(() => parseAppendStandardizationSnapshot({
    ...parsed,
    samples: [{ ...parsed.samples[0], observedAt: "2026-08-08T00:00:01.000Z" }],
  }), /observedAt 不能晚于/u);
});
