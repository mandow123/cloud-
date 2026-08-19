import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";
import { resourceListings } from "../lib/catalog.mjs";

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

test("server-renders the activity plaza at the root route", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /KAI CREATOR/);
  assert.match(html, /创作挑战/);
  assert.match(html, /六大主题赛道/);
  assert.match(html, /霓虹城市重构计划/);
  assert.match(html, /老照片会说话/);
  assert.match(html, /href="\/market"/u);
  assert.match(html, /<title>创作挑战与活动广场｜KAI Cloud<\/title>/u);
  assert.match(html, /<meta property="og:title" content="KAI Creator｜AI 创作挑战与活动广场"\/>/u);
  assert.match(html, /<meta property="og:site_name" content="KAI Creator"\/>/u);
  assert.match(html, /<meta name="twitter:title" content="KAI Creator｜AI 创作挑战与活动广场"\/>/u);
  assert.doesNotMatch(html, /<meta (?:property="og:image|name="twitter:image)/u);
  assert.doesNotMatch(html, /先看清价格，\s*再发布算力需求/u);
  assert.doesNotMatch(html, /codex-preview|Building your site|react-loading-skeleton/i);
});

test("login offers a working ChatGPT identity path and hides unavailable email controls", async () => {
  const response = await render("/login?returnTo=%2Factivity%23community");
  assert.equal(response.status, 200);

  const html = await response.text();
  assert.match(html, /登录创作者账户/u);
  assert.match(html, /使用 ChatGPT 账户登录/u);
  assert.match(html, /href="\/signin-with-chatgpt\?return_to=%2Factivity%23community"/u);
  assert.match(html, /企业邮箱登录暂未开放/u);
  assert.doesNotMatch(html, /邮箱验证码服务未配置/u);
  assert.doesNotMatch(html, /发送邮箱验证码/u);
});

test("security headers cover the root page, nested pages, and APIs", async () => {
  for (const pathname of ["/", "/activity/neon-city", "/market", "/api/live"]) {
    const response = await render(pathname);
    assert.equal(response.status, 200, `${pathname} should render`);
    assert.match(response.headers.get("content-security-policy") ?? "", /frame-ancestors 'none'/u);
    assert.doesNotMatch(response.headers.get("content-security-policy") ?? "", /fonts\.(?:googleapis|gstatic)\.com/u);
    assert.equal(response.headers.get("cross-origin-opener-policy"), "same-origin");
    assert.equal(response.headers.get("cross-origin-resource-policy"), "same-origin");
    assert.match(response.headers.get("permissions-policy") ?? "", /payment=\(\)/u);
    assert.ok(response.headers.get("referrer-policy"), `${pathname} should set a referrer policy`);
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.equal(response.headers.get("x-frame-options"), "DENY");
  }
});

