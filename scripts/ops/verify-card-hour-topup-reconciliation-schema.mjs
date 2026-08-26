#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const SQLITE_MIGRATION_URL = new URL("../../drizzle/0038_card_hour_topup_reconciliation_claims.sql", import.meta.url);
const D1_MIGRATION_URL = new URL("../../.openai/drizzle/0038_card_hour_topup_reconciliation_claims.sql", import.meta.url);
const BASE_TABLES = ["card_hour_schema_migrations", "card_hour_topup_orders"];
const RECONCILIATION_TABLES = ["card_hour_topup_reconciliation_claims", "card_hour_topup_reconciliation_requests"];
const RECONCILIATION_INDEXES = ["card_hour_topup_reconciliation_due_idx", "card_hour_topup_reconciliation_requests_order_idx"];

function parseArguments(argv) {
  const options = { apply: false, allowUninitialized: false, databasePath: null, confirm: null };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--apply") { options.apply = true; continue; }
    if (argument === "--allow-uninitialized") { options.allowUninitialized = true; continue; }
    if (argument === "--database" || argument === "--confirm") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`${argument} requires a value`);
      if (argument === "--database") options.databasePath = resolve(value); else options.confirm = value;
      index += 1; continue;
    }
    throw new Error(`unknown argument: ${argument}`);
  }
  if (options.apply && options.confirm !== "APPLY_0038_CARD_HOUR_TOPUP_RECONCILIATION") throw new Error("--apply requires --confirm APPLY_0038_CARD_HOUR_TOPUP_RECONCILIATION");
  if (options.apply && options.allowUninitialized) throw new Error("--apply cannot be combined with --allow-uninitialized");
  return options;
}

function objectNames(database, type, names) {
  const placeholders = names.map(() => "?").join(",");
  return new Set(database.prepare(`SELECT name FROM sqlite_master WHERE type=? AND name IN (${placeholders})`).all(type, ...names).map((row) => String(row.name)));
}

export function verifyCardHourTopupReconciliationMigrationMirrors() {
  const sqlite = readFileSync(SQLITE_MIGRATION_URL, "utf8");
  const d1 = readFileSync(D1_MIGRATION_URL, "utf8");
  if (sqlite !== d1) throw new Error("CARD_HOUR_TOPUP_RECONCILIATION_MIGRATION_MIRROR_MISMATCH");
  if (!sqlite.includes("VALUES(6,datetime('now'))")) throw new Error("CARD_HOUR_TOPUP_RECONCILIATION_MIGRATION_MARKER_INVALID");
  return Object.freeze({ ready: true, sqliteMigration: "drizzle/0038_card_hour_topup_reconciliation_claims.sql", d1Migration: ".openai/drizzle/0038_card_hour_topup_reconciliation_claims.sql" });
}

export function inspectCardHourTopupReconciliationSchema(database) {
  const marker = Number(database.prepare("SELECT COALESCE(MAX(version),0) version FROM card_hour_schema_migrations").get()?.version ?? 0);
  const tables = objectNames(database, "table", RECONCILIATION_TABLES);
  const indexes = objectNames(database, "index", RECONCILIATION_INDEXES);
  const claimForeignKeys = tables.has(RECONCILIATION_TABLES[0]) ? database.prepare(`PRAGMA foreign_key_list(${RECONCILIATION_TABLES[0]})`).all() : [];
  const requestForeignKeys = tables.has(RECONCILIATION_TABLES[1]) ? database.prepare(`PRAGMA foreign_key_list(${RECONCILIATION_TABLES[1]})`).all() : [];
  const claimColumns = tables.has(RECONCILIATION_TABLES[0]) ? database.prepare(`PRAGMA table_info(${RECONCILIATION_TABLES[0]})`).all().map((row) => String(row.name)) : [];
  const requestColumns = tables.has(RECONCILIATION_TABLES[1]) ? database.prepare(`PRAGMA table_info(${RECONCILIATION_TABLES[1]})`).all().map((row) => String(row.name)) : [];
  return {
    marker,
    missingTables: RECONCILIATION_TABLES.filter((name) => !tables.has(name)),
    missingIndexes: RECONCILIATION_INDEXES.filter((name) => !indexes.has(name)),
    claimOrderForeignKeyReady: claimForeignKeys.some((row) => row.table === "card_hour_topup_orders" && row.from === "topup_order_id" && row.to === "id"),
    requestOrderForeignKeyReady: requestForeignKeys.some((row) => row.table === "card_hour_topup_orders" && row.from === "topup_order_id" && row.to === "id"),
    missingClaimColumns: ["topup_order_id", "organization_id", "claim_token", "claimed_at", "next_query_at", "attempt_count", "updated_at"].filter((name) => !claimColumns.includes(name)),
    missingRequestColumns: ["organization_id", "idempotency_key", "topup_order_id", "payload_hash", "created_at"].filter((name) => !requestColumns.includes(name)),
  };
}

