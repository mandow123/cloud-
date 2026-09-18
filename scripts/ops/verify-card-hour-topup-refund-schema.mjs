#!/usr/bin/env node

import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";

const SQLITE_MIGRATION_URL = new URL("../../drizzle/0042_card_hour_topup_refunds.sql", import.meta.url);
const D1_MIGRATION_URL = new URL("../../.openai/drizzle/0042_card_hour_topup_refunds.sql", import.meta.url);
const TABLE = "card_hour_topup_refunds";
const INDEXES = ["card_hour_topup_refunds_status_idx", "card_hour_topup_refunds_provider_tx_unique_idx"];
const REQUIRED_COLUMNS = [
  "id", "topup_order_id", "organization_id", "provider", "amount_cents", "card_hour_micros", "status",
  "requested_by", "approved_by", "request_reason", "decision_reason", "provider_refund_request_id",
  "provider_transaction_id", "claim_token", "claimed_at", "attempt_count", "error_code", "error_message", "manual_evidence_digest", "payload_hash",
  "version", "created_at", "updated_at",
];
const MIGRATION_SQL = readFileSync(SQLITE_MIGRATION_URL, "utf8");
const EXPECTED_TABLE_SQL = MIGRATION_SQL.match(/CREATE TABLE IF NOT EXISTS card_hour_topup_refunds\s*\([\s\S]*?\n\);/u)?.[0] ?? "";
const EXPECTED_STATUS_INDEX_SQL = MIGRATION_SQL.match(/CREATE INDEX IF NOT EXISTS card_hour_topup_refunds_status_idx[^;]+;/u)?.[0] ?? "";
const EXPECTED_PROVIDER_TX_INDEX_SQL = MIGRATION_SQL.match(/CREATE UNIQUE INDEX IF NOT EXISTS card_hour_topup_refunds_provider_tx_unique_idx[^;]+;/u)?.[0] ?? "";

function fail(message) { throw new Error(message); }

export function verifyCardHourTopupRefundMigrationMirrors() {
  if (readFileSync(SQLITE_MIGRATION_URL, "utf8") !== readFileSync(D1_MIGRATION_URL, "utf8")) fail("MIGRATION_MIRROR_MISMATCH");
  return Object.freeze({ ready: true, sqliteMigration: "drizzle/0042_card_hour_topup_refunds.sql", d1Migration: ".openai/drizzle/0042_card_hour_topup_refunds.sql" });
}

function tableExists(database, name) {
  return Boolean(database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));
}

function normalizeTableSql(sql) {
  return sql.toLowerCase().replace(/create\s+table\s+if\s+not\s+exists/u, "create table").replace(/\s+/gu, "").replace(/;$/u, "");
}

function normalizeIndexSql(sql) {
  return sql.toLowerCase().replace(/create\s+(unique\s+)?index\s+if\s+not\s+exists/u, "create $1index").replace(/\s+/gu, "").replace(/;$/u, "");
}

function indexColumns(database, name) {
  return database.prepare(`PRAGMA index_info(${JSON.stringify(name)})`).all()
    .sort((left, right) => Number(left.seqno) - Number(right.seqno))
    .map((row) => String(row.name));
}

export function inspectCardHourTopupRefundSchema(database) {
  const initialized = tableExists(database, "card_hour_schema_migrations");
  const marker = initialized ? Number(database.prepare("SELECT COALESCE(MAX(version),0) version FROM card_hour_schema_migrations").get().version) : 0;
  const tableReady = tableExists(database, TABLE);
  const columns = tableReady ? database.prepare(`PRAGMA table_info(${TABLE})`).all().map((row) => String(row.name)) : [];
  const foreignKeys = tableReady ? database.prepare(`PRAGMA foreign_key_list(${TABLE})`).all() : [];
  const sql = tableReady ? String(database.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(TABLE)?.sql ?? "") : "";
  const indexes = tableReady ? database.prepare(`PRAGMA index_list(${TABLE})`).all() : [];
  const hasIndex = (name, unique, partial, expectedColumns, expectedSql) => indexes.some((row) => String(row.name) === name
    && Number(row.unique) === unique && Number(row.partial) === partial
    && JSON.stringify(indexColumns(database, name)) === JSON.stringify(expectedColumns)
    && normalizeIndexSql(String(database.prepare("SELECT sql FROM sqlite_master WHERE type='index' AND name=?").get(name)?.sql ?? "")) === normalizeIndexSql(expectedSql));
  const hasUniqueColumns = (expectedColumns) => indexes.some((row) => Number(row.unique) === 1
    && JSON.stringify(indexColumns(database, String(row.name))) === JSON.stringify(expectedColumns));
  return Object.freeze({
    initialized,
    marker,
    tableReady,
    missingIndexes: INDEXES.filter((name) => !indexes.some((row) => String(row.name) === name)),
    missingColumns: REQUIRED_COLUMNS.filter((name) => !columns.includes(name)),
    topupForeignKeyReady: foreignKeys.some((row) => row.table === "card_hour_topup_orders" && row.from === "topup_order_id" && row.to === "id"),
    tableDefinitionReady: normalizeTableSql(sql) === normalizeTableSql(EXPECTED_TABLE_SQL),
    topupOrderUniqueReady: hasUniqueColumns(["topup_order_id"]),
    providerRefundRequestUniqueReady: hasUniqueColumns(["provider_refund_request_id"]),
    statusIndexReady: hasIndex("card_hour_topup_refunds_status_idx", 0, 0, ["status", "updated_at"], EXPECTED_STATUS_INDEX_SQL),
    providerTransactionIndexReady: hasIndex("card_hour_topup_refunds_provider_tx_unique_idx", 1, 1, ["provider", "provider_transaction_id"], EXPECTED_PROVIDER_TX_INDEX_SQL),
  });
}

