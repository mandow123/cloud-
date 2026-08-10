import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { marketplaceSchemaStatements } from "../db/schema.ts";
import { resourceListings } from "../lib/catalog.mjs";
import { curatedMarketDemands } from "../lib/server/curated-market-demands.ts";

const SESSION_COOKIE_PATTERN = /^kai_session_dev=[a-f0-9]{64}$/u;

function futureDate(days = 14) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function idempotencyKey(label) {
  return `${label}-${randomUUID()}`;
}

function procurementPayload(overrides = {}) {
  return {
    requestType: "procurement",
    dealMode: "rental",
    category: "gpu",
    pricingUnit: "卡时",
    quantity: 8,
    durationHours: 168,
    region: "北京",
    deliveryDate: futureDate(),
    requirements: "容器交付需求：明确电费、网络范围与 SLA。",
    ...overrides,
  };
}

function draftPayload(index = 0) {
  return {
    title: `华北 H100 资源草稿 ${index}`,
    category: "gpu",
    capacity: `第 ${index} 条容量说明：8 卡 H100，可按服务器时或卡时交付。`,
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

async function startServer(dataDirectory, envOverrides = {}) {
  const port = await reservePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const logs = [];
  const child = spawn(process.execPath, ["dist/standalone/server.js"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      HOSTNAME: "127.0.0.1",
      PORT: String(port),
      KAI_DATA_DIR: dataDirectory,
      KAI_PUBLIC_ORIGIN: baseUrl,
      KAI_REQUIRE_HTTPS_WRITES: "0",
      KAI_TRUST_PLATFORM_HEADERS: "0",
      KAI_RELEASE_SHA: "marketplace-api-test",
      KAI_CURSOR_SECRET: "marketplace-api-test-cursor-4f2db9a37c6e81f50a7d3b96",
      NODE_ENV: "production",
      ...envOverrides,
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

async function writeFreshMarketSnapshot(dataDirectory) {
  const snapshot = JSON.parse(await readFile("data/model-market.snapshot.json", "utf8"));
  snapshot.publishedAt = new Date().toISOString();
  await writeFile(join(dataDirectory, "model-market.snapshot.json"), `${JSON.stringify(snapshot)}\n`, "utf8");
}

async function createFixture() {
  const dataDirectory = await mkdtemp(join(tmpdir(), "kai-marketplace-test-"));
  await writeFreshMarketSnapshot(dataDirectory);
  const server = await startServer(dataDirectory);
  return { dataDirectory, server };
}

async function destroyFixture(fixture) {
  await stopServer(fixture.server);
  await rm(fixture.dataDirectory, { recursive: true, force: true });
}

async function errorBody(response, status, code) {
  assert.equal(response.status, status);
  const body = await response.json();
  assert.equal(body.error?.code, code);
  assert.match(body.error?.requestId ?? "", /^[0-9a-f-]{36}$/u);
  assert.equal(response.headers.get("x-request-id"), body.error.requestId);
  return body;
}

class MarketplaceClient {
  constructor(baseUrl, cookie, csrfToken, session) {
    this.baseUrl = baseUrl;
    this.cookie = cookie;
    this.csrfToken = csrfToken;
    this.session = session;
  }

  moveTo(baseUrl) {
    this.baseUrl = baseUrl;
  }

  async refreshSession() {
    const response = await fetch(`${this.baseUrl}/api/session`, {
      headers: { cookie: this.cookie },
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    this.csrfToken = body.session.csrfToken;
    this.session = body.session;
    return body.session;
  }

  get(path, headers = {}) {
    return fetch(`${this.baseUrl}${path}`, {
      headers: { cookie: this.cookie, ...headers },
    });
  }

  postJson(path, body, options = {}) {
    const headers = new Headers(options.headers);
    headers.set("content-type", "application/json");
    if (options.cookie !== null) headers.set("cookie", options.cookie ?? this.cookie);
    if (options.origin !== null) headers.set("origin", options.origin ?? this.baseUrl);
    if (options.csrf !== null) headers.set("x-kai-csrf", options.csrf ?? this.csrfToken);
    if (options.idempotencyKey !== null) {
      headers.set("idempotency-key", options.idempotencyKey ?? idempotencyKey("write"));
    }
    return fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
  }

  postStream(path, serializedBody, options = {}) {
    const headers = new Headers(options.headers);
    headers.set("content-type", "application/json");
    headers.set("cookie", this.cookie);
    headers.set("origin", this.baseUrl);
    headers.set("x-kai-csrf", this.csrfToken);
    headers.set("idempotency-key", options.idempotencyKey ?? idempotencyKey("stream"));

    const bytes = new TextEncoder().encode(serializedBody);
    const chunkSize = 8 * 1024;
    let offset = 0;
    const body = new ReadableStream({
      pull(controller) {
        if (offset >= bytes.byteLength) {
          controller.close();
          return;
        }
        const end = Math.min(bytes.byteLength, offset + chunkSize);
        controller.enqueue(bytes.slice(offset, end));
        offset = end;
      },
    });

    return fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers,
      body,
      duplex: "half",
    });
  }
}

async function openSession(baseUrl, headers = {}) {
  const response = await fetch(`${baseUrl}/api/session`, { headers });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("x-request-id") ?? "", /^[0-9a-f-]{36}$/u);
  const setCookie = response.headers.get("set-cookie");
  assert.ok(setCookie, "a new anonymous session must set a cookie");
  const cookie = setCookie.split(";", 1)[0];
  const body = await response.json();
  assert.match(body.session.csrfToken, /^[a-f0-9]{64}$/u);
  assert.equal(body.session.retentionDays, 30);
  assert.ok(Date.parse(body.session.expiresAt) > Date.now());
  return new MarketplaceClient(baseUrl, cookie, body.session.csrfToken, body.session);
}

test("fresh marketplace publishes five server-side KAI procurement calls that suppliers can quote", async () => {
  const fixture = await createFixture();
  try {
    const supplier = await openSession(fixture.server.baseUrl);
    const outsider = await openSession(fixture.server.baseUrl);
    const response = await supplier.get("/api/requests?view=market&limit=20");
    assert.equal(response.status, 200);
    const market = await response.json();
    const expectedIds = new Set(curatedMarketDemands().map((demand) => demand.id));
    const curated = market.items.filter((item) => expectedIds.has(item.id));

    assert.equal(curated.length, 5);
    assert.equal(new Set(curated.map((item) => item.id)).size, 5);
    assert.ok(new Set(curated.map((item) => item.category)).size >= 3);
    assert.equal(market.source, "KAI Cloud 匿名需求池（服务端）");
    assert.equal(market.refreshAfterSeconds, 60);
    assert.match(market.refreshPolicy, /每周一 06:10.*系统滚动生成/u);
    assert.ok(Date.parse(market.updatedAt) > 0);
    assert.ok(Date.parse(market.servedAt) > 0);

    const serialized = JSON.stringify(market);
    assert.doesNotMatch(serialized, /owner_actor_id|ownerActorId|idempotency|payloadHash|companyName|contactName|contactMethod|@|1[3-9]\d{9}/iu);
    assert.doesNotMatch(serialized, /演示|模拟|虚构|非实时成交价|现金投资|现金取出|保本理财|申购|赎回/u);

    for (const [index, demand] of curated.slice(0, 3).entries()) {
      const quoteResponse = await supplier.postJson("/api/quotes", {
        demandId: demand.id,
        unitPrice: 18.5 + index,
        leadTime: "48 小时内",
        validDays: 7,
        scopeNote: "人民币含税、含电费，基础网络与故障响应按标准服务口径提供。",
      }, { idempotencyKey: idempotencyKey(`curated-quote-${index}`) });
      assert.equal(quoteResponse.status, 201);
    }
    const supplierQuotes = await supplier.get("/api/quotes?view=supplier&limit=20").then((result) => result.json());
    const outsiderBuyerQuotes = await outsider.get("/api/quotes?view=buyer&limit=20").then((result) => result.json());
    assert.equal(supplierQuotes.count, 3);
    assert.equal(outsiderBuyerQuotes.count, 0);
  } finally {
    await destroyFixture(fixture);
  }
});

test("curated demand revision is monotonic and supersedes quotes without losing replay history", async () => {
  const fixture = await createFixture();
  const databasePath = join(fixture.dataDirectory, "kai-cloud.sqlite");
  const quoteKey = idempotencyKey("curated-v1-quote");
  try {
    const supplier = await openSession(fixture.server.baseUrl);
    const market = await supplier.get("/api/requests?view=market&limit=20").then((response) => response.json());
    const demand = market.items.find((item) => item.title.includes("H100 80GB"));
    assert.ok(demand);

    const quotePayload = {
      demandId: demand.id,
      unitPrice: 19.8,
      leadTime: "48 小时内",
      validDays: 7,
      scopeNote: "人民币含税含电，基础网络与故障响应按当前需求口径提供。",
    };
    const createdQuoteResponse = await supplier.postJson("/api/quotes", quotePayload, { idempotencyKey: quoteKey });
    assert.equal(createdQuoteResponse.status, 201);
    const createdQuote = (await createdQuoteResponse.json()).record;

    await stopServer(fixture.server);
    const futureUpdatedAt = new Date(Date.now() + 24 * 60 * 60 * 1_000).toISOString();
    const before = new DatabaseSync(databasePath, { enableForeignKeyConstraints: true });
    let originalCreatedAt;
    try {
      const request = before.prepare("SELECT created_at FROM marketplace_requests_v2 WHERE id = ?").get(demand.id);
      originalCreatedAt = request.created_at;
      before.prepare(`UPDATE marketplace_requests_v2
        SET payload_hash = 'kai-curated-demand-v1', summary = '旧版公开要求',
            status = '方案待确认', updated_at = ?, version = 7
        WHERE id = ?`).run(futureUpdatedAt, demand.id);
      before.prepare(`UPDATE marketplace_quotes_v2
        SET standardization_version = 'kai-standard-v1@revision:kai-curated-demand-v1',
            valid_until = ?
        WHERE id = ?`).run(new Date(Date.now() + 7 * 24 * 60 * 60 * 1_000).toISOString(), createdQuote.id);
    } finally {
      before.close();
    }

    fixture.server = await startServer(fixture.dataDirectory);
    supplier.moveTo(fixture.server.baseUrl);
    const supplierQuotes = await supplier.get("/api/quotes?view=supplier&limit=20").then((response) => response.json());
    assert.equal(supplierQuotes.items.find((item) => item.id === createdQuote.id)?.status, "需求已更新 · 需重新报价");

    const upgraded = new DatabaseSync(databasePath, { readOnly: true });
    let upgradedVersion;
    let upgradedTimestamp;
    let supersededVersion;
    try {
      const request = upgraded.prepare(`SELECT payload_hash, status, created_at, updated_at, version
        FROM marketplace_requests_v2 WHERE id = ?`).get(demand.id);
      assert.match(request.payload_hash, /^kai-curated-demand-v3:/u);
      assert.equal(request.status, "已记录");
      assert.equal(request.created_at, originalCreatedAt);
      assert.ok(request.updated_at >= futureUpdatedAt);
      assert.equal(request.version, 8);
      upgradedVersion = request.version;
      upgradedTimestamp = request.updated_at;
      const quote = upgraded.prepare(`SELECT valid_until, standardization_version
        FROM marketplace_quotes_v2 WHERE id = ?`).get(createdQuote.id);
      assert.ok(Date.parse(quote.valid_until) <= Date.now());
      assert.match(quote.standardization_version, /@revision:kai-curated-demand-v1@superseded:/u);
      supersededVersion = quote.standardization_version;
    } finally {
      upgraded.close();
    }

    const replayResponse = await supplier.postJson("/api/quotes", quotePayload, { idempotencyKey: quoteKey });
    assert.equal(replayResponse.status, 200);
    const replay = await replayResponse.json();
    assert.equal(replay.replayed, true);
    assert.equal(replay.record.id, createdQuote.id);
    assert.equal(replay.record.status, "需求已更新 · 需重新报价");

    const freshQuoteResponse = await supplier.postJson("/api/quotes", {
      ...quotePayload,
      unitPrice: 20.1,
    }, { idempotencyKey: idempotencyKey("curated-v3-quote") });
    assert.equal(freshQuoteResponse.status, 201);
    const freshQuote = (await freshQuoteResponse.json()).record;
    const afterFreshQuote = new DatabaseSync(databasePath, { readOnly: true });
    try {
      const request = afterFreshQuote.prepare("SELECT payload_hash, updated_at, version FROM marketplace_requests_v2 WHERE id = ?").get(demand.id);
      assert.equal(request.updated_at, upgradedTimestamp, "a new quote must not move a future demand timestamp backwards");
      assert.equal(request.version, upgradedVersion + 1);
      upgradedVersion = request.version;
      const quote = afterFreshQuote.prepare("SELECT standardization_version FROM marketplace_quotes_v2 WHERE id = ?").get(freshQuote.id);
      assert.equal(quote.standardization_version, `kai-standard-v1@revision:${request.payload_hash}`);
    } finally {
      afterFreshQuote.close();
    }

    await stopServer(fixture.server);
    fixture.server = await startServer(fixture.dataDirectory);
    const repeated = new DatabaseSync(databasePath, { readOnly: true });
    try {
      const request = repeated.prepare("SELECT updated_at, version FROM marketplace_requests_v2 WHERE id = ?").get(demand.id);
      assert.equal(request.version, upgradedVersion);
      assert.equal(request.updated_at, upgradedTimestamp);
      const quote = repeated.prepare("SELECT standardization_version FROM marketplace_quotes_v2 WHERE id = ?").get(createdQuote.id);
      assert.equal(quote.standardization_version, supersededVersion);
    } finally {
      repeated.close();
    }
  } finally {
    await destroyFixture(fixture);
  }
});

test("legacy marketplace tables import once without exposing supplier free text to buyers", async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "kai-marketplace-legacy-test-"));
  const databasePath = join(dataDirectory, "kai-cloud.sqlite");
  const legacyRequestId = "KAI-LEGACY-DEMAND-001";
  const privateScope = "LEGACY_SUPPLIER_PRIVATE_SCOPE_R8C4";
  const createdAt = new Date().toISOString();
  let server;

  try {
    await writeFreshMarketSnapshot(dataDirectory);
    const legacyDb = new DatabaseSync(databasePath, { enableForeignKeyConstraints: true });
    try {
      legacyDb.exec(`
        CREATE TABLE marketplace_requests (
          id TEXT PRIMARY KEY,
          request_type TEXT NOT NULL,
          kind TEXT NOT NULL,
          title TEXT NOT NULL,
          category TEXT NOT NULL,
          region TEXT NOT NULL,
          pricing_unit TEXT NOT NULL,
          quantity REAL NOT NULL,
          duration_hours REAL,
          delivery_date TEXT,
          summary TEXT NOT NULL,
          offered_json TEXT,
          wanted_json TEXT,
          cash_direction TEXT NOT NULL,
          cash_amount REAL,
          status TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE marketplace_quotes (
          id TEXT PRIMARY KEY,
          demand_id TEXT NOT NULL,
          demand_title TEXT NOT NULL,
          unit_price REAL NOT NULL,
          pricing_unit TEXT NOT NULL,
          lead_time TEXT NOT NULL,
          valid_days INTEGER NOT NULL,
          scope_note TEXT NOT NULL,
          status TEXT NOT NULL,
          created_at TEXT NOT NULL,
          FOREIGN KEY (demand_id) REFERENCES marketplace_requests(id)
        );
        CREATE TABLE marketplace_drafts (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          category TEXT NOT NULL,
          capacity TEXT NOT NULL,
          status TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
      `);
      legacyDb.prepare(`INSERT INTO marketplace_requests (
        id, request_type, kind, title, category, region, pricing_unit, quantity,
        duration_hours, delivery_date, summary, offered_json, wanted_json,
        cash_direction, cash_amount, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        legacyRequestId,
        "procurement",
        "rental",
        "旧版 H100 需求",
        "gpu",
        "北京",
        "卡时",
        8,
        168,
        futureDate(),
        "旧版公开摘要",
        null,
        null,
        "none",
        null,
        "匹配中",
        createdAt,
        createdAt,
      );
      legacyDb.prepare(`INSERT INTO marketplace_quotes (
        id, demand_id, demand_title, unit_price, pricing_unit, lead_time,
        valid_days, scope_note, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        "KAI-LEGACY-QUOTE-001",
        legacyRequestId,
        "旧版 H100 需求",
        31.2,
        "卡时",
        "48 小时内",
        7,
        privateScope,
        "已提交",
        createdAt,
      );
      legacyDb.prepare(`INSERT INTO marketplace_drafts (
        id, title, category, capacity, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?)`).run(
        "KAI-LEGACY-DRAFT-001",
        "旧版 H100 资源草稿",
        "gpu",
        "8 卡 H100",
        "草稿",
        createdAt,
      );
    } finally {
      legacyDb.close();
    }

    server = await startServer(dataDirectory);
    const readyResponse = await fetch(`${server.baseUrl}/api/ready`);
    assert.equal(readyResponse.status, 200);
    const ready = await readyResponse.json();
    assert.equal(ready.status, "ok");
    assert.equal(ready.database.schemaVersion, 3);
    await stopServer(server);

    const migratedDb = new DatabaseSync(databasePath, { readOnly: true });
    try {
      const request = migratedDb.prepare(
        "SELECT owner_actor_id FROM marketplace_requests_v2 WHERE id = ?",
      ).get(legacyRequestId);
      assert.equal(request.owner_actor_id, "legacy-import");

      const quote = migratedDb.prepare(`SELECT
        raw_unit_price, standardized_unit_price, raw_scope_note,
        standardized_scope_note, standardization_version
        FROM marketplace_quotes_v2 WHERE id = ?`).get("KAI-LEGACY-QUOTE-001");
      assert.equal(quote.raw_scope_note, privateScope);
      assert.ok(!quote.standardized_scope_note.includes(privateScope));
      assert.notEqual(quote.standardized_unit_price, quote.raw_unit_price);
      assert.equal(quote.standardization_version, "kai-standard-v1");

      const draft = migratedDb.prepare(
        "SELECT owner_actor_id FROM marketplace_drafts_v2 WHERE id = ?",
      ).get("KAI-LEGACY-DRAFT-001");
      assert.equal(draft.owner_actor_id, "legacy-import");

      const migration = migratedDb.prepare(
        "SELECT version, checksum FROM marketplace_schema_migrations ORDER BY version DESC LIMIT 1",
      ).get();
      const schemaSource = await readFile("db/schema.ts", "utf8");
      const declaredChecksum = schemaSource.match(/MARKETPLACE_MIGRATION_CHECKSUM = "([0-9a-f]{64})"/u)?.[1];
      assert.equal(migration.version, 3);
      assert.equal(migration.checksum, declaredChecksum);
    } finally {
      migratedDb.close();
    }
  } finally {
    await stopServer(server);
    await rm(dataDirectory, { recursive: true, force: true });
  }
});

test("schema v3 repairs already-migrated v2 marketplace enum values before public reads", async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "kai-marketplace-v2-repair-test-"));
  const databasePath = join(dataDirectory, "kai-cloud.sqlite");
  const requestId = "KAI-V2-REPAIR-DEMAND-001";
  const quoteId = "KAI-V2-REPAIR-QUOTE-001";
  const createdAt = new Date().toISOString();
  const validUntil = new Date(Date.now() + 7 * 24 * 60 * 60 * 1_000).toISOString();
  let server;

  try {
    await writeFreshMarketSnapshot(dataDirectory);
    const v2Database = new DatabaseSync(databasePath, { enableForeignKeyConstraints: true });
    try {
      for (const statement of marketplaceSchemaStatements) v2Database.exec(statement);
      v2Database.exec("PRAGMA ignore_check_constraints = ON");
      v2Database.prepare(`INSERT INTO marketplace_schema_migrations (version, checksum, applied_at)
        VALUES (2, ?, ?)`).run("d74de64ac6ae258827f09dec9e5f2edf2e4c45b9a9d90749e8e72856d90889b5", createdAt);
      v2Database.prepare(`INSERT INTO marketplace_requests_v2 (
        id, owner_actor_id, idempotency_key, payload_hash, visibility,
        request_type, kind, title, category, region, pricing_unit, quantity,
        duration_hours, delivery_date, summary, offered_json, wanted_json,
        cash_direction, cash_amount, status, created_at, updated_at, version
      ) VALUES (?, 'legacy-demo', ?, 'legacy', 'market', 'procurement', 'rental',
        'Historical H100 request', 'gpu', '华北', '卡时', 8, 168, ?,
        'Historical public summary', NULL, NULL, 'none', NULL, '匹配中', ?, ?, 1)`).run(
        requestId,
        `legacy-${requestId}`,
        futureDate(),
        createdAt,
        createdAt,
      );
      v2Database.prepare(`INSERT INTO marketplace_quotes_v2 (
        id, supplier_actor_id, request_owner_actor_id, idempotency_key, payload_hash,
        demand_id, demand_title, raw_unit_price, standardized_unit_price,
        pricing_unit, currency, lead_time, valid_days, valid_until,
        raw_scope_note, standardized_scope_note, standardization_version,
        standardization_note, supplier_status, normalized_status, created_at
      ) VALUES (?, 'legacy-demo', 'legacy-demo', ?, 'legacy', ?,
        'Historical H100 request', 31.2, 32.14, '卡时', 'CNY', '48 小时', 7, ?,
        'PRIVATE_RAW_SCOPE', 'KAI 演示统一口径', 'kai-demo-v2',
        '旧版演示报价说明', '已提交', '已标准化', ?)`).run(
        quoteId,
        `legacy-${quoteId}`,
        requestId,
        validUntil,
        createdAt,
      );
      v2Database.exec("PRAGMA ignore_check_constraints = OFF");
    } finally {
      v2Database.close();
    }

    server = await startServer(dataDirectory);
    const readyResponse = await fetch(`${server.baseUrl}/api/ready`);
    assert.equal(readyResponse.status, 200);
    const ready = await readyResponse.json();
    assert.equal(ready.database.schemaVersion, 3);

    const marketResponse = await fetch(`${server.baseUrl}/api/requests?view=market&limit=50`);
    assert.equal(marketResponse.status, 200);
    const market = await marketResponse.json();
    assert.equal(market.items.find((item) => item.id === requestId)?.region, "北京");
    await stopServer(server);

    const repaired = new DatabaseSync(databasePath, { readOnly: true });
    try {
      const request = repaired.prepare(
        "SELECT owner_actor_id, region FROM marketplace_requests_v2 WHERE id = ?",
      ).get(requestId);
      assert.equal(request.owner_actor_id, "legacy-import");
      assert.equal(request.region, "北京");
      const quote = repaired.prepare(`SELECT supplier_actor_id, request_owner_actor_id,
        lead_time, standardized_scope_note, standardization_version, standardization_note
        FROM marketplace_quotes_v2 WHERE id = ?`).get(quoteId);
      assert.equal(quote.supplier_actor_id, "legacy-import");
      assert.equal(quote.request_owner_actor_id, "legacy-import");
      assert.equal(quote.lead_time, "48 小时内");
      assert.equal(quote.standardization_version, "kai-standard-v1");
      assert.doesNotMatch(JSON.stringify(quote), /demo|演示|非实时成交价/u);
      const migration = repaired.prepare(
        "SELECT version FROM marketplace_schema_migrations ORDER BY version DESC LIMIT 1",
      ).get();
      assert.equal(migration.version, 3);
    } finally {
      repaired.close();
    }
  } finally {
    await stopServer(server);
    await rm(dataDirectory, { recursive: true, force: true });
  }
});

