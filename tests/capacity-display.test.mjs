import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import {
  capacityDisplay,
  formatCapacityHours,
  formatRateUnits,
  formatStandardMonthComparison,
  formatUnitPrice,
} from "../lib/capacity-display.ts";

test("capacity vocabulary keeps model instance copy free of GPU aliases", () => {
  const vocabulary = capacityDisplay("MODEL_INSTANCE");
  assert.equal(vocabulary.rateFieldLabel, "实例数量");
  assert.equal(vocabulary.capacityFieldLabel, "模型实例时");
  assert.doesNotMatch(JSON.stringify(vocabulary), /gpu|卡|parallel/iu);
});

test("capacity vocabulary preserves the existing GPU public language", () => {
  const vocabulary = capacityDisplay("GPU_COMPUTE");
  assert.equal(vocabulary.rateFieldLabel, "并行卡数");
  assert.equal(vocabulary.pricingUnitLabel, "GPU 小时");
});

test("capacity formatters use canonical rate, base units and micro prices", () => {
  assert.equal(formatRateUnits("MODEL_INSTANCE", 12), "12 个实例");
  assert.equal(formatCapacityHours("MODEL_INSTANCE", 21_600), "6 模型实例时");
  assert.match(formatUnitPrice("MODEL_INSTANCE", 12_345_600), /12[.,]3456/u);
  assert.match(formatUnitPrice("MODEL_INSTANCE", 12_345_600), /模型实例时/u);
});

test("Token throughput uses million-Token-per-hour rate and capacity-hour units", () => {
  const vocabulary = capacityDisplay("TOKEN_THROUGHPUT");
  assert.equal(vocabulary.rateFieldLabel, "预留吞吐");
  assert.doesNotMatch(JSON.stringify(vocabulary), /GPU|卡|MODEL_INSTANCE|模型实例|parallel/u);
  assert.equal(formatRateUnits("TOKEN_THROUGHPUT", 3_000), "3 百万 Token/小时");
  assert.equal(formatCapacityHours("TOKEN_THROUGHPUT", 7_200_000), "2 百万 Token 容量时");
  assert.match(formatUnitPrice("TOKEN_THROUGHPUT", 4_900_000), /百万 Token 容量时/u);
});

test("NAS uses TiB inputs over canonical integer GiB and TiB-hour pricing", () => {
  const vocabulary = capacityDisplay("NAS_STORAGE");
  assert.equal(vocabulary.rateFieldLabel, "预留存储容量");
  assert.doesNotMatch(JSON.stringify(vocabulary), /GPU|卡|Token|MODEL_INSTANCE|模型实例|机柜|parallel/u);
  assert.equal(formatRateUnits("NAS_STORAGE", 2_048), "2 TiB");
  assert.equal(formatCapacityHours("NAS_STORAGE", 7_372_800), "2 TiB·小时");
  assert.match(formatUnitPrice("NAS_STORAGE", 350_000), /TiB·小时/u);
});

test("rack capacity stays integer-only and exposes rack-hour vocabulary", () => {
  const vocabulary = capacityDisplay("RACK_SPACE");
  assert.equal(vocabulary.rateFieldLabel, "整柜数量");
  assert.doesNotMatch(JSON.stringify(vocabulary), /GPU|卡|Token|MODEL_INSTANCE|模型实例|NAS|parallel/u);
  assert.equal(formatRateUnits("RACK_SPACE", 2), "2 柜");
  assert.equal(formatCapacityHours("RACK_SPACE", 7_200), "2 柜时");
  assert.match(formatUnitPrice("RACK_SPACE", 12_500_000), /柜时/u);
  assert.match(formatStandardMonthComparison("RACK_SPACE", 12_500_000), /9[,.]?000\.00.*标准柜月/u);
  assert.equal(formatStandardMonthComparison("NAS_STORAGE", 12_500_000), null);
});

test("capacity display fails closed for unsupported product discriminators", () => {
  assert.throws(() => capacityDisplay("POWER_CAPACITY"), /Unsupported capacity product/u);
  assert.throws(() => formatRateUnits("MODEL_INSTANCE", -1), /non-negative safe integer/u);
  assert.throws(() => formatCapacityHours("MODEL_INSTANCE", Number.MAX_SAFE_INTEGER + 1), /non-negative safe integer/u);
});

test("checkout sends the canonical five-field capacity request", () => {
  const source = readFileSync(new URL("../components/capacity-checkout.tsx", import.meta.url), "utf8");
  const body = source.match(/exchangePost<ExchangeOrder>[\s\S]*?\{\s*listingVersionId:[\s\S]*?interruptibility:[^\n]+\n\s*\}/u)?.[0] ?? "";
  assert.match(body, /listingVersionId:/u);
  assert.match(body, /rateUnits,/u);
  assert.match(body, /startAt:/u);
  assert.match(body, /endAt:/u);
  assert.match(body, /interruptibility:/u);
  assert.doesNotMatch(body, /parallelUnits|capacityGpu|unitPrice/u);
  assert.equal(existsSync(new URL("../components/gpu-checkout.tsx", import.meta.url)), false);
});

test("NAS supplier and checkout inputs scale whole TiB to canonical integer GiB", () => {
  for (const relativePath of ["../components/capacity-checkout.tsx", "../components/supplier-exchange-workspace.tsx"]) {
    const source = readFileSync(new URL(relativePath, import.meta.url), "utf8");
    assert.match(source, /productCode === "NAS_STORAGE"/u);
    assert.match(source, /input \* 1_024/u);
    assert.match(source, /rateUnits \/ 1_024/u);
  }
});
