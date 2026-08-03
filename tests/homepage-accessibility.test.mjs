import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { resourceListings } from "../lib/catalog.mjs";

let workerPromise;

async function getWorker() {
  if (!workerPromise) {
    const workerUrl = new URL("../dist/server/index.js", import.meta.url);
    workerUrl.searchParams.set("homepage-accessibility", `${process.pid}-${Date.now()}`);
    workerPromise = import(workerUrl.href).then((module) => module.default);
  }
  return workerPromise;
}

async function render(pathname = "/") {
  const worker = await getWorker();
  return worker.fetch(
    new Request(`https://cloud.kai.com${pathname}`, {
      headers: { accept: "text/html", host: "cloud.kai.com" },
    }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

const homepageCategories = ["gpu", "token_model", "rack_capacity", "cloud_vendor"];

function selectedHomepageListings() {
  return homepageCategories.map((category) => {
    const listing = resourceListings.find((item) => item.category === category && item.featured);
    assert.ok(listing, `homepage needs one featured ${category} listing`);
    return listing;
  });
}

function scopeLabel(listing) {
  return [
    listing.quote.taxIncluded ? "含税" : "未含税",
    listing.quote.energyIncluded ? "含电费" : "未含电费",
    listing.quote.networkIncluded ? "含网络" : "未含网络",
  ].join(" · ");
}

test("homepage quote rows are traceable to the shared resource catalog", async () => {
  const response = await render("/");
  assert.equal(response.status, 200);
  const html = await response.text();
  const textHtml = html.replaceAll("<!-- -->", "");

  for (const listing of selectedHomepageListings()) {
    assert.match(html, new RegExp(`/resources/${listing.id}`));
    assert.match(html, new RegExp(`listing=${listing.id}`));
    assert.ok(textHtml.includes(listing.title));
    assert.ok(textHtml.includes(listing.region));
    assert.ok(textHtml.includes(listing.quote.currency));
    assert.ok(textHtml.includes(listing.pricingUnit));
    assert.ok(textHtml.includes(scopeLabel(listing)));
    assert.ok(textHtml.includes(`样本 ${listing.quote.sampleCount} 条`));
    assert.ok(html.includes(listing.quote.updatedAt));
    assert.ok(html.includes(listing.quote.validUntil));
    assert.ok(html.includes(`region=${encodeURIComponent(listing.region)}`));
  }
});

test("homepage has no independent hardcoded quote table", async () => {
  const [page, hero] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/live-home-market-hero.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(page, /resourceListings\.find\(/u);
  assert.doesNotMatch(page, /const quoteRows\s*=\s*\[/u);
  assert.doesNotMatch(page, /H20 \/ 96 GB|A800 \/ 80 GB|推理容量 \/ 1M TPM/u);
  assert.match(page, /gpuP50:\s*homepageGpuQuote\.quote\.median/u);
  assert.match(hero, /summary\.gpuP50/u);
  assert.doesNotMatch(hero, /12\.80|H20 卡时/u);
});

test("market controls, comparison targets, and theme selector meet target sizes", async () => {
  const [dashboard, explorer, globals, kaiCloud] = await Promise.all([
    readFile(new URL("../components/market-dashboard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/resource-explorer.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../app/kai-cloud.css", import.meta.url), "utf8"),
  ]);

  assert.match(dashboard, /min-h-11 min-w-14 cursor-pointer/u);
  assert.doesNotMatch(dashboard, /min-h-10/u);
  assert.match(explorer, /min-h-11 min-w-11 cursor-pointer/u);
  assert.doesNotMatch(explorer, /min-h-10/u);
  assert.match(globals, /\.theme-control select\s*\{[^}]*min-height:\s*44px;/su);
  assert.match(kaiCloud, /\.kai-root[^\n]* \.button\s*\{[^}]*min-height:\s*48px;/su);
  assert.match(kaiCloud, /\.table-action\s*\{[^}]*min-height:\s*44px;/su);
});

test("scoped market surfaces use release wording", async () => {
  const files = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/market-dashboard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/resource-explorer.tsx", import.meta.url), "utf8"),
  ]);
  const forbidden = ["\u6f14\u793a", "\u865a\u6784", "\u975e\u5b9e\u65f6\u6210\u4ea4\u4ef7"];
  for (const source of files) {
    for (const term of forbidden) assert.ok(!source.includes(term));
  }
});
