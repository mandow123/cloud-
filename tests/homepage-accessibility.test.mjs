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
    assert.ok(textHtml.includes("历史初始化样本"));
    assert.ok(textHtml.includes("报价已过期"));
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
  assert.doesNotMatch(page, /gpuP50|homepageGpuQuote/u);
  assert.doesNotMatch(hero, /summary\.gpuP50|人民币|¥|1\.002/u);
  assert.match(hero, /href="\/gpu"/u);
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

test("navigation popovers and GPU lab surfaces share the active color mode", async () => {
  const [globals, lab] = await Promise.all([
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../components/gpu-cloud-lab.module.css", import.meta.url), "utf8"),
  ]);

  assert.match(globals, /\.nav-popover-links\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\);/su);
  assert.match(globals, /\.theme-control select\s*\{[^}]*appearance:\s*none;[^}]*background:\s*var\(--surface\);/su);
  assert.match(globals, /--surface-muted:\s*#f3f7f7;/u);
  assert.match(lab, /--lab-bg:\s*var\(--canvas\);/u);
  assert.match(lab, /--lab-panel:\s*var\(--surface\);/u);
  assert.match(lab, /:global\(html\[data-color-mode="dark"\]\) \.hostingApp/u);
  assert.doesNotMatch(lab, /--lab-bg:\s*#071113/u);
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

test("supplier demand data does not turn historical references into inventory", async () => {
  const [home, workspace, explorer] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/member-workspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/resource-explorer.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(home, /24 条初始化样本报价均已过期，不代表现货、库存或可成交报价/u);
  assert.match(workspace, /<th scope="col">需求<\/th><th scope="col">类别<\/th><th scope="col">区域<\/th><th scope="col">数量<\/th><th scope="col">状态<\/th>/u);
  for (const term of ["本页最近更新", "上次检查", "立即刷新", "当前响应：", "连续时间 / 期望开始日"]) {
    assert.ok(!workspace.includes(term));
  }
  for (const term of ["页面每 5 分钟", "当前可用库存", "即时购买"]) {
    assert.ok(!explorer.includes(term));
  }
  assert.match(explorer, /目录参考方案/u);
  assert.match(explorer, /历史初始化样本/u);
  assert.match(explorer, /报价已过期/u);
});