export function assertCardHourTopupReconciliationSchemaReady(database) {
  const state = inspectCardHourTopupReconciliationSchema(database);
  if (state.marker < 6 || state.marker > 7) throw new Error(`CARD_HOUR_TOPUP_RECONCILIATION_SCHEMA_MARKER_INVALID:${state.marker}`);
  if (state.missingTables.length || state.missingIndexes.length || !state.claimOrderForeignKeyReady || !state.requestOrderForeignKeyReady || state.missingClaimColumns.length || state.missingRequestColumns.length) throw new Error(`CARD_HOUR_TOPUP_RECONCILIATION_SCHEMA_NOT_READY:${JSON.stringify(state)}`);
  if (database.prepare("PRAGMA foreign_key_check").all().length) throw new Error("CARD_HOUR_TOPUP_RECONCILIATION_FOREIGN_KEY_INVALID");
  return Object.freeze({ ready: true, schemaMarker: state.marker, migration: "0038_card_hour_topup_reconciliation_claims" });
}

export function applyCardHourTopupReconciliationMigration(database, migrationSql) {
  const before = inspectCardHourTopupReconciliationSchema(database);
  if (before.marker >= 6 && before.marker <= 7) return assertCardHourTopupReconciliationSchemaReady(database);
  if (before.marker !== 5) throw new Error(`CARD_HOUR_TOPUP_RECONCILIATION_SCHEMA_MARKER_INVALID:${before.marker}`);
  if (before.missingTables.length !== RECONCILIATION_TABLES.length || before.missingIndexes.length !== RECONCILIATION_INDEXES.length || before.claimOrderForeignKeyReady || before.requestOrderForeignKeyReady || before.missingClaimColumns.length !== 7 || before.missingRequestColumns.length !== 5) throw new Error(`CARD_HOUR_TOPUP_RECONCILIATION_PARTIAL_MIGRATION:${JSON.stringify(before)}`);
  database.exec("BEGIN IMMEDIATE");
  try {
    database.exec(migrationSql);
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
  return assertCardHourTopupReconciliationSchemaReady(database);
}

function defaultDatabasePath() {
  if (process.env.KAI_DB_PATH?.trim()) return resolve(process.env.KAI_DB_PATH.trim());
  return resolve(join(process.env.KAI_DB_DIR?.trim() || process.env.KAI_DATA_DIR?.trim() || ".market-cache/marketplace", "kai-cloud.sqlite"));
}

export function verifyCardHourTopupReconciliationDatabase(options = {}) {
  verifyCardHourTopupReconciliationMigrationMirrors();
  const databasePath = resolve(options.databasePath ?? defaultDatabasePath());
  if (!existsSync(databasePath)) {
    if (options.allowUninitialized) return { ready: true, initialized: false, databasePath };
    throw new Error("CARD_HOUR_TOPUP_RECONCILIATION_DATABASE_MISSING");
  }
  const database = new DatabaseSync(databasePath, { readOnly: !options.apply });
  try {
    const base = objectNames(database, "table", BASE_TABLES);
    if (base.size === 0) {
      if (options.allowUninitialized && !options.apply) return { ready: true, initialized: true, cardHourInitialized: false, databasePath };
      throw new Error("CARD_HOUR_TOPUP_RECONCILIATION_SCHEMA_UNINITIALIZED");
    }
    if (base.size !== BASE_TABLES.length) throw new Error("CARD_HOUR_TOPUP_RECONCILIATION_BASE_SCHEMA_PARTIAL");
    const result = options.apply
      ? applyCardHourTopupReconciliationMigration(database, readFileSync(SQLITE_MIGRATION_URL, "utf8"))
      : assertCardHourTopupReconciliationSchemaReady(database);
    return { ...result, initialized: true, cardHourInitialized: true, databasePath };
  } finally { database.close(); }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  try { process.stdout.write(`${JSON.stringify({ status: "ok", ...verifyCardHourTopupReconciliationDatabase(parseArguments(process.argv.slice(2))) })}\n`); }
  catch (error) { process.stderr.write(`CARD_HOUR_TOPUP_RECONCILIATION_SCHEMA_CHECK_FAILED: ${error instanceof Error ? error.message : "UNKNOWN"}\n`); process.exitCode = 1; }
}