test("marketplace API enforces A/B/C isolation, projections, CSRF and idempotency across restart", async () => {
  const fixture = await createFixture();
  const forgedIdentityHeaders = {
    "oai-authenticated-user-email": "victim@example.invalid",
    "x-forwarded-proto": "https",
  };

  try {
    const [buyerA, supplierB, outsiderC] = await Promise.all([
      openSession(fixture.server.baseUrl, forgedIdentityHeaders),
      openSession(fixture.server.baseUrl, forgedIdentityHeaders),
      openSession(fixture.server.baseUrl),
    ]);

    assert.equal(buyerA.session.source, "anonymous-session");
    assert.equal(supplierB.session.source, "anonymous-session");
    assert.match(buyerA.cookie, SESSION_COOKIE_PATTERN);
    assert.match(supplierB.cookie, SESSION_COOKIE_PATTERN);
    assert.notEqual(buyerA.cookie, supplierB.cookie, "forged platform headers must not collapse two sessions");

    const marketResponse = await fetch(`${fixture.server.baseUrl}/api/market`);
    assert.equal(marketResponse.status, 200);
    const market = await marketResponse.json();
    assert.equal(market.source, "persistent");
    assert.ok(market.snapshot.quotes.length >= 30);

    const csrfDraft = draftPayload(900);
    await errorBody(
      await buyerA.postJson("/api/drafts", csrfDraft, { origin: null, idempotencyKey: idempotencyKey("missing-origin") }),
      403,
      "ORIGIN_REJECTED",
    );
    await errorBody(
      await buyerA.postJson("/api/drafts", csrfDraft, { origin: "https://attacker.invalid", idempotencyKey: idempotencyKey("wrong-origin") }),
      403,
      "ORIGIN_REJECTED",
    );
    await errorBody(
      await buyerA.postJson("/api/drafts", csrfDraft, { csrf: null, idempotencyKey: idempotencyKey("missing-csrf") }),
      403,
      "CSRF_REJECTED",
    );
    await errorBody(
      await buyerA.postJson("/api/drafts", csrfDraft, { csrf: "0".repeat(64), idempotencyKey: idempotencyKey("wrong-csrf") }),
      403,
      "CSRF_REJECTED",
    );

    const rejectedRegion = await errorBody(
      await buyerA.postJson(
        "/api/requests",
        procurementPayload({ region: "联系 13800138000 获取低价" }),
        { idempotencyKey: idempotencyKey("unsupported-region") },
      ),
      400,
      "VALIDATION_ERROR",
    );
    assert.equal(rejectedRegion.error.field, "region");
    const requestsAfterRejectedRegion = await (await buyerA.get("/api/requests?view=mine&limit=50")).json();
    assert.equal(requestsAfterRejectedRegion.count, 0);

    const privateRequirement = "A_ONLY_PRIVATE_REQUIREMENT_7QX9: 需要指定容器镜像与专线。";
    const requestResponse = await buyerA.postJson(
      "/api/requests",
      procurementPayload({ requirements: privateRequirement }),
      { idempotencyKey: idempotencyKey("buyer-request") },
    );
    assert.equal(requestResponse.status, 201);
    const requestRecord = (await requestResponse.json()).record;
    assert.match(requestRecord.id, /^KAI-R-\d{8}-[A-F0-9]{32}$/u);

    const privateOffer = "A_ONLY_PRIVATE_OFFER_N3M8: 华北离峰 GPU 容量与容器环境。";
    const privateWant = "A_ONLY_PRIVATE_WANT_P5K2: 主流推理模型的标准调用额度。";
    const swapResponse = await buyerA.postJson("/api/requests", {
      requestType: "swap",
      offered: {
        category: "gpu",
        pricingUnit: "卡时",
        quantity: 100,
        description: privateOffer,
      },
      wanted: {
        category: "token_model",
        pricingUnit: "百万 Token",
        quantity: 500,
        description: privateWant,
      },
      region: "广东",
      cashDirection: "offer",
      cashAmount: 12_345,
    }, { idempotencyKey: idempotencyKey("buyer-swap") });
    assert.equal(swapResponse.status, 201);
    const swapRecord = (await swapResponse.json()).record;

    const [buyerMineResponse, supplierMineResponse, outsiderMineResponse] = await Promise.all([
      buyerA.get("/api/requests?view=mine&limit=50"),
      supplierB.get("/api/requests?view=mine&limit=50"),
      outsiderC.get("/api/requests?view=mine&limit=50"),
    ]);
    const buyerMine = await buyerMineResponse.json();
    const supplierMine = await supplierMineResponse.json();
    const outsiderMine = await outsiderMineResponse.json();
    assert.equal(buyerMine.count, 2);
    assert.equal(supplierMine.count, 0);
    assert.equal(outsiderMine.count, 0);
    assert.ok(JSON.stringify(buyerMine).includes(privateRequirement));

    const marketForB = await (await supplierB.get("/api/requests?view=market&limit=50")).json();
    const serializedMarket = JSON.stringify(marketForB);
    assert.equal(marketForB.count, 2 + curatedMarketDemands().length);
    assert.ok(marketForB.items.some((item) => item.id === requestRecord.id));
    assert.ok(!serializedMarket.includes(privateRequirement));
    assert.ok(!serializedMarket.includes(privateOffer));
    assert.ok(!serializedMarket.includes(privateWant));
    const publicSwap = marketForB.items.find((item) => item.id === swapRecord.id);
    assert.equal(publicSwap.cashAmount, 0);
    assert.match(publicSwap.offered.description, /人工撮合时核验/u);
    assert.match(publicSwap.wanted.description, /人工撮合时核验/u);

    const privateScope = "B_ONLY_RAW_SCOPE_R8C4: 报价含税含电，公网流量另计。";
    const normalizedPrivateScope = privateScope.normalize("NFKC");
    const rejectedLeadTime = await errorBody(
      await supplierB.postJson("/api/quotes", {
        demandId: requestRecord.id,
        unitPrice: 31.2,
        leadTime: "私聊 supplier-private@example.invalid",
        validDays: 7,
        scopeNote: privateScope,
      }, { idempotencyKey: idempotencyKey("unsupported-lead-time") }),
      400,
      "VALIDATION_ERROR",
    );
    assert.equal(rejectedLeadTime.error.field, "leadTime");
    const [supplierQuotesAfterRejectedLeadTime, buyerQuotesAfterRejectedLeadTime] = await Promise.all([
      supplierB.get("/api/quotes?view=supplier&limit=50").then((response) => response.json()),
      buyerA.get("/api/quotes?view=buyer&limit=50").then((response) => response.json()),
    ]);
    assert.equal(supplierQuotesAfterRejectedLeadTime.count, 0);
    assert.equal(buyerQuotesAfterRejectedLeadTime.count, 0);

    const quoteResponse = await supplierB.postJson("/api/quotes", {
      demandId: requestRecord.id,
      unitPrice: 31.2,
      leadTime: "48 小时内",
      validDays: 7,
      scopeNote: privateScope,
    }, { idempotencyKey: idempotencyKey("supplier-quote") });
    assert.equal(quoteResponse.status, 201);
    const supplierQuote = (await quoteResponse.json()).record;
    assert.equal(supplierQuote.unitPrice, 31.2);
    assert.equal(supplierQuote.scopeNote, normalizedPrivateScope);
    assert.ok(!("standardizedUnitPrice" in supplierQuote));

    const [supplierOwnQuotes, buyerQuotes, supplierBuyerView, buyerSupplierView, outsiderBuyerView, outsiderSupplierView] = await Promise.all([
      supplierB.get("/api/quotes?view=supplier&limit=50").then((response) => response.json()),
      buyerA.get("/api/quotes?view=buyer&limit=50").then((response) => response.json()),
      supplierB.get("/api/quotes?view=buyer&limit=50").then((response) => response.json()),
      buyerA.get("/api/quotes?view=supplier&limit=50").then((response) => response.json()),
      outsiderC.get("/api/quotes?view=buyer&limit=50").then((response) => response.json()),
      outsiderC.get("/api/quotes?view=supplier&limit=50").then((response) => response.json()),
    ]);
    assert.equal(supplierOwnQuotes.count, 1);
    assert.equal(supplierOwnQuotes.items[0].scopeNote, normalizedPrivateScope);
    assert.ok(!("standardizedUnitPrice" in supplierOwnQuotes.items[0]));
    assert.equal(buyerQuotes.count, 1);
    assert.notEqual(buyerQuotes.items[0].standardizedUnitPrice, 31.2);
    assert.match(buyerQuotes.items[0].standardizedScope, /^KAI 统一口径：/u);
    assert.equal(buyerQuotes.items[0].standardizationVersion, "kai-standard-v1");
    assert.doesNotMatch(JSON.stringify(buyerQuotes), /演示|虚构|非实时成交价|模拟/u);
    assert.ok(!JSON.stringify(buyerQuotes).includes(normalizedPrivateScope));
    assert.ok(!("unitPrice" in buyerQuotes.items[0]));
    assert.ok(!("scopeNote" in buyerQuotes.items[0]));
    assert.equal(supplierBuyerView.count, 0);
    assert.equal(buyerSupplierView.count, 0);
    assert.equal(outsiderBuyerView.count, 0);
    assert.equal(outsiderSupplierView.count, 0);

    const draftResponse = await buyerA.postJson("/api/drafts", draftPayload(1), {
      idempotencyKey: idempotencyKey("buyer-draft"),
    });
    assert.equal(draftResponse.status, 201);
    const draftRecord = (await draftResponse.json()).record;
    const [buyerDrafts, supplierDrafts, outsiderDrafts] = await Promise.all([
      buyerA.get("/api/drafts?view=mine&limit=50").then((response) => response.json()),
      supplierB.get("/api/drafts?view=mine&limit=50").then((response) => response.json()),
      outsiderC.get("/api/drafts?view=mine&limit=50").then((response) => response.json()),
    ]);
    assert.deepEqual(buyerDrafts.items.map((item) => item.id), [draftRecord.id]);
    assert.equal(supplierDrafts.count, 0);
    assert.equal(outsiderDrafts.count, 0);

    const replayKey = idempotencyKey("request-replay");
    const replayPayload = procurementPayload({
      quantity: 16,
      requirements: "幂等测试需求：同一次用户提交重试不得创建重复记录。",
    });
    const firstWrite = await buyerA.postJson("/api/requests", replayPayload, { idempotencyKey: replayKey });
    assert.equal(firstWrite.status, 201);
    assert.equal(firstWrite.headers.get("idempotency-replayed"), "false");
    const firstWriteBody = await firstWrite.json();
    assert.equal(firstWriteBody.replayed, false);
    const replay = await buyerA.postJson("/api/requests", replayPayload, { idempotencyKey: replayKey });
    assert.equal(replay.status, 200);
    assert.equal(replay.headers.get("idempotency-replayed"), "true");
    const replayBody = await replay.json();
    assert.equal(replayBody.replayed, true);
    assert.equal(replayBody.record.id, firstWriteBody.record.id);
    await errorBody(
      await buyerA.postJson("/api/requests", { ...replayPayload, quantity: 17 }, { idempotencyKey: replayKey }),
      409,
      "IDEMPOTENCY_CONFLICT",
    );

    await stopServer(fixture.server);
    const persistedDb = new DatabaseSync(join(fixture.dataDirectory, "kai-cloud.sqlite"));
    try {
      persistedDb.prepare("UPDATE marketplace_quotes_v2 SET valid_until = ? WHERE id = ?")
        .run("2000-01-01T00:00:00.000Z", supplierQuote.id);
      persistedDb.prepare("UPDATE marketplace_requests_v2 SET created_at = ? WHERE id = ?")
        .run("2000-01-01T00:00:00.000Z", requestRecord.id);
    } finally {
      persistedDb.close();
    }
    fixture.server = await startServer(fixture.dataDirectory);
    for (const client of [buyerA, supplierB, outsiderC]) {
      client.moveTo(fixture.server.baseUrl);
      await client.refreshSession();
    }

    const ready = await (await fetch(`${fixture.server.baseUrl}/api/ready`)).json();
    assert.equal(ready.status, "ok");
    assert.equal(ready.database.backend, "sqlite");
    assert.equal(ready.database.schemaVersion, 3);
    assert.equal(ready.market.source, "persistent");
    assert.equal(ready.market.ready, true);

    const [requestsAfterRestart, supplierQuotesAfterRestart, buyerQuotesAfterRestart, draftsAfterRestart] = await Promise.all([
      buyerA.get("/api/requests?view=mine&limit=50").then((response) => response.json()),
      supplierB.get("/api/quotes?view=supplier&limit=50").then((response) => response.json()),
      buyerA.get("/api/quotes?view=buyer&limit=50").then((response) => response.json()),
      buyerA.get("/api/drafts?view=mine&limit=50").then((response) => response.json()),
    ]);
    assert.equal(requestsAfterRestart.count, 3);
    assert.ok(requestsAfterRestart.items.some((item) => item.id === requestRecord.id), "a recently updated demand must survive retention even when its creation date is old");
    assert.equal(supplierQuotesAfterRestart.items[0].id, supplierQuote.id);
    assert.equal(supplierQuotesAfterRestart.items[0].status, "已过期");
    assert.equal(buyerQuotesAfterRestart.items[0].id, supplierQuote.id);
    assert.equal(buyerQuotesAfterRestart.items[0].status, "已过期");
    assert.equal(draftsAfterRestart.items[0].id, draftRecord.id);

    const replayAfterRestart = await buyerA.postJson("/api/requests", replayPayload, { idempotencyKey: replayKey });
    assert.equal(replayAfterRestart.status, 200);
    assert.equal((await replayAfterRestart.json()).record.id, firstWriteBody.record.id);
  } finally {
    await destroyFixture(fixture);
  }
});