export function assertCardHourTopupRefundSchemaReady(database) {
  const state = inspectCardHourTopupRefundSchema(database);
  if (state.marker !== 7 || !state.tableReady || state.missingIndexes.length || state.missingColumns.length
    || !state.topupForeignKeyReady || !state.tableDefinitionReady || !state.topupOrderUniqueReady
    || !state.providerRefundRequestUniqueReady || !state.statusIndexReady || !state.providerTransactionIndexReady) fail(`CARD_HOUR_TOPUP_REFUND_SCHEMA_NOT_READY:${JSON.stringify(state)}`);
  if (database.prepare("PRAGMA foreign_key_check").all().length) fail("CARD_HOUR_TOPUP_REFUND_FOREIGN_KEY_FAILED");
  return Object.freeze({ ready: true, schemaMarker: state.marker, migration: "0042_card_hour_topup_refunds" });
}

export function applyCardHourTopupRefundMigration(database, migrationSql = readFileSync(SQLITE_MIGRATION_URL, "utf8")) {
  const before = inspectCardHourTopupRefundSchema(database);
  if (before.marker === 7) return assertCardHourTopupRefundSchemaReady(database);
  if (before.marker !== 6 || before.tableReady || before.missingIndexes.length !== INDEXES.length) fail(`CARD_HOUR_TOPUP_REFUND_SCHEMA_PARTIAL:${JSON.stringify(before)}`);
  database.exec("BEGIN IMMEDIATE");
  try {
    database.exec(migrationSql);
    const result = assertCardHourTopupRefundSchemaReady(database);
    database.exec("COMMIT");
    return result;
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

function parseArguments(argv) {
  const result = { databasePath: process.env.KAI_DB_PATH || `${process.env.KAI_DB_DIR || ".market-cache/marketplace"}/kai-cloud.sqlite`, apply: false, allowUninitialized: false };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--db") result.databasePath = argv[++index];
    else if (value === "--allow-uninitialized") result.allowUninitialized = true;
    else if (value === "--apply" && argv[index + 1] === "--confirm" && argv[index + 2] === "APPLY_0042_CARD_HOUR_TOPUP_REFUNDS") { result.apply = true; index += 2; }
    else fail("CARD_HOUR_TOPUP_REFUND_ARGUMENTS_INVALID");
  }
  return result;
}

export function verifyCardHourTopupRefundDatabase(options = {}) {
  verifyCardHourTopupRefundMigrationMirrors();
  if (!isAbsolute(options.databasePath)) fail("CARD_HOUR_TOPUP_REFUND_PATH_INVALID");
  const requestedPath = resolve(options.databasePath);
  let metadata;
  try { metadata = lstatSync(requestedPath); } catch (error) {
    if (options.allowUninitialized && error?.code === "ENOENT") return Object.freeze({ ready: true, initialized: false, cardHourInitialized: false });
    throw error;
  }
  if (!metadata.isFile() || metadata.isSymbolicLink()) fail("CARD_HOUR_TOPUP_REFUND_PATH_INVALID");
  const databasePath = realpathSync(requestedPath);
  const database = new DatabaseSync(databasePath, { readOnly: !options.apply });
  try {
    const state = inspectCardHourTopupRefundSchema(database);
    if (!state.initialized && options.allowUninitialized) return Object.freeze({ ready: true, initialized: false, cardHourInitialized: false });
    const verified = options.apply ? applyCardHourTopupRefundMigration(database) : assertCardHourTopupRefundSchemaReady(database);
    return Object.freeze({ ...verified, initialized: true, cardHourInitialized: true, databasePath });
  } finally { database.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { process.stdout.write(`${JSON.stringify({ status: "ok", ...verifyCardHourTopupRefundDatabase(parseArguments(process.argv.slice(2))) })}\n`); }
  catch (error) { process.stderr.write(`CARD_HOUR_TOPUP_REFUND_GATE_FAILED: ${error.message}\n`); process.exitCode = 1; }
}
