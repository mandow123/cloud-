import assert from "node:assert/strict";
import test from "node:test";

import * as cardHourFormatting from "../lib/card-hours.ts";
import * as kaiStandardFormatting from "../lib/kai-standard-view-models.ts";

const MICRO_CASES = [
  { micros: 0, exact: "0", display: "0.00" },
  { micros: 1, exact: "0.000001", display: "0.00" },
  { micros: 4_999, exact: "0.004999", display: "0.00" },
  { micros: 5_000, exact: "0.005", display: "0.01" },
  { micros: 9_999, exact: "0.009999", display: "0.01" },
  { micros: 10_000, exact: "0.01", display: "0.01" },
  { micros: 1_004_999, exact: "1.004999", display: "1.00" },
  { micros: 1_005_000, exact: "1.005", display: "1.01" },
  { micros: Number.MAX_SAFE_INTEGER, exact: "9007199254.740991", display: "9,007,199,254.74" },
];

test("the canonical card-hour formatter keeps the exact 0-to-6-decimal ledger representation", () => {
  for (const { micros, exact } of MICRO_CASES) {
    assert.equal(
      cardHourFormatting.formatCardHourMicros(micros),
      exact,
      `${micros} micros must remain exactly reconcilable`,
    );
  }
});

test("the card-hour display formatter always emits two decimals, groups thousands, and rounds half-up", () => {
  const format = cardHourFormatting.formatCardHourDisplayMicros;
  assert.equal(typeof format, "function", "formatCardHourDisplayMicros must be exported from lib/card-hours.ts");

  for (const { micros, display } of MICRO_CASES) {
    assert.equal(format(micros), display, `${micros} micros must display as ${display}`);
  }
});

test("the KAI-SCH display formatter rounds exact decimal strings half-up to two fixed decimals", () => {
  const format = kaiStandardFormatting.formatKaiSchDisplay;
  assert.equal(typeof format, "function", "formatKaiSchDisplay must be exported from lib/kai-standard-view-models.ts");

  const cases = [
    ["0", "0.00"],
    ["0.000001", "0.00"],
    ["0.004999", "0.00"],
    ["0.005", "0.01"],
    ["0.009999", "0.01"],
    ["0.01", "0.01"],
    ["1.004999", "1.00"],
    ["1.005", "1.01"],
    ["1234567.894999", "1,234,567.89"],
    ["1234567.895", "1,234,567.90"],
    ["9007199254.740991", "9,007,199,254.74"],
  ];

  for (const [value, expected] of cases) {
    assert.equal(format(value), expected, `${value} KAI-SCH must display as ${expected}`);
  }
});

test("the generic decimal formatter keeps native quantities at up to four decimals", () => {
  assert.equal(kaiStandardFormatting.formatKaiDecimal("0.118400"), "0.1184");
  assert.equal(kaiStandardFormatting.formatKaiDecimal("1.234567"), "1.2345");
  assert.equal(kaiStandardFormatting.formatKaiDecimal("1234567.800000"), "1,234,567.8");
  assert.equal(kaiStandardFormatting.formatKaiDecimal("1000"), "1,000");
});
