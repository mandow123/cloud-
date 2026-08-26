#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const SQLITE_MIGRATION_URL = new URL("../../drizzle/0039_card_hour_payment_production_closure.sql", import.meta.url);
const D1_MIGRATION_URL = new URL("../../.openai/drizzle/0039_card_hour_payment_production_closure.sql", import.meta.url);
const BASE_TABLES = ["card_hour_schema_migrations", "card_hour_topup_orders"];
const TABLES = ["card_hour_qixiang_query_protection", "card_hour_paid_entitlement_lots", "card_hour_paid_entitlement_hold_allocations", "card_hour_paid_entitlement_events"];
const INDEXES = ["card_hour_paid_entitlement_expiry_idx", "card_hour_paid_entitlement_hold_lot_idx", "card_hour_paid_entitlement_events_org_time_idx"];
const TRIGGERS = ["card_hour_paid_entitlement_events_immutable_update", "card_hour_paid_entitlement_events_immutable_delete"];

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
  if (options.apply && options.confirm !== "APPLY_0039_CARD_HOUR_PAYMENT_PRODUCTION_CLOSURE") throw new Error("--apply requires --confirm APPLY_0039_CARD_HOUR_PAYMENT_PRODUCTION_CLOSURE");
  if (options.apply && options.allowUninitialized) throw new Error("--apply cannot be combined with --allow-uninitialized");
  return options;
}

function objectNames(database, type, names) {
  const placeholders = names.map(() => "?").join(",");
  return new Set(database.prepare(`SELECT name FROM sqlite_master WHERE type=? AND name IN (${placeholders})`).all(type, ...names).map((row) => String(row.name)));
}

export function verifyCardHourPaymentProductionClosureMigrationMirrors() {
  const sqlite = readFileSync(SQLITE_MIGRATION_URL, "utf8");
  const d1 = readFileSync(D1_MIGRATION_URL, "utf8");
  if (sqlite !== d1) throw new Error("CARD_HOUR_PAYMENT_PRODUCTION_CLOSURE_MIGRATION_MIRROR_MISMATCH");
  if (!sqlite.includes("VALUES(7,datetime('now'))") || !sqlite.includes("364-day")) throw new Error("CARD_HOUR_PAYMENT_PRODUCTION_CLOSURE_MIGRATION_MARKER_INVALID");
  return Object.freeze({ ready: true, sqliteMigration: "drizzle/0039_card_hour_payment_production_closure.sql", d1Migration: ".openai/drizzle/0039_card_hour_payment_production_closure.sql" });
}

export function inspectCardHourPaymentProductionClosureSchema(database) {
  const marker = Number(database.prepare("SELECT COALESCE(MAX(version),0) version FROM card_hour_schema_migrations").get()?.version ?? 0);
  const tables = objectNames(database, "table", TABLES);
  const indexes = objectNames(database, "index", INDEXES);
  const triggers = objectNames(database, "trigger", TRIGGERS);
  const lotForeignKeys = tables.has("card_hour_paid_entitlement_lots") ? database.prepare("PRAGMA foreign_key_list(card_hour_paid_entitlement_lots)").all() : [];
  const allocationForeignKeys = tables.has("card_hour_paid_entitlement_hold_allocations") ? database.prepare("PRAGMA foreign_key_list(card_hour_paid_entitlement_hold_allocations)").all() : [];
  return {
    marker,
    missingTables: TABLES.filter((name) => !tables.has(name)),
    missingIndexes: INDEXES.filter((name) => !indexes.has(name)),
    missingTriggers: TRIGGERS.filter((name) => !triggers.has(name)),
    lotOrderForeignKeyReady: lotForeignKeys.some((row) => row.table === "card_hour_topup_orders" && row.from === "topup_order_id" && row.to === "id"),
    allocationLotForeignKeyReady: allocationForeignKeys.some((row) => row.table === "card_hour_paid_entitlement_lots" && row.from === "lot_id" && row.to === "id"),
  };
}