test("anonymous session bootstrap does not create persistent rows before a write", async () => {
  const fixture = await createFixture();
  try {
    const responses = await Promise.all(Array.from({ length: 8 }, () => fetch(`${fixture.server.baseUrl}/api/session`)));
    assert.ok(responses.every((response) => response.status === 200));
    const sessionBodies = await Promise.all(responses.map((response) => response.json()));
    const firstSession = sessionBodies[0];
    const rejectedWrite = await fetch(`${fixture.server.baseUrl}/api/requests`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(procurementPayload()),
    });
    assert.equal(rejectedWrite.status, 403);
    await rejectedWrite.text();
    await new Promise((resolve) => setTimeout(resolve, 50));
    const structuredLogs = fixture.server.logs.join("");
    assert.match(structuredLogs, /"event":"api_request"/u);
    assert.match(structuredLogs, /"route":"\/api\/session"/u);
    assert.match(structuredLogs, /"status":403/u);
    assert.ok(!structuredLogs.includes(firstSession.session.csrfToken));
    assert.ok(!structuredLogs.includes(procurementPayload().requirements));
    await stopServer(fixture.server);
    const db = new DatabaseSync(join(fixture.dataDirectory, "kai-cloud.sqlite"), { readOnly: true });
    try {
      const row = db.prepare("SELECT COUNT(*) AS count FROM marketplace_sessions_v2").get();
      assert.equal(row.count, 0);
    } finally {
      db.close();
    }
  } finally {
    await destroyFixture(fixture);
  }
});

