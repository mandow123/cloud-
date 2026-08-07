import assert from "node:assert/strict";
import test from "node:test";

import {
  CURATED_DEMAND_REFRESH_LABEL,
  curatedMarketDemands,
  isCuratedMarketDemandId,
} from "../lib/server/curated-market-demands.ts";

test("curated procurement calls roll at Monday 06:10 Beijing without UTC date drift", () => {
  const beforeBoundary = curatedMarketDemands(new Date("2026-08-02T22:09:59.000Z"));
  const atBoundary = curatedMarketDemands(new Date("2026-08-02T22:10:00.000Z"));
  const laterSameWeek = curatedMarketDemands(new Date("2026-08-06T05:00:00.000Z"));
  assert.equal(beforeBoundary[0].updatedAt, "2026-07-26T22:10:00.000Z");
  assert.equal(atBoundary[0].updatedAt, "2026-08-02T22:10:00.000Z");
  assert.equal(atBoundary[0].deliveryDate, "2026-08-12");
  assert.equal(atBoundary[3].deliveryDate, "2026-08-10");
  assert.notEqual(beforeBoundary[0].payloadHash, atBoundary[0].payloadHash);
  assert.equal(atBoundary[0].payloadHash, laterSameWeek[0].payloadHash);
  assert.match(atBoundary[0].payloadHash, /^kai-curated-demand-v3:.*:[0-9a-f]{8}$/u);
  assert.match(CURATED_DEMAND_REFRESH_LABEL, /系统滚动生成/u);
});

test("curated procurement quantities, ids and public descriptions are internally consistent", () => {
  const demands = curatedMarketDemands(new Date("2026-08-06T05:00:00.000Z"));
  assert.equal(demands.length, 5);
  assert.equal(new Set(demands.map((demand) => demand.id)).size, 5);
  assert.ok(demands.every((demand) => isCuratedMarketDemandId(demand.id)));
  assert.equal(demands[0].quantity, 8 * 168);
  assert.equal(demands[1].quantity, 16 * 72);
  assert.equal(demands[2].quantity, 8 * 720);
  assert.equal(demands[3].quantity, 12_000);
  assert.equal(demands[4].quantity, 30 * 3);
  assert.doesNotMatch(JSON.stringify(demands), /@|1[3-9]\d{9}|微信|联系人|演示|模拟|虚构|保本|收益/u);
});
