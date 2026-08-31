import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("methodology renders from the request locale and preserves pricing rules", () => {
  const source = readFileSync("app/methodology/page.tsx", "utf8");
  for (const locale of ["zh-CN", "zh-TW", "en", "ja", "ko", "fr", "th", "vi", "id", "ms"]) {
    assert.match(source, new RegExp(`(?:"${locale}"|${locale}:)`), `${locale} must be represented`);
  }
  assert.match(source, /getRequestLocale\(\)/u);
  for (const invariant of ["P25", "P50", "P75", "05:40", "05:50", "05:55", "06:00", "06:00 CST", "90-day", "30 days", "base is 100", "8 GPUs for 10 hours", "80 GPU capacity-hours"]) {
    assert.equal(source.includes(invariant), true, `${invariant} must remain unchanged`);
  }
  assert.match(source, /href="\/market"/u);
  assert.match(source, /href="\/request"/u);
});
