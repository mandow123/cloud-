import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";
import { resourceListings, serviceAliases } from "../lib/catalog.mjs";

let workerPromise;

async function getWorker() {
  if (!workerPromise) {
    const workerUrl = new URL("../dist/server/index.js", import.meta.url);
    workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
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

test("server-renders the finished KAI Cloud home page", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /KAI Cloud/);
  assert.match(html, /中国 Token 学院算力市场/);
  assert.match(html, /让异构算力/);
  assert.match(html, /发布算力需求/);
  assert.match(html, /演示数据环境/);
  assert.doesNotMatch(html, /codex-preview|Building your site|react-loading-skeleton/i);
});

test("all primary public and member routes render", async () => {
  const routes = [
    ["/market", /行情中心/],
    ["/resources", /资源市场/],
    ["/request", /发布.*需求|租赁.*置换/],
    ["/member", /会员中心|需求方|供应方/],
    ["/partners", /供应商合作/],
    ["/methodology", /数据方法|价格口径/],
  ];

  for (const [pathname, marker] of routes) {
    const response = await render(pathname);
    assert.equal(response.status, 200, `${pathname} should render`);
    assert.match(await response.text(), marker, `${pathname} should contain its product heading`);
  }
});

test("market surfaces clearly disclose demo pricing", async () => {
  for (const pathname of ["/market", "/resources"]) {
    const response = await render(pathname);
    const html = await response.text();
    assert.match(html, /演示参考价|演示数据/);
    assert.match(html, /非实时成交价/);
    assert.match(html, /更新|更新时间/);
  }
});

test("all ten business aliases are reachable from the home page", async () => {
  const response = await render("/");
  const html = await response.text();
  assert.equal(serviceAliases.length, 10);
  for (const alias of serviceAliases) {
    assert.match(html, new RegExp(alias.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("a dynamic resource detail exposes complete demo quote scope", async () => {
  const listing = resourceListings[0];
  const response = await render(`/resources/${listing.id}`);
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, new RegExp(listing.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(html, /演示参考价/);
  assert.match(html, /非实时成交价/);
  assert.match(html, /含税|税费/);
  assert.match(html, /有效期|更新/);
  assert.match(html, /发布需求|询价/);
});

test("starter artifacts are removed and brand assets are wired", async () => {
  const [page, layout, css, packageJson] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  await assert.rejects(access(new URL("../app/_sites-preview/SkeletonPreview.tsx", import.meta.url)));
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  assert.doesNotMatch(page, /SkeletonPreview|codex-preview/);
  assert.match(layout, /og\.png/);
  assert.match(layout, /zh-CN/);
  assert.match(css, /--brand:\s*#177777/i);
  assert.match(css, /--canvas:\s*#fbfdfd/i);
  assert.match(css, /--accent:\s*#69d1cb/i);
  await access(new URL("../public/og.png", import.meta.url));
});
