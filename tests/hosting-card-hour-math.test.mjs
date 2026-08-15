import assert from "node:assert/strict";
import test from "node:test";

import { hostingCardHourMicrosForSeconds } from "../lib/hosting-v2.ts";

test("hosting card-hour calculation rounds exact integer micros upward", () => {
  assert.equal(hostingCardHourMicrosForSeconds(3_600_000, 180), 180_000);
  assert.equal(hostingCardHourMicrosForSeconds(49_763_531_797_021, 181), 2_501_999_793_129);
});

test("hosting card-hour calculation rejects results outside safe integer storage", () => {
  assert.throws(
    () => hostingCardHourMicrosForSeconds(Number.MAX_SAFE_INTEGER, 7_200),
    /HOSTING_AMOUNT_INVALID/u,
  );
});