test("readiness rejects bundled and stale market fallbacks", async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "kai-marketplace-readiness-test-"));
  let server;
  try {
    server = await startServer(dataDirectory);
    const bundledResponse = await fetch(`${server.baseUrl}/api/ready`);
    assert.equal(bundledResponse.status, 503);
    const bundled = await bundledResponse.json();
    assert.equal(bundled.status, "error");
    assert.equal(bundled.market.source, "bundled");
    assert.equal(bundled.market.ready, false);

    await stopServer(server);
    const snapshot = JSON.parse(await readFile("data/model-market.snapshot.json", "utf8"));
    snapshot.publishedAt = "2000-01-01T00:00:00.000Z";
    await writeFile(join(dataDirectory, "model-market.snapshot.json"), `${JSON.stringify(snapshot)}\n`, "utf8");
    server = await startServer(dataDirectory);
    const staleResponse = await fetch(`${server.baseUrl}/api/ready`);
    assert.equal(staleResponse.status, 503);
    const stale = await staleResponse.json();
    assert.equal(stale.market.source, "persistent");
    assert.equal(stale.market.stale, true);
    assert.equal(stale.market.ready, false);

    await stopServer(server);
    snapshot.publishedAt = new Date().toISOString();
    await writeFile(join(dataDirectory, "model-market.snapshot.json"), `${JSON.stringify(snapshot)}\n`, "utf8");
    server = await startServer(dataDirectory, { KAI_CURSOR_SECRET: "" });
    const missingSecretResponse = await fetch(`${server.baseUrl}/api/ready`);
    assert.equal(missingSecretResponse.status, 503);
    const missingSecret = await missingSecretResponse.json();
    assert.equal(missingSecret.status, "error");
    assert.match(missingSecret.requestId, /^[0-9a-f-]{36}$/u);
  } finally {
    await stopServer(server);
    await rm(dataDirectory, { recursive: true, force: true });
  }
});