export function assertCardHourPaymentProductionClosureSchemaReady(database) {
  const state = inspectCardHourPaymentProductionClosureSchema(database);
  if (state.marker !== 7) throw new Error(`CARD_HOUR_PAYMENT_PRODUCTION_CLOSURE_SCHEMA_MARKER_INVALID:${state.marker}`);
  if (state.missingTables.length || state.missingIndexes.length || state.missingTriggers.length || !state.lotOrderForeignKeyReady || !state.allocationLotForeignKeyReady) throw new Error(`CARD_HOUR_PAYMENT_PRODUCTION_CLOSURE_SCHEMA_NOT_READY:${JSON.stringify(state)}`);
  if (database.prepare("PRAGMA foreign_key_check").all().length) throw new Error("CARD_HOUR_PAYMENT_PRODUCTION_CLOSURE_FOREIGN_KEY_INVALID");
  return Object.freeze({ ready: true, schemaMarker: state.marker, migration: "0039_card_hour_payment_production_closure" });
}

export function applyCardHourPaymentProductionClosureMigration(database, migrationSql) {
  const before = inspectCardHourPaymentProductionClosureSchema(database);
  if (before.marker === 7) return assertCardHourPaymentProductionClosureSchemaReady(database);
  if (before.marker !== 6) throw new Error(`CARD_HOUR_PAYMENT_PRODUCTION_CLOSURE_SCHEMA_MARKER_INVALID:${before.marker}`);
  if (before.missingTables.length !== TABLES.length || before.missingIndexes.length !== INDEXES.length || before.missingTriggers.length !== TRIGGERS.length || before.lotOrderForeignKeyReady || before.allocationLotForeignKeyReady) throw new Error(`CARD_HOUR_PAYMENT_PRODUCTION_CLOSURE_PARTIAL_MIGRATION:${JSON.stringify(before)}`);
  database.exec("BEGIN IMMEDIATE");
  try { database.exec(migrationSql); database.exec("COMMIT"); }
  catch (error) { database.exec("ROLLBACK"); throw error; }
  return assertCardHourPaymentProductionClosureSchemaReady(database);
}

function defaultDatabasePath() {
  if (process.env.KAI_DB_PATH?.trim()) return resolve(process.env.KAI_DB_PATH.trim());
  return resolve(join(process.env.KAI_DB_DIR?.trim() || process.env.KAI_DATA_DIR?.trim() || ".market-cache/marketplace", "kai-cloud.sqlite"));
}

export function verifyCardHourPaymentProductionClosureDatabase(options = {}) {
  verifyCardHourPaymentProductionClosureMigrationMirrors();
  const databasePath = resolve(options.databasePath ?? defaultDatabasePath());
  if (!existsSync(databasePath)) {
    if (options.allowUninitialized) return { ready: true, initialized: false, databasePath };
    throw new Error("CARD_HOUR_PAYMENT_PRODUCTION_CLOSURE_DATABASE_MISSING");
  }
  const database = new DatabaseSync(databasePath, { readOnly: !options.apply });
  try {
    const base = objectNames(database, "table", BASE_TABLES);
    if (base.size === 0) {
      if (options.allowUninitialized && !options.apply) return { ready: true, initialized: true, cardHourInitialized: false, databasePath };
      throw new Error("CARD_HOUR_PAYMENT_PRODUCTION_CLOSURE_SCHEMA_UNINITIALIZED");
    }
    if (base.size !== BASE_TABLES.length) throw new Error("CARD_HOUR_PAYMENT_PRODUCTION_CLOSURE_BASE_SCHEMA_PARTIAL");
    const result = options.apply ? applyCardHourPaymentProductionClosureMigration(database, readFileSync(SQLITE_MIGRATION_URL, "utf8")) : assertCardHourPaymentProductionClosureSchemaReady(database);
    return { ...result, initialized: true, cardHourInitialized: true, databasePath };
  } finally { database.close(); }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  try { process.stdout.write(`${JSON.stringify({ status: "ok", ...verifyCardHourPaymentProductionClosureDatabase(parseArguments(process.argv.slice(2))) })}\n`); }
  catch (error) { process.stderr.write(`CARD_HOUR_PAYMENT_PRODUCTION_CLOSURE_SCHEMA_CHECK_FAILED: ${error instanceof Error ? error.message : "UNKNOWN"}\n`); process.exitCode = 1; }
}
