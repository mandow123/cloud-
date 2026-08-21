#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const REQUIRED_COLUMNS = ["provider_merchant_ref", "provider_payment_type", "checkout_url", "checkout_created_at"];
const REQUIRED_TABLES = ["card_hour_schema_migrations", "card_hour_topup_orders", "card_hour_topup_events"];

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
  if (options.apply && options.confirm !== "APPLY_0033_QIXIANG_CARD_HOUR_TOPUPS") throw new Error("--apply requires --confirm APPLY_0033_QIXIANG_CARD_HOUR_TOPUPS");
  if (options.apply && options.allowUninitialized) throw new Error("--apply cannot be combined with --allow-uninitialized");
  return options;
}

function tablePresence(database) {
  const rows = database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('card_hour_schema_migrations','card_hour_topup_orders','card_hour_topup_events')").all();
  const present = new Set(rows.map((row) => String(row.name)));
  return { present: REQUIRED_TABLES.filter((name) => present.has(name)), missing: REQUIRED_TABLES.filter((name) => !present.has(name)) };
}

export function inspectQixiangCardHourSchema(database) {
  const marker = Number(database.prepare("SELECT COALESCE(MAX(version),0) version FROM card_hour_schema_migrations").get()?.version ?? 0);
  const columns = database.prepare("PRAGMA table_info(card_hour_topup_orders)").all().map((row) => String(row.name));
  const sql = String(database.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='card_hour_topup_orders'").get()?.sql ?? "");
  return {
    marker,
    missingColumns: REQUIRED_COLUMNS.filter((name) => !columns.includes(name)),
    providerReady: sql.includes("QIXIANG_PAY"),
    reconciliationReady: sql.includes("RECONCILIATION_REQUIRED"),
    checkoutInvariantReady: sql.includes("checkout_url IS NULL AND checkout_created_at IS NULL"),
  };
}

export function assertQixiangCardHourSchemaReady(database) {
  const state = inspectQixiangCardHourSchema(database);
  if (state.marker !== 3) throw new Error(`QIXIANG_CARD_HOUR_SCHEMA_MARKER_INVALID:${state.marker}`);
  if (state.missingColumns.length || !state.providerReady || !state.reconciliationReady || !state.checkoutInvariantReady) throw new Error(`QIXIANG_CARD_HOUR_SCHEMA_NOT_READY:${JSON.stringify(state)}`);
  if (database.prepare("PRAGMA foreign_key_check").all().length) throw new Error("QIXIANG_CARD_HOUR_SCHEMA_FOREIGN_KEY_INVALID");
  return Object.freeze({ ready: true, schemaMarker: 3, migration: "0033_qixiang_pay_card_hour_topups" });
}

export function applyQixiangCardHourMigration(database, migrationSql) {
  const before = inspectQixiangCardHourSchema(database);
  if (before.marker !== 3) throw new Error(`QIXIANG_CARD_HOUR_SCHEMA_MARKER_INVALID:${before.marker}`);
  if (before.missingColumns.length === 0 && before.providerReady && before.reconciliationReady && before.checkoutInvariantReady) return assertQixiangCardHourSchemaReady(database);
  if (before.missingColumns.length !== REQUIRED_COLUMNS.length || before.providerReady || before.reconciliationReady || before.checkoutInvariantReady) throw new Error(`QIXIANG_CARD_HOUR_SCHEMA_PARTIAL_MIGRATION:${JSON.stringify(before)}`);
  database.exec(migrationSql);
  return assertQixiangCardHourSchemaReady(database);
}

function defaultDatabasePath() {
  if (process.env.KAI_DB_PATH?.trim()) return resolve(process.env.KAI_DB_PATH.trim());
  return resolve(join(process.env.KAI_DB_DIR?.trim() || process.env.KAI_DATA_DIR?.trim() || ".market-cache/marketplace", "kai-cloud.sqlite"));
}

export function verifyQixiangCardHourDatabase(options = {}) {
  const databasePath = resolve(options.databasePath ?? defaultDatabasePath());
  if (!existsSync(databasePath)) {
    if (options.allowUninitialized) return { ready: true, initialized: false, databasePath };
    throw new Error("QIXIANG_CARD_HOUR_DATABASE_MISSING");
  }
  const database = new DatabaseSync(databasePath, { readOnly: !options.apply });
  try {
    const objects = tablePresence(database);
    if (objects.present.length === 0) {
      if (options.allowUninitialized && !options.apply) return { ready: true, initialized: true, cardHourInitialized: false, databasePath };
      throw new Error("QIXIANG_CARD_HOUR_SCHEMA_UNINITIALIZED");
    }
    if (objects.missing.length) throw new Error(`QIXIANG_CARD_HOUR_SCHEMA_PARTIAL:${JSON.stringify(objects)}`);
    const result = options.apply
      ? applyQixiangCardHourMigration(database, readFileSync(new URL("../../drizzle/0033_qixiang_pay_card_hour_topups.sql", import.meta.url), "utf8"))
      : assertQixiangCardHourSchemaReady(database);
    return { ...result, initialized: true, cardHourInitialized: true, databasePath };
  } finally { database.close(); }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  try { process.stdout.write(`${JSON.stringify({ status: "ok", ...verifyQixiangCardHourDatabase(parseArguments(process.argv.slice(2))) })}\n`); }
  catch (error) { process.stderr.write(`QIXIANG_CARD_HOUR_SCHEMA_CHECK_FAILED: ${error instanceof Error ? error.message : "UNKNOWN"}\n`); process.exitCode = 1; }
}
