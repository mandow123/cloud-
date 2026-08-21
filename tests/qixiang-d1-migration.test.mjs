import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const wrangler = join(repositoryRoot, "node_modules", ".bin", "wrangler");

function runWrangler(directory, ...arguments_) {
  const result = spawnSync(wrangler, arguments_, {
    cwd: directory,
    encoding: "utf8",
    timeout: 60_000,
    env: {
      ...process.env,
      CI: "1",
      NO_COLOR: "1",
      WRANGLER_SEND_METRICS: "false",
      XDG_CONFIG_HOME: join(directory, "xdg"),
    },
  });
  assert.equal(result.signal, null, `wrangler timed out: ${result.stderr || result.stdout}`);
  assert.equal(result.status, 0, `wrangler failed (${arguments_.join(" ")}):\n${result.stderr || result.stdout}`);
  return result.stdout;
}

function executeJson(directory, command) {
  const output = runWrangler(directory, "d1", "execute", "DB", "--local", "--config", join(directory, "wrangler.toml"), "--persist-to", join(directory, "state"), "--command", command, "--json");
  const parsed = JSON.parse(output);
  const executions = Array.isArray(parsed) ? parsed : [parsed];
  return executions.flatMap((entry) => Array.isArray(entry?.results) ? entry.results : []);
}

test("0033 applies through the real local D1 migration runner without losing legacy rows or event foreign keys", { timeout: 120_000 }, () => {
  const directory = mkdtempSync(join(tmpdir(), "kai-qixiang-d1-"));
  try {
    mkdirSync(join(directory, "migrations"));
    writeFileSync(join(directory, "worker.mjs"), "export default { fetch() { return new Response('ok'); } };\n", "utf8");
    writeFileSync(join(directory, "wrangler.toml"), `name = "kai-qixiang-d1-migration-test"
main = "worker.mjs"
compatibility_date = "2026-08-21"

[[d1_databases]]
binding = "DB"
database_name = "kai-qixiang-d1-migration-test"
database_id = "00000000-0000-0000-0000-000000000001"
migrations_dir = "migrations"
`, "utf8");
    writeFileSync(join(directory, "migrations", "0001_legacy_card_hours.sql"), `CREATE TABLE card_hour_schema_migrations(version INTEGER PRIMARY KEY,applied_at TEXT NOT NULL);
INSERT INTO card_hour_schema_migrations VALUES(3,'2026-08-20T00:00:00Z');
CREATE TABLE card_hour_topup_orders(id TEXT PRIMARY KEY,organization_id TEXT NOT NULL,account_id TEXT NOT NULL,card_hour_micros INTEGER NOT NULL,amount_cents INTEGER NOT NULL,currency TEXT NOT NULL,provider TEXT NOT NULL CHECK(provider='ALIPAY'),status TEXT NOT NULL,idempotency_key TEXT NOT NULL,payload_hash TEXT NOT NULL,provider_transaction_id TEXT,expires_at TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,UNIQUE(organization_id,idempotency_key),UNIQUE(provider,provider_transaction_id));
CREATE INDEX card_hour_topups_org_time_idx ON card_hour_topup_orders(organization_id,created_at DESC);
CREATE TABLE card_hour_topup_events(id TEXT PRIMARY KEY,topup_order_id TEXT NOT NULL,provider_event_id TEXT NOT NULL UNIQUE,provider_transaction_id TEXT NOT NULL,event_type TEXT NOT NULL,amount_cents INTEGER NOT NULL,payload_digest TEXT NOT NULL,occurred_at TEXT NOT NULL,received_at TEXT NOT NULL,FOREIGN KEY(topup_order_id) REFERENCES card_hour_topup_orders(id));
INSERT INTO card_hour_topup_orders VALUES('KAI_CH_OLDALIPAY00000001','org-old','acct-old',5000000,501,'CNY','ALIPAY','CAPTURED','idem-old','hash-old','trade-old','2026-08-20T00:15:00Z','2026-08-20T00:00:00Z','2026-08-20T00:01:00Z');
INSERT INTO card_hour_topup_events VALUES('evt-old','KAI_CH_OLDALIPAY00000001','event-old','trade-old','CAPTURED',501,'digest-old','2026-08-20T00:01:00Z','2026-08-20T00:01:01Z');
`, "utf8");
    copyFileSync(join(repositoryRoot, ".openai", "drizzle", "0033_qixiang_pay_card_hour_topups.sql"), join(directory, "migrations", "0002_qixiang_pay.sql"));

    runWrangler(directory, "d1", "migrations", "apply", "DB", "--local", "--config", join(directory, "wrangler.toml"), "--persist-to", join(directory, "state"));
    executeJson(directory, `INSERT INTO card_hour_topup_orders(id,organization_id,account_id,card_hour_micros,amount_cents,currency,provider,provider_merchant_ref,provider_payment_type,status,idempotency_key,payload_hash,expires_at,created_at,updated_at) VALUES('KAI_CH_${"d".repeat(32)}','org-new','acct-new',5000000,501,'CNY','QIXIANG_PAY','10086','alipay','PENDING','idem-new','hash-new','2026-08-21T00:15:00Z','2026-08-21T00:00:00Z','2026-08-21T00:00:00Z')`);
    const rows = executeJson(directory, `SELECT
      (SELECT provider FROM card_hour_topup_orders WHERE id='KAI_CH_OLDALIPAY00000001') AS legacy_provider,
      (SELECT status FROM card_hour_topup_orders WHERE id='KAI_CH_OLDALIPAY00000001') AS legacy_status,
      (SELECT COUNT(*) FROM card_hour_topup_events WHERE id='evt-old' AND topup_order_id='KAI_CH_OLDALIPAY00000001') AS legacy_event_count,
      (SELECT provider FROM card_hour_topup_orders WHERE organization_id='org-new') AS new_provider,
      (SELECT COUNT(*) FROM pragma_foreign_key_check) AS foreign_key_failures`);
    assert.deepEqual(rows, [{ legacy_provider: "ALIPAY", legacy_status: "CAPTURED", legacy_event_count: 1, new_provider: "QIXIANG_PAY", foreign_key_failures: 0 }]);

    const migration = readFileSync(join(repositoryRoot, ".openai", "drizzle", "0033_qixiang_pay_card_hour_topups.sql"), "utf8");
    assert.match(migration, /PRAGMA defer_foreign_keys\s*=\s*ON/u);
    assert.doesNotMatch(migration, /PRAGMA foreign_keys\s*=\s*OFF|\bBEGIN\b|\bCOMMIT\b/u);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
