import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

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

test("homepage activity cards expose six keyboard-reachable detail links", async () => {
  const response = await render("/");
  assert.equal(response.status, 200);
  const html = await response.text();
  const slugs = ["neon-city", "sound-shape", "tiny-world", "open-lab", "character-relay", "memory-restore"];
  for (const slug of slugs) {
    assert.match(html, new RegExp(`href=["']\\/activity\\/${slug}["']`));
  }
  assert.match(html, /aria-label="筛选活动"/u);
  assert.match(html, /aria-label="活动快捷导航"/u);
  assert.match(html, /aria-label="移动端活动导航"/u);
});

test("homepage is a thin route backed by the shared six-item activity catalog", async () => {
  const [page, hub, catalog] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/activity-hub.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/activity-catalog.ts", import.meta.url), "utf8"),
  ]);
  assert.match(page, /<ActivityHub \/>/u);
  assert.doesNotMatch(page, /LiveHomeMarketHero|resourceListings|readMarketSnapshot/u);
  assert.match(hub, /activityCatalog\.filter/u);
  assert.match(hub, /href=\{`\/activity\/\$\{item\.slug\}`\}/u);
  assert.equal((catalog.match(/\bid:\s*"act_/gu) ?? []).length, 6);
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

test("the activity homepage does not alter the approved member and resource presentation", async () => {
  const [home, workspace, explorer] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/member-workspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/resource-explorer.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(home, /ActivityHub/u);
  assert.doesNotMatch(home, /resourceListings|marketSeries|readMarketSnapshot/u);
  assert.match(workspace, /<th scope="col">需求<\/th><th scope="col">类别<\/th><th scope="col">区域<\/th><th scope="col">数量<\/th><th scope="col">状态<\/th>/u);
  for (const term of ["本页最近更新", "上次检查", "立即刷新", "当前响应：", "连续时间 / 期望开始日"]) {
    assert.ok(!workspace.includes(term));
  }
  for (const term of ["页面每 5 分钟", "报价有效至", "参考报价已过期", "算力资源为带独立更新时间的参考目录"]) {
    assert.ok(!explorer.includes(term));
  }
  assert.match(explorer, /目录资源池/u);
  assert.match(explorer, /平台初始化样本，供应商接入后核验更新/u);
});
