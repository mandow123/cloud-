import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { isMarketV1Enabled } from "../lib/server/market-v1-feature.ts";

test("KAI_MARKET_V1 has an explicit on path and a safe off rollback", () => {
  assert.equal(isMarketV1Enabled({}), false);
  assert.equal(isMarketV1Enabled({ KAI_MARKET_V1: "0" }), false);
  assert.equal(isMarketV1Enabled({ KAI_MARKET_V1: "1" }), true);
  assert.equal(isMarketV1Enabled({ KAI_MARKET_V1: "true" }), true);

  const page = readFileSync("app/buy/page.tsx", "utf8");
  assert.match(page, /if \(isMarketV1Enabled\(\)\) redirect\(PRODUCT_PATHS\.gpu\)/u);
  assert.match(page, /<BuyWorkspace \/>/u, "flag off must retain the previous buyer workspace");
});

test("all mounted buyer entry points use the canonical GPU market", () => {
  for (const path of [
    "components/site-header.tsx",
    "components/mobile-demand-cta.tsx",
    "components/buyer-order-list.tsx",
  ]) {
    const source = readFileSync(path, "utf8");
    assert.match(source, /\/gpu/u, `${path} must link to /gpu`);
    assert.doesNotMatch(source, /href="\/buy"|href="\/market\/listings"/u, `${path} must not advertise a second buyer market`);
  }

  const legacy = readFileSync("lib/product-surface-policy.ts", "utf8");
  assert.match(legacy, /marketListings:\s*PRODUCT_PATHS\.gpu/u);
});