test("production typography is self-hosted without build-machine font URLs", async () => {
  const response = await render("/");
  const html = await response.text();
  const fontCss = await readFile(new URL("../app/fonts.css", import.meta.url), "utf8");

  assert.doesNotMatch(html, /data-vinext-fonts|\.vinext[\\/]fonts|fonts\.(?:googleapis|gstatic)\.com/iu);
  assert.doesNotMatch(html, /(?:^|[\s("'=])[A-Za-z]:[\\/]/u);
  assert.match(fontCss, /font-family:\s*'DM Sans'/u);
  assert.match(fontCss, /font-family:\s*'Work Sans'/u);
  assert.match(fontCss, /font-family:\s*'Noto Sans SC'/u);
  assert.match(fontCss, /url\('\/assets\/fonts\/noto-sans-sc\/[^']+\.woff2'\)/u);
  assert.doesNotMatch(fontCss, /\.vinext[\\/]fonts|fonts\.(?:googleapis|gstatic)\.com/iu);
  assert.doesNotMatch(fontCss, /(?:^|[\s("'=])[A-Za-z]:[\\/]/u);

  await Promise.all([
    access(new URL("../public/assets/fonts/dm-sans/dm-sans-151a53ae.woff2", import.meta.url)),
    access(new URL("../public/assets/fonts/work-sans/work-sans-d745e173.woff2", import.meta.url)),
    access(new URL("../public/assets/fonts/noto-sans-sc/noto-sans-sc-89709021.woff2", import.meta.url)),
    access(new URL("../dist/standalone/dist/client/assets/fonts/dm-sans/dm-sans-151a53ae.woff2", import.meta.url)),
    access(new URL("../dist/standalone/dist/client/assets/fonts/work-sans/work-sans-d745e173.woff2", import.meta.url)),
    access(new URL("../dist/standalone/dist/client/assets/fonts/noto-sans-sc/noto-sans-sc-89709021.woff2", import.meta.url)),
    access(new URL("../public/assets/fonts/dm-sans/OFL.txt", import.meta.url)),
    access(new URL("../public/assets/fonts/work-sans/OFL.txt", import.meta.url)),
    access(new URL("../public/assets/fonts/noto-sans-sc/OFL.txt", import.meta.url)),
  ]);
});

test("all primary public and member routes render", async () => {
  const routes = [
    ["/", /创作挑战/],
    ["/activity", /创作挑战/],
    ["/activity/neon-city", /霓虹城市重构计划/],
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

test("primary routes never render demonstration wording", async () => {
  const routes = [
    "/",
    "/market",
    "/resources",
    `/resources/${resourceListings[0].id}`,
    "/request",
    "/member",
    "/partners",
    "/methodology",
  ];

  for (const pathname of routes) {
    const response = await render(pathname);
    assert.equal(response.status, 200, `${pathname} should render`);
    const html = await response.text();
    assert.doesNotMatch(html, /演示|虚构|非实时成交价|模拟/u, `${pathname} contains retired demonstration wording`);
    assert.doesNotMatch(
      html,
      /(?:\\?"(?:demo|fictional)\\?"\s*:\s*true|supplierId\\?"\s*:\s*\\?"demo-)/iu,
      `${pathname} serializes retired initialization flags`,
    );
  }
});

test("market surfaces disclose reference pricing and inquiry confirmation", async () => {
  for (const pathname of ["/market", "/resources"]) {
    const response = await render(pathname);
    const html = await response.text();
    assert.match(html, /市场参考报价|市场参考/);
    assert.match(html, /询价确认/);
    assert.match(html, /更新|更新时间/);
  }
});

test("model market renders per-model prices, source status, and the 06:00 update contract", async () => {
  const response = await render("/market");
  const html = await response.text();

  assert.match(html, /主流模型 Token 分项行情/);
  assert.match(html, /每日 06:00/);
  assert.match(html, /不是跨模型人民币均价/);
  assert.match(html, /DeepSeek/);
  assert.match(html, /OpenAI/);
  assert.match(html, /Moonshot \/ Kimi/);
  assert.match(html, /Google/);
  assert.doesNotMatch(html, /模型 Token 综合行情/);
});

test("all six activity cards link from the root plaza to their detail routes", async () => {
  const response = await render("/");
  const html = await response.text();
  const slugs = ["neon-city", "sound-shape", "tiny-world", "open-lab", "character-relay", "memory-restore"];
  for (const slug of slugs) {
    assert.match(html, new RegExp(`href=["']\\/activity\\/${slug}["']`));
  }
});

test("activity detail metadata comes from the visible activity and clears inherited images", async () => {
  const response = await render("/activity/neon-city");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /<title>霓虹城市重构计划｜KAI Cloud<\/title>/u);
  assert.match(html, /<meta property="og:title" content="霓虹城市重构计划"\/>/u);
  assert.match(html, /<meta name="twitter:title" content="霓虹城市重构计划"\/>/u);
  assert.match(html, /选择一处真实地标/u);
  assert.doesNotMatch(html, /<meta (?:property="og:image|name="twitter:image)/u);
  assert.doesNotMatch(html, /\/og\.png/u);
});

test("the market route retains the existing model and infrastructure pricing product", async () => {
  const response = await render("/market");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /行情中心/);
  assert.match(html, /主流模型 Token 分项行情/);
  assert.match(html, /每日 06:00/);
  assert.match(html, /GPU|算力/u);
});

test("a dynamic resource detail exposes complete reference quote scope", async () => {
  const listing = resourceListings[0];
  const response = await render(`/resources/${listing.id}`);
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, new RegExp(listing.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(html, /市场参考报价/);
  assert.match(html, /询价确认/);
  assert.match(html, /含税|税费/);
  assert.match(html, /有效期|更新/);
  assert.match(html, /发布需求|询价/);
});

test("resources expose the approved purchase action and a clearly priced purchase page", async () => {
  const listing = resourceListings[0];
  const resourcesResponse = await render("/resources");
  assert.equal(resourcesResponse.status, 200);
  const resourcesHtml = await resourcesResponse.text();
  assert.match(resourcesHtml, new RegExp(`/checkout/${listing.id}`));
  assert.match(resourcesHtml, /购买/);

  const checkoutResponse = await render(`/checkout/${listing.id}`);
  assert.equal(checkoutResponse.status, 200);
  const checkoutHtml = await checkoutResponse.text();
  assert.match(checkoutHtml, /购买/);
  assert.match(checkoutHtml, /市场参考单价/);
  assert.match(checkoutHtml, /预计金额/);
  assert.match(checkoutHtml, new RegExp(String(listing.quote.median)));
  assert.match(checkoutHtml, /平台确认库存与正式价格/);
});

test("starter artifacts are removed and activity metadata is wired without a stale social image", async () => {
  const [page, layout, css, packageJson] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  await assert.rejects(access(new URL("../app/_sites-preview/SkeletonPreview.tsx", import.meta.url)));
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  assert.doesNotMatch(page, /SkeletonPreview|codex-preview/);
  assert.match(layout, /KAI Creator｜AI 创作挑战与活动广场/u);
  assert.match(layout, /参加原创 AI 创作挑战/u);
  assert.match(layout, /siteName:\s*"KAI Creator"/u);
  assert.match(layout, /twitter:\s*\{[\s\S]*card:\s*"summary_large_image"/u);
  assert.doesNotMatch(layout, /og\.png|images:\s*\[/u);
  assert.doesNotMatch(layout, /中国 Token 学院算力市场|算力行情与资源撮合/u);
  assert.match(layout, /zh-CN/);
  assert.match(css, /--brand:\s*#177777/i);
  assert.match(css, /--canvas:\s*#fbfdfd/i);
  assert.match(css, /--accent:\s*#69d1cb/i);
});
