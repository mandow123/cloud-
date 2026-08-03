import assert from "node:assert/strict";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";

async function reservePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  return port;
}

async function startServer(dataDirectory) {
  const port = await reservePort();
  const logs = [];
  const child = spawn(process.execPath, ["dist/standalone/server.js"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      HOSTNAME: "127.0.0.1",
      PORT: String(port),
      KAI_DATA_DIR: dataDirectory,
      NODE_ENV: "production",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => logs.push(chunk.toString()));
  child.stderr.on("data", (chunk) => logs.push(chunk.toString()));

  const baseUrl = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Server exited early:\n${logs.join("")}`);
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return { baseUrl, child, logs };
    } catch {
      // The standalone server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  child.kill();
  throw new Error(`Server did not become healthy:\n${logs.join("")}`);
}

async function stopServer(server) {
  if (server.child.exitCode !== null) return;
  const exited = new Promise((resolve) => server.child.once("exit", resolve));
  server.child.kill();
  await Promise.race([
    exited,
    new Promise((_, reject) => setTimeout(() => reject(new Error("Server did not stop")), 5_000)),
  ]);
}

async function postJson(baseUrl, path, body, extraHeaders = {}) {
  return fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...extraHeaders },
    body: JSON.stringify(body),
  });
}

test("marketplace API closes the request, quote and persistence loop", async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "kai-marketplace-test-"));
  let server;
  try {
    await copyFile("data/model-market.snapshot.json", join(dataDirectory, "model-market.snapshot.json"));
    server = await startServer(dataDirectory);

    const marketResponse = await fetch(`${server.baseUrl}/api/market`);
    assert.equal(marketResponse.status, 200);
    const market = await marketResponse.json();
    assert.equal(market.source, "persistent");
    assert.ok(market.snapshot.quotes.length >= 30);
    const marketSummary = await (await fetch(`${server.baseUrl}/api/market?summary=1`)).json();
    assert.equal(marketSummary.source, "persistent");
    assert.equal(marketSummary.summary.quoteCount, market.snapshot.quotes.length);

    const requestResponse = await postJson(server.baseUrl, "/api/requests", {
      requestType: "procurement",
      dealMode: "rental",
      category: "gpu",
      pricingUnit: "卡时",
      quantity: 8,
      durationHours: 168,
      region: "北京",
      deliveryDate: "2026-08-10",
      requirements: "需要容器交付，明确电费、网络范围与 SLA。",
    });
    assert.equal(requestResponse.status, 201);
    const requestRecord = (await requestResponse.json()).record;
    assert.match(requestRecord.id, /^KAI-R-\d{8}-[A-F0-9]{8}$/);
    assert.equal(requestRecord.status, "已记录");

    const swapResponse = await postJson(server.baseUrl, "/api/requests", {
      requestType: "swap",
      offered: {
        category: "gpu",
        pricingUnit: "卡时",
        quantity: 100,
        description: "可提供华北 GPU 卡时资源与容器环境。",
      },
      wanted: {
        category: "token_model",
        pricingUnit: "百万 Token",
        quantity: 500,
        description: "需要主流推理模型的标准调用额度。",
      },
      region: "全国",
      cashDirection: "offer",
      cashAmount: 10_000,
    });
    assert.equal(swapResponse.status, 201);
    assert.match((await swapResponse.json()).record.id, /^KAI-X-/);

    const quoteResponse = await postJson(server.baseUrl, "/api/quotes", {
      demandId: requestRecord.id,
      unitPrice: 31.2,
      leadTime: "48 小时",
      validDays: 7,
      scopeNote: "演示报价：含税含电，公网流量另计。",
    });
    assert.equal(quoteResponse.status, 201);
    const quoteRecord = (await quoteResponse.json()).record;
    assert.equal(quoteRecord.demandId, requestRecord.id);
    assert.equal(quoteRecord.pricingUnit, "卡时");

    const draftResponse = await postJson(server.baseUrl, "/api/drafts", {
      title: "华北 H100 资源草稿",
      category: "gpu",
      capacity: "8 卡 H100，可按服务器时或卡时交付。",
    });
    assert.equal(draftResponse.status, 201);

    const invalidResponse = await postJson(server.baseUrl, "/api/requests", {
      requestType: "procurement",
      dealMode: "rental",
      category: "gpu",
      pricingUnit: "百万 Token",
      quantity: 1,
      durationHours: 1,
      region: "北京",
      deliveryDate: "2026-08-10",
      requirements: "单位应当被服务端拒绝。",
    });
    assert.equal(invalidResponse.status, 400);
    assert.equal((await invalidResponse.json()).error.code, "VALIDATION_ERROR");

    const crossOriginResponse = await postJson(
      server.baseUrl,
      "/api/drafts",
      { title: "跨站草稿", category: "gpu", capacity: "这条内容不应被保存到数据库中。" },
      { origin: "https://attacker.invalid" },
    );
    assert.equal(crossOriginResponse.status, 400);

    const requestsBeforeRestart = await (await fetch(`${server.baseUrl}/api/requests`)).json();
    assert.equal(requestsBeforeRestart.count, 2);
    assert.equal(
      requestsBeforeRestart.items.find((item) => item.id === requestRecord.id).status,
      "报价已收到",
    );

    await stopServer(server);
    server = await startServer(dataDirectory);

    const [health, requests, quotes, drafts] = await Promise.all([
      fetch(`${server.baseUrl}/api/health`).then((response) => response.json()),
      fetch(`${server.baseUrl}/api/requests`).then((response) => response.json()),
      fetch(`${server.baseUrl}/api/quotes`).then((response) => response.json()),
      fetch(`${server.baseUrl}/api/drafts`).then((response) => response.json()),
    ]);
    assert.equal(health.status, "ok");
    assert.equal(health.backend, "sqlite");
    assert.equal(requests.count, 2);
    assert.equal(quotes.count, 1);
    assert.equal(drafts.count, 1);
  } finally {
    if (server) await stopServer(server);
    await rm(dataDirectory, { recursive: true, force: true });
  }
});