test("readiness rejects an invalid exchange migration history and accepts an upgraded database copy without enabling external capabilities",async()=>{
  const dataDirectory=await mkdtemp(join(tmpdir(),"kai-readiness-missing-migration-"));
  const upgradedDirectory=await mkdtemp(join(tmpdir(),"kai-readiness-upgraded-copy-"));
  const databasePath=join(dataDirectory,"kai-cloud.sqlite"),upgradedPath=join(upgradedDirectory,"kai-cloud.sqlite");
  let server,upgradedServer,beforeReadyRequestCount;
  try{
    await writeFreshMarketSnapshot(dataDirectory);await writeFreshMarketSnapshot(upgradedDirectory);
    const incomplete=new DatabaseSync(databasePath);incomplete.exec("CREATE TABLE exchange_orphan(id TEXT PRIMARY KEY)");incomplete.close();
    server=await startServer(dataDirectory);
    const rejectedResponse=await fetch(`${server.baseUrl}/api/ready`);assert.equal(rejectedResponse.status,503);
    const rejected=await rejectedResponse.json();assert.equal(rejected.status,"error");assert.equal(rejected.storage.exchange.ready,false);assert.equal(rejected.storage.exchange.errorCode,"EXCHANGE_SCHEMA_HISTORY_INVALID");
    assert.equal(rejected.storage.supply.ready,true);assert.equal(rejected.storage.admin.ready,true);assert.equal(rejected.storage.auth.ready,true);
    await stopServer(server);server=null;

    upgradedServer=await startServer(upgradedDirectory);
    const sourceResponse=await fetch(`${upgradedServer.baseUrl}/api/ready`);assert.equal(sourceResponse.status,200);
    await stopServer(upgradedServer);upgradedServer=null;
    const sourceDb=new DatabaseSync(upgradedPath);sourceDb.exec("PRAGMA wal_checkpoint(TRUNCATE)");sourceDb.close();
    await rm(databasePath,{force:true});await rm(`${databasePath}-wal`,{force:true});await rm(`${databasePath}-shm`,{force:true});await copyFile(upgradedPath,databasePath);
    const beforeProbe=new DatabaseSync(databasePath,{readOnly:true});beforeReadyRequestCount=beforeProbe.prepare("SELECT COUNT(*) AS count FROM marketplace_requests_v2").get().count;beforeProbe.close();

    server=await startServer(dataDirectory);
    const readyResponse=await fetch(`${server.baseUrl}/api/ready`);assert.equal(readyResponse.status,200);
    const ready=await readyResponse.json();assert.equal(ready.status,"ok");
    for(const key of ["marketplace","exchange","supply","admin","auth"])assert.equal(ready.storage[key].ready,true,key);
    for(const key of ["adminPasswordLogin","alipayLive","sshProvisioning"]){assert.equal(ready.capabilities[key].available,false,key);assert.equal(ready.capabilities[key].failClosed,true,key);assert.ok(ready.capabilities[key].missing.length>0,key);}
    assert.equal("emailOtpLogin" in ready.capabilities,false);
    await stopServer(server);server=null;
    const inspected=new DatabaseSync(databasePath,{readOnly:true});
    try{
      for(const table of ["marketplace_requests_v2","exchange_orders","supply_asset_pools","admin_user_accounts","admin_memberships","admin_membership_roles"]){const row=inspected.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get();assert.equal(row.count,0,`${table} readiness must not create business or role rows`);if(table==="marketplace_requests_v2")assert.equal(row.count,beforeReadyRequestCount,"readiness must not change marketplace request count");}
    }finally{inspected.close();}
  }finally{
    await stopServer(server);await stopServer(upgradedServer);
    await rm(dataDirectory,{recursive:true,force:true});await rm(upgradedDirectory,{recursive:true,force:true});
  }
});

