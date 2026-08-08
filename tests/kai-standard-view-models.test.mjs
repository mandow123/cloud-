import assert from "node:assert/strict";
import test from "node:test";

import {
  KaiStandardContractError,
  accountPresentationState,
  formatCnyCents,
  formatCnyMicros,
  formatKaiDecimal,
  memberResponseState,
  parseKaiHoursAccountEnvelope,
  parseKaiStandardQuoteEnvelope,
  quotePresentationState,
  snapshotIsExpired,
} from "../lib/kai-standard-view-models.ts";

const quoteFixture = {
  policy: { version: "KAI-SCH-v1.2", unitCode: "KAI_SCH", benchmarkLabel: "H100 SXM5 80GB 标准交付" },
  snapshot: { asOf: "2026-08-08T06:00:00+08:00", expiresAt: "2026-08-09T06:00:00+08:00", status: "CURRENT", p25CnyMicros: "18500000", p50CnyMicros: "20600000", p75CnyMicros: "23000000", sampleCount: 72 },
  quotes: [{ productCode: "GPU_COMPUTE", productVersionId: "PV-GPU-RTX4090-PCIE-24GB", productLabel: "RTX 4090 24GB", nativeUnitCode: "GPU_CARD_HOUR", nativeUnitLabel: "4090 卡时", region: "华东", p25KaiSch: "0.118400", p50KaiSch: "0.1300", p75KaiSch: "0.1456", sampleCount: 24, asOf: "2026-08-08T06:00:00+08:00", expiresAt: "2026-08-09T06:00:00+08:00", policyVersion: "KAI-SCH-v1.2" }],
};

const accountFixture = {
  policyVersion: "KAI-SCH-v1.2",
  asOf: "2026-08-08T06:00:00+08:00",
  expiresAt: "2026-08-09T06:00:00+08:00",
  status: "CURRENT",
  summary: { depositedKaiSch: "120.5000", availableKaiSch: "88.25", earnedKaiSch: "14.75", settlementCnyCents: "1860000" },
  positions: [{ productCode: "GPU_COMPUTE", productVersionId: "PV-GPU-RTX4090-PCIE-24GB", productLabel: "RTX 4090 24GB", nativeAmount: "240", nativeUnitLabel: "4090 卡时", availableKaiSch: "26.1", heldKaiSch: "5.2" }],
  income: { pendingCnyCents: "624000", payableCnyCents: "120000", settledCnyCents: "1860000" },
};

test("standardization quote contract preserves decimal KAI values and policy metadata", () => {
  const parsed = parseKaiStandardQuoteEnvelope(quoteFixture);
  assert.equal(parsed.policy.version, "KAI-SCH-v1.2");
  assert.equal(parsed.quotes[0].productVersionId, "PV-GPU-RTX4090-PCIE-24GB");
  assert.equal(parsed.snapshot.p50CnyMicros, "20600000");
  assert.equal(parsed.quotes[0].p25KaiSch, "0.118400");
  assert.equal(formatKaiDecimal(parsed.quotes[0].p25KaiSch), "0.1184");
  assert.equal(formatCnyMicros(parsed.snapshot.p50CnyMicros), "¥20.60");
});

test("standardization quote contract rejects a quote from a different policy version", () => {
  const invalid = structuredClone(quoteFixture);
  invalid.quotes[0].policyVersion = "KAI-SCH-v0";
  assert.throws(() => parseKaiStandardQuoteEnvelope(invalid), KaiStandardContractError);
});

test("standardization quote contract requires a product version to prevent mixed-model prices", () => {
  const invalid = structuredClone(quoteFixture);
  delete invalid.quotes[0].productVersionId;
  assert.throws(() => parseKaiStandardQuoteEnvelope(invalid), KaiStandardContractError);
});

test("standardization contracts reject unknown product codes and missing account product versions", () => {
  const unknownProduct = structuredClone(quoteFixture);
  unknownProduct.quotes[0].productCode = "UNKNOWN_PRODUCT";
  assert.throws(() => parseKaiStandardQuoteEnvelope(unknownProduct), KaiStandardContractError);

  const missingVersion = structuredClone(accountFixture);
  delete missingVersion.positions[0].productVersionId;
  assert.throws(() => parseKaiHoursAccountEnvelope(missingVersion), KaiStandardContractError);
});

test("account contract keeps native positions, KAI equivalents and CNY settlement separate", () => {
  const parsed = parseKaiHoursAccountEnvelope(accountFixture);
  assert.equal(parsed.positions[0].nativeAmount, "240");
  assert.equal(parsed.positions[0].availableKaiSch, "26.1");
  assert.equal(parsed.summary.settlementCnyCents, "1860000");
  assert.equal(formatCnyCents(parsed.summary.settlementCnyCents), "¥18,600.00");
});

