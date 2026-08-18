import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const ROOT = join(import.meta.dirname, "..");
const read = (path) => readFileSync(join(ROOT, path), "utf8");

test("request swap limits are two-decimal KAI card-hours without user-visible fiat", () => {
  const source = read("components/request-workbench.tsx");
  assert.match(source, /卡时补差/u);
  assert.match(source, /补差上限（KAI 标准卡时）/u);
  assert.match(source, /\^\\d\{1,9\}\(\?:\\\.\\d\{1,2\}\)\?\$/u);
  assert.match(source, /Number\(swap\.cashAmount\)\.toFixed\(2\)/u);
  assert.match(source, /最多两位小数的 KAI 标准卡时/u);
  assert.doesNotMatch(source, /¥|人民币|CNY|折合|参考人民币/u);
});

test("guide sends fiat top-up information only to the asset top-up anchor", () => {
  const guide = read("app/guides/page.tsx");
  assert.equal((guide.match(/\/member\/assets#topup/gu) ?? []).length, 2);
  assert.match(guide, /法币充值说明仅在“我的资产 → 充值卡时”/u);
  assert.doesNotMatch(guide, /人民币|¥|CNY|折合|参考人民币/u);
});
