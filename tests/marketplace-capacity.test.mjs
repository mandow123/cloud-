import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { resolveMarketplaceCapacityLimits } from "../lib/server/marketplace-capacity.ts";

function futureDate(days = 14) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function idempotencyKey(label) {
  return `${label}-${randomUUID()}`;
}

function requestPayload(index) {
  return {
    requestType: "procurement",
    dealMode: "rental",
    category: "gpu",
    pricingUnit: "卡时",
    quantity: index + 1,
    durationHours: 168,
    region: "北京",
    deliveryDate: futureDate(),
    requirements: `第 ${index + 1} 条容量边界测试需求，包含容器交付与 SLA。`,
  };
}

function quotePayload(demandId, unitPrice) {
  return {
    demandId,
    unitPrice,
    leadTime: "48 小时内",
    validDays: 7,
    scopeNote: "人民币含税并包含基础网络与服务保障。",
  };
}

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

async function startServer(dataDirectory, capacity) {
  const port = await reservePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const logs = [];
  const child = spawn(process.execPath, ["dist/standalone/server.js"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      HOSTNAME: "127.0.0.1",
      PORT: String(port),
      KAI_DATA_DIR: dataDirectory,
      KAI_PUBLIC_ORIGIN: baseUrl,
      KAI_REQUIRE_HTTPS_WRITES: "0",
      KAI_TRUST_PLATFORM_HEADERS: "0",
      KAI_RELEASE_SHA: "marketplace-capacity-test",
      KAI_CURSOR_SECRET: "marketplace-capacity-test-cursor-93f15d57e1c3f8a04daf35b8",
      KAI_MAX_MARKETPLACE_SESSIONS: String(capacity.sessions),
      KAI_MAX_MARKETPLACE_REQUESTS: String(capacity.requests),
      KAI_MAX_MARKETPLACE_QUOTES: String(capacity.quotes),
      KAI_MAX_MARKETPLACE_DRAFTS: String(capacity.drafts),
      KAI_MAX_QUOTES_PER_DEMAND: String(capacity.quotesPerDemand),
      NODE_ENV: "production",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => logs.push(chunk.toString()));
  child.stderr.on("data", (chunk) => logs.push(chunk.toString()));

  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Server exited early:\n${logs.join("")}`);
    try {
      const response = await fetch(`${baseUrl}/api/live`);
      if (response.ok) return { baseUrl, child, logs };
    } catch {
      // The standalone server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  child.kill();
  throw new Error(`Server did not become ready:\n${logs.join("")}`);
}

async function stopServer(server) {
  if (!server || server.child.exitCode !== null || server.child.signalCode !== null) return;
  const exited = new Promise((resolve) => server.child.once("exit", resolve));
  server.child.kill("SIGKILL");
  await Promise.race([
    exited,
    new Promise((_, reject) => setTimeout(() => reject(new Error("Server did not stop")), 5_000)),
  ]);
}

async function createFixture(capacity) {
  const dataDirectory = await mkdtemp(join(tmpdir(), "kai-marketplace-capacity-"));
  const snapshot = JSON.parse(await readFile("data/model-market.snapshot.json", "utf8"));
  snapshot.publishedAt = new Date().toISOString();
  await writeFile(join(dataDirectory, "model-market.snapshot.json"), `${JSON.stringify(snapshot)}\n`, "utf8");
  const server = await startServer(dataDirectory, capacity);
  return { dataDirectory, server };
}

async function openClient(baseUrl) {
  const response = await fetch(`${baseUrl}/api/session`);
  assert.equal(response.status, 200);
  const cookie = response.headers.get("set-cookie")?.split(";", 1)[0];
  assert.ok(cookie);
  const body = await response.json();
  assert.match(body.session.csrfToken, /^[a-f0-9]{64}$/u);
  return {
    async post(path, payload, key = idempotencyKey("write")) {
      return fetch(`${baseUrl}${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie,
          origin: baseUrl,
          "x-kai-csrf": body.session.csrfToken,
          "idempotency-key": key,
        },
        body: JSON.stringify(payload),
      });
    },
  };
}

async function expectError(response, status, code, retryAfter) {
  assert.equal(response.status, status);
  assert.equal(response.headers.get("retry-after"), String(retryAfter));
  const body = await response.json();
  assert.equal(body.error?.code, code);
  assert.match(body.error?.requestId ?? "", /^[0-9a-f-]{36}$/u);
}

test("capacity configuration is bounded and fails closed", () => {
  const defaults = resolveMarketplaceCapacityLimits({});
  assert.deepEqual(defaults, {
    sessions: 50_000,
    requests: 10_000,
    quotes: 50_000,
    drafts: 20_000,
    quotesPerDemand: 25,
  });
  assert.equal(resolveMarketplaceCapacityLimits({ KAI_MAX_MARKETPLACE_REQUESTS: "7" }).requests, 7);
  assert.throws(
    () => resolveMarketplaceCapacityLimits({ KAI_MAX_MARKETPLACE_REQUESTS: "0" }),
    /MARKETPLACE_CAPACITY_INVALID:KAI_MAX_MARKETPLACE_REQUESTS/u,
  );
  assert.throws(
    () => resolveMarketplaceCapacityLimits({ KAI_MAX_MARKETPLACE_QUOTES: "250001" }),
    /MARKETPLACE_CAPACITY_INVALID:KAI_MAX_MARKETPLACE_QUOTES/u,
  );
  assert.throws(
    () => resolveMarketplaceCapacityLimits({
      KAI_MAX_MARKETPLACE_QUOTES: "2",
      KAI_MAX_QUOTES_PER_DEMAND: "3",
    }),
    /MARKETPLACE_CAPACITY_INVALID:KAI_MAX_QUOTES_PER_DEMAND/u,
  );
});