test("account and quote timestamps have an explicit expiry decision", () => {
  assert.equal(snapshotIsExpired("2026-08-08T05:59:59+08:00", new Date("2026-08-08T06:00:00+08:00")), true);
  assert.equal(snapshotIsExpired("2026-08-08T06:00:01+08:00", new Date("2026-08-08T06:00:00+08:00")), false);
});

test("malformed money and decimal values fail instead of becoming zero", () => {
  const invalidAccount = structuredClone(accountFixture);
  invalidAccount.summary.availableKaiSch = "not-a-number";
  assert.throws(() => parseKaiHoursAccountEnvelope(invalidAccount), KaiStandardContractError);
  const invalidQuote = structuredClone(quoteFixture);
  invalidQuote.snapshot.p50CnyMicros = -1;
  assert.throws(() => parseKaiStandardQuoteEnvelope(invalidQuote), KaiStandardContractError);
  const numericMoney = structuredClone(accountFixture);
  numericMoney.summary.settlementCnyCents = 9007199254740992;
  assert.throws(() => parseKaiHoursAccountEnvelope(numericMoney), KaiStandardContractError);
  const numericKai = structuredClone(accountFixture);
  numericKai.summary.availableKaiSch = 88.25;
  assert.throws(() => parseKaiHoursAccountEnvelope(numericKai), KaiStandardContractError);
  const reversedQuartiles = structuredClone(quoteFixture);
  reversedQuartiles.quotes[0].p25KaiSch = "0.9";
  assert.throws(() => parseKaiStandardQuoteEnvelope(reversedQuartiles), KaiStandardContractError);
});

test("presentation decisions execute current, empty, stale, expired and unavailable branches", () => {
  const now = new Date("2026-08-08T06:30:00+08:00");
  const quote = parseKaiStandardQuoteEnvelope(quoteFixture);
  const account = parseKaiHoursAccountEnvelope(accountFixture);
  assert.equal(quotePresentationState(quote, now), "READY");
  assert.equal(accountPresentationState(account, now), "READY");

  const emptyQuote = structuredClone(quoteFixture);
  emptyQuote.quotes = [];
  assert.equal(quotePresentationState(parseKaiStandardQuoteEnvelope(emptyQuote), now), "EMPTY");
  const emptyAccount = structuredClone(accountFixture);
  emptyAccount.positions = [];
  assert.equal(accountPresentationState(parseKaiHoursAccountEnvelope(emptyAccount), now), "EMPTY");

  const staleQuote = structuredClone(quoteFixture);
  staleQuote.snapshot.status = "STALE";
  assert.equal(quotePresentationState(parseKaiStandardQuoteEnvelope(staleQuote), now), "STALE");
  assert.equal(quotePresentationState(quote, new Date("2026-08-09T06:00:00+08:00")), "STALE");
  const staleAccount = structuredClone(accountFixture);
  staleAccount.status = "STALE";
  assert.equal(accountPresentationState(parseKaiHoursAccountEnvelope(staleAccount), now), "STALE");
  assert.equal(accountPresentationState(account, new Date("2026-08-09T06:00:00+08:00")), "STALE");

  const unavailableQuote = structuredClone(quoteFixture);
  unavailableQuote.snapshot = {
    asOf: "2026-08-08T06:00:00+08:00",
    expiresAt: "2026-08-08T06:00:00+08:00",
    status: "UNAVAILABLE",
    p25CnyMicros: null,
    p50CnyMicros: null,
    p75CnyMicros: null,
    sampleCount: 0,
  };
  unavailableQuote.quotes = [];
  assert.equal(quotePresentationState(parseKaiStandardQuoteEnvelope(unavailableQuote), now), "UNAVAILABLE");

  const unavailableAccount = structuredClone(accountFixture);
  unavailableAccount.status = "UNAVAILABLE";
  unavailableAccount.expiresAt = unavailableAccount.asOf;
  unavailableAccount.positions = [];
  assert.equal(accountPresentationState(parseKaiHoursAccountEnvelope(unavailableAccount), now), "UNAVAILABLE");
});

test("member response decisions execute signed-out, forbidden, ready and error branches", () => {
  assert.equal(memberResponseState(401), "SIGNED_OUT");
  assert.equal(memberResponseState(403), "FORBIDDEN");
  assert.equal(memberResponseState(200), "READY");
  assert.equal(memberResponseState(204), "READY");
  assert.equal(memberResponseState(500), "ERROR");
});
