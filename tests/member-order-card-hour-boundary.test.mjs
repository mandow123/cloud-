import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const ROOT = join(import.meta.dirname, "..");

function source(path) {
  return readFileSync(join(ROOT, path), "utf8");
}

test("member quotes expose only two-decimal KAI standard card hours", () => {
  const member = source("components/member-workspace.tsx");

  assert.doesNotMatch(member, /人民币|¥|折合|参考人民币/u);
  assert.doesNotMatch(member, /style:\s*"currency"|currency:\s*"CNY"|formatCurrency/u);
  assert.match(member, /formatCardHourDisplayMicros\(cents === 0 \? 0 : cnyCentsToCardHourMicros\(cents\)\)/u);
  assert.match(member, /报价单价（KAI 标准卡时 \/ \{selectedDemand\?\.pricingUnit \?\? "对应单位"\}）/u);
  assert.match(member, /最多两位小数/u);
  assert.match(member, /pattern="\[0-9\]\{1,8\}\(\[\.\]\[0-9\]\{1,2\}\)\?"/u);
  assert.match(member, /parseCardHourInputMicros\(quoteValues\.unitPrice\)/u);
  assert.match(member, /hostingCnyReferenceCents\(priceMicros\)/u);
  assert.doesNotMatch(member, /Number\(quoteValues\.unitPrice\)/u);
});

test("buyer orders expose the historical amount only as KAI standard card hours", () => {
  const orders = source("components/buyer-order-list.tsx");

  assert.doesNotMatch(orders, /人民币|¥|折合|参考人民币|订单金额/u);
  assert.doesNotMatch(orders, /style:\s*"currency"|currency:\s*"CNY"|function money/u);
  assert.match(orders, /formatCardHourDisplayMicros\(cnyCentsToCardHourMicros\(cents\)\)/u);
  assert.match(orders, /订单卡时/u);
  assert.match(orders, /KAI 标准卡时/u);
});