test("SQLite enforces global record and per-demand quote caps without breaking replay", async () => {
  const fixture = await createFixture({ sessions: 10, requests: 3, quotes: 2, drafts: 1, quotesPerDemand: 1 });
  try {
    const buyer = await openClient(fixture.server.baseUrl);
    const requestKeys = [idempotencyKey("request-1"), idempotencyKey("request-2"), idempotencyKey("request-3")];
    const demandIds = [];
    for (let index = 0; index < 3; index += 1) {
      const response = await buyer.post("/api/requests", requestPayload(index), requestKeys[index]);
      assert.equal(response.status, 201);
      demandIds.push((await response.json()).record.id);
    }

    const replay = await buyer.post("/api/requests", requestPayload(0), requestKeys[0]);
    assert.equal(replay.status, 200);
    assert.equal(replay.headers.get("idempotency-replayed"), "true");

    const extraBuyer = await openClient(fixture.server.baseUrl);
    await expectError(
      await extraBuyer.post("/api/requests", requestPayload(8)),
      503,
      "MARKETPLACE_CAPACITY_REACHED",
      900,
    );

    const supplierOne = await openClient(fixture.server.baseUrl);
    const firstQuoteKey = idempotencyKey("quote-1");
    const firstQuote = await supplierOne.post("/api/quotes", quotePayload(demandIds[0], 18.5), firstQuoteKey);
    assert.equal(firstQuote.status, 201);

    const supplierTwo = await openClient(fixture.server.baseUrl);
    await expectError(
      await supplierTwo.post("/api/quotes", quotePayload(demandIds[0], 18.1)),
      429,
      "DEMAND_QUOTE_LIMIT_REACHED",
      86_400,
    );
    const secondQuote = await supplierTwo.post("/api/quotes", quotePayload(demandIds[1], 20.1));
    assert.equal(secondQuote.status, 201);

    const supplierThree = await openClient(fixture.server.baseUrl);
    await expectError(
      await supplierThree.post("/api/quotes", quotePayload(demandIds[2], 19.9)),
      503,
      "MARKETPLACE_CAPACITY_REACHED",
      900,
    );

    const quoteReplay = await supplierOne.post("/api/quotes", quotePayload(demandIds[0], 18.5), firstQuoteKey);
    assert.equal(quoteReplay.status, 200);
    assert.equal(quoteReplay.headers.get("idempotency-replayed"), "true");

    const draft = await supplierOne.post("/api/drafts", {
      title: "华北 H100 资源",
      category: "gpu",
      capacity: "八卡服务器，可按卡时或服务器时交付。",
    });
    assert.equal(draft.status, 201);
    await expectError(
      await supplierTwo.post("/api/drafts", {
        title: "华东 H100 资源",
        category: "gpu",
        capacity: "十六卡服务器，可按服务器时交付。",
      }),
      503,
      "MARKETPLACE_CAPACITY_REACHED",
      900,
    );
  } finally {
    await stopServer(fixture.server);
  }

  const database = new DatabaseSync(join(fixture.dataDirectory, "kai-cloud.sqlite"), { readOnly: true });
  try {
    const count = (table) => database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count;
    const userRequestCount = database.prepare("SELECT COUNT(*) AS count FROM marketplace_requests_v2 WHERE owner_actor_id <> 'system:kai-market'").get().count;
    assert.equal(userRequestCount, 3);
    assert.equal(count("marketplace_quotes_v2"), 2);
    assert.equal(count("marketplace_drafts_v2"), 1);
    assert.equal(count("marketplace_events_v2"), 8);
    assert.ok(count("marketplace_sessions_v2") <= 10);
  } finally {
    database.close();
    await rm(fixture.dataDirectory, { recursive: true, force: true });
  }
});

test("SQLite session ceiling blocks fresh-cookie rotation before records grow", async () => {
  const fixture = await createFixture({ sessions: 1, requests: 5, quotes: 5, drafts: 5, quotesPerDemand: 2 });
  try {
    const first = await openClient(fixture.server.baseUrl);
    assert.equal((await first.post("/api/requests", requestPayload(0))).status, 201);

    const rotated = await openClient(fixture.server.baseUrl);
    await expectError(
      await rotated.post("/api/requests", requestPayload(1)),
      503,
      "MARKETPLACE_CAPACITY_REACHED",
      900,
    );
  } finally {
    await stopServer(fixture.server);
  }

  const database = new DatabaseSync(join(fixture.dataDirectory, "kai-cloud.sqlite"), { readOnly: true });
  try {
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM marketplace_sessions_v2").get().count, 1);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM marketplace_requests_v2 WHERE owner_actor_id <> 'system:kai-market'").get().count, 1);
  } finally {
    database.close();
    await rm(fixture.dataDirectory, { recursive: true, force: true });
  }
});
