import assert from "node:assert/strict";
import test from "node:test";

let workerPromise;

async function render(pathname) {
  if (!workerPromise) {
    const workerUrl = new URL("../dist/server/index.js", import.meta.url);
    workerUrl.searchParams.set("model-market-test", `${process.pid}-${Date.now()}`);
    workerPromise = import(workerUrl.href).then((module) => module.default);
  }
  const worker = await workerPromise;
  return worker.fetch(
    new Request(`https://cloud.kai.com${pathname}`, {
      headers: { accept: "text/html", host: "cloud.kai.com" },
    }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

function decodeHtml(value) {
  return value
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", "\"")
    .replaceAll("&#x27;", "'");
}

test("model rows render service and context tiers with unique accessible names", async () => {
  const response = await render("/market");
  assert.equal(response.status, 200);
  const html = await response.text();
  const labels = [...html.matchAll(/aria-label="([^"]+)"/gu)]
    .map((match) => decodeHtml(match[1]))
    .filter((label) => label.includes("qwen3.7-plus-2026-05-26"));

  assert.equal(labels.length, 4, "both desktop and mobile render both context tiers");
  assert.equal(new Set(labels).size, 2, "the two repeated model rows have distinct accessible names");
  assert.ok(labels.every((label) => label.includes("服务档") && label.includes("上下文")));
  assert.ok(labels.some((label) => label.includes("<=256K")));
  assert.ok(labels.some((label) => label.includes("256K-1M")));
});

test("insufficient model index history renders accumulation and unavailable states", async () => {
  const [homeResponse, marketResponse] = await Promise.all([render("/"), render("/market")]);
  assert.equal(homeResponse.status, 200);
  assert.equal(marketResponse.status, 200);

  const home = await homeResponse.text();
  const market = await marketResponse.text();
  assert.match(home, /样本积累中/);
  assert.match(home, /1 日 暂无/);
  assert.match(home, /7 日 暂无/);
  assert.match(home, /30 日 暂无/);
  assert.match(market, /历史样本积累中，暂无完整 30 日变化/);
});