test("marketplace cursor pagination is stable and rejects a structurally valid forged cursor", async () => {
  const fixture = await createFixture();
  try {
    const client = await openSession(fixture.server.baseUrl);
    const otherClient = await openSession(fixture.server.baseUrl);
    for (let index = 0; index < 8; index += 1) {
      const response = await client.postJson("/api/requests", procurementPayload({
        quantity: index + 1,
        requirements: `分页需求 ${index}：验证稳定游标无重复、无遗漏。`,
      }), { idempotencyKey: idempotencyKey(`page-${index}`) });
      assert.equal(response.status, 201);
    }

    const full = await (await client.get("/api/requests?view=mine&limit=50")).json();
    assert.equal(full.count, 8);
    const expectedIds = full.items.map((item) => item.id);

    const pagedIds = [];
    let cursor = null;
    let firstCursor = null;
    for (let pageNumber = 0; pageNumber < 10; pageNumber += 1) {
      const path = `/api/requests?view=mine&limit=3${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
      const response = await client.get(path);
      assert.equal(response.status, 200);
      const page = await response.json();
      assert.ok(page.items.length >= 1 && page.items.length <= 3);
      assert.equal(page.pageInfo.limit, 3);
      pagedIds.push(...page.items.map((item) => item.id));
      if (!page.pageInfo.hasMore) {
        assert.equal(page.pageInfo.nextCursor, null);
        break;
      }
      assert.match(page.pageInfo.nextCursor, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u);
      cursor = page.pageInfo.nextCursor;
      firstCursor ??= cursor;
    }
    assert.deepEqual(pagedIds, expectedIds);
    assert.equal(new Set(pagedIds).size, expectedIds.length);
    assert.ok(firstCursor);

    await errorBody(
      await otherClient.get(`/api/requests?view=mine&limit=3&cursor=${encodeURIComponent(firstCursor)}`),
      400,
      "VALIDATION_ERROR",
    );
    await errorBody(
      await client.get(`/api/requests?view=market&limit=3&cursor=${encodeURIComponent(firstCursor)}`),
      400,
      "VALIDATION_ERROR",
    );

    const forgedPayload = Buffer.from(JSON.stringify([
      "2099-01-01T00:00:00.000Z",
      `KAI-R-20990101-${"A".repeat(32)}`,
    ])).toString("base64url");
    const forgedCursor = `${forgedPayload}.${"A".repeat(24)}`;
    await errorBody(
      await client.get(`/api/requests?view=mine&limit=3&cursor=${encodeURIComponent(forgedCursor)}`),
      400,
      "VALIDATION_ERROR",
    );
  } finally {
    await destroyFixture(fixture);
  }
});

test("marketplace streaming body limit returns 413 before persisting a draft", async () => {
  const fixture = await createFixture();
  try {
    const client = await openSession(fixture.server.baseUrl);
    const oversizedBody = JSON.stringify({
      title: "超大流式草稿",
      category: "gpu",
      capacity: "X".repeat(40 * 1024),
    });
    const response = await client.postStream("/api/drafts", oversizedBody);
    await errorBody(response, 413, "PAYLOAD_TOO_LARGE");
    const drafts = await (await client.get("/api/drafts?view=mine&limit=50")).json();
    assert.equal(drafts.count, 0);
  } finally {
    await destroyFixture(fixture);
  }
});

test("catalog purchase submits a priced procurement intent without exposing unverified inventory as an order", async () => {
  const fixture = await createFixture();
  try {
    const client = await openSession(fixture.server.baseUrl);
    const resource = resourceListings.find((item) => item.id === "cloud-capacity-swap-nm");
    assert.ok(resource);
    const response = await client.postJson("/api/v1/catalog-purchase-intents", {
      resourceId: resource.id,
      quantity: 2,
      durationHours: 24,
      deliveryDate: futureDate(7),
      note: "需要标准网络与交付窗口确认。",
    }, { idempotencyKey: idempotencyKey("catalog-purchase") });
    assert.equal(response.status, 201);
    const body = await response.json();
    assert.equal(body.record.requestType, "procurement");
    assert.equal(body.record.quantity, 2);
    assert.equal(body.record.durationHours, 24);
    assert.match(body.record.summary, new RegExp(resource.id, "u"));
    assert.equal(body.priceSnapshot.unitPrice, resource.quote.median);
    assert.equal(body.priceSnapshot.pricingUnit, resource.pricingUnit);
    assert.equal(body.priceSnapshot.estimatedAmount, resource.quote.median * 2 * 24);

    const mine = await (await client.get("/api/requests?view=mine&limit=20")).json();
    assert.ok(mine.items.some((item) => item.id === body.record.id));
  } finally {
    await destroyFixture(fixture);
  }
});

test("marketplace durable rate limit survives a standalone restart", async () => {
  const fixture = await createFixture();
  try {
    const client = await openSession(fixture.server.baseUrl);
    for (let index = 0; index < 2; index += 1) {
      const response = await client.postJson("/api/drafts", draftPayload(index), {
        idempotencyKey: idempotencyKey(`rate-before-${index}`),
      });
      assert.equal(response.status, 201);
    }

    await stopServer(fixture.server);
    fixture.server = await startServer(fixture.dataDirectory);
    client.moveTo(fixture.server.baseUrl);
    await client.refreshSession();

    for (let index = 2; index < 30; index += 1) {
      const response = await client.postJson("/api/drafts", draftPayload(index), {
        idempotencyKey: idempotencyKey(`rate-after-${index}`),
      });
      assert.equal(response.status, 201, `write ${index + 1} should remain within the 30-write window`);
    }

    const limited = await client.postJson("/api/drafts", draftPayload(30), {
      idempotencyKey: idempotencyKey("rate-limited"),
    });
    await errorBody(limited, 429, "RATE_LIMITED");
    assert.ok(Number(limited.headers.get("retry-after")) >= 1);

    const drafts = await (await client.get("/api/drafts?view=mine&limit=50")).json();
    assert.equal(drafts.count, 30);
  } finally {
    await destroyFixture(fixture);
  }
});
