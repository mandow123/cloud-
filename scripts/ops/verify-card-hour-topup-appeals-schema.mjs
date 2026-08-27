#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const SQLITE_MIGRATION_URL = new URL("../../drizzle/0036_card_hour_topup_appeals.sql", import.meta.url);
const D1_MIGRATION_URL = new URL("../../.openai/drizzle/0036_card_hour_topup_appeals.sql", import.meta.url);
const BASE_TABLES = ["card_hour_schema_migrations", "card_hour_topup_orders"];
const APPEAL_TABLES = ["card_hour_topup_appeals", "card_hour_topup_appeal_events"];
const APPEAL_INDEXES = ["card_hour_topup_appeals_admin_idx", "card_hour_topup_appeals_org_idx", "card_hour_topup_appeal_events_case_idx"];
const IMMUTABLE_TRIGGERS = ["card_hour_topup_appeal_events_immutable_update", "card_hour_topup_appeal_events_immutable_delete"];

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
  if (options.apply && options.confirm !== "APPLY_0036_CARD_HOUR_TOPUP_APPEALS") throw new Error("--apply requires --confirm APPLY_0036_CARD_HOUR_TOPUP_APPEALS");
  if (options.apply && options.allowUninitialized) throw new Error("--apply cannot be combined with --allow-uninitialized");
  return options;
}

export function verifyCardHourTopupAppealMigrationMirrors() {
  const sqlite = readFileSync(SQLITE_MIGRATION_URL, "utf8");
  const d1 = readFileSync(D1_MIGRATION_URL, "utf8");
  if (sqlite !== d1) throw new Error("CARD_HOUR_TOPUP_APPEALS_MIGRATION_MIRROR_MISMATCH");
  if (!sqlite.includes("VALUES(4,datetime('now'))")) throw new Error("CARD_HOUR_TOPUP_APPEALS_MIGRATION_MARKER_INVALID");
  return Object.freeze({ ready: true, sqliteMigration: "drizzle/0036_card_hour_topup_appeals.sql", d1Migration: ".openai/drizzle/0036_card_hour_topup_appeals.sql" });
}

function objectNames(database, type, names) {
  const placeholders = names.map(() => "?").join(",");
  return new Set(database.prepare(`SELECT name FROM sqlite_master WHERE type=? AND name IN (${placeholders})`).all(type, ...names).map((row) => String(row.name)));
}

export function inspectCardHourTopupAppealSchema(database) {
  const marker = Number(database.prepare("SELECT COALESCE(MAX(version),0) version FROM card_hour_schema_migrations").get()?.version ?? 0);
  const tables = objectNames(database, "table", APPEAL_TABLES);
  const indexes = objectNames(database, "index", APPEAL_INDEXES);
  const triggers = objectNames(database, "trigger", IMMUTABLE_TRIGGERS);
  const appealForeignKeys = tables.has("card_hour_topup_appeals") ? database.prepare("PRAGMA foreign_key_list(card_hour_topup_appeals)").all() : [];
  const eventForeignKeys = tables.has("card_hour_topup_appeal_events") ? database.prepare("PRAGMA foreign_key_list(card_hour_topup_appeal_events)").all() : [];
  return {
    marker,
    missingTables: APPEAL_TABLES.filter((name) => !tables.has(name)),
    missingIndexes: APPEAL_INDEXES.filter((name) => !indexes.has(name)),
    missingTriggers: IMMUTABLE_TRIGGERS.filter((name) => !triggers.has(name)),
    orderForeignKeyReady: appealForeignKeys.some((row) => row.table === "card_hour_topup_orders" && row.from === "topup_order_id" && row.to === "id"),
    eventForeignKeyReady: eventForeignKeys.some((row) => row.table === "card_hour_topup_appeals" && row.from === "appeal_id" && row.to === "id"),
  };
}

export function assertCardHourTopupAppealSchemaReady(database) {
  const state = inspectCardHourTopupAppealSchema(database);
  if (state.marker < 4 || state.marker > 7) throw new Error(`CARD_HOUR_TOPUP_APPEALS_SCHEMA_MARKER_INVALID:${state.marker}`);
  if (state.missingTables.length || state.missingIndexes.length || state.missingTriggers.length || !state.orderForeignKeyReady || !state.eventForeignKeyReady) throw new Error(`CARD_HOUR_TOPUP_APPEALS_SCHEMA_NOT_READY:${JSON.stringify(state)}`);
  if (database.prepare("PRAGMA foreign_key_check").all().length) throw new Error("CARD_HOUR_TOPUP_APPEALS_FOREIGN_KEY_INVALID");
  return Object.freeze({ ready: true, schemaMarker: state.marker, migration: "0036_card_hour_topup_appeals" });
}

export function applyCardHourTopupAppealMigration(database, migrationSql) {
  const before = inspectCardHourTopupAppealSchema(database);
  if (before.marker >= 4 && before.marker <= 7) return assertCardHourTopupAppealSchemaReady(database);
  if (before.marker !== 3) throw new Error(`CARD_HOUR_TOPUP_APPEALS_SCHEMA_MARKER_INVALID:${before.marker}`);
  if (before.missingTables.length !== APPEAL_TABLES.length || before.missingIndexes.length !== APPEAL_INDEXES.length || before.missingTriggers.length !== IMMUTABLE_TRIGGERS.length) throw new Error(`CARD_HOUR_TOPUP_APPEALS_PARTIAL_MIGRATION:${JSON.stringify(before)}`);
  database.exec(migrationSql);
  return assertCardHourTopupAppealSchemaReady(database);
}

function defaultDatabasePath() {
  if (process.env.KAI_DB_PATH?.trim()) return resolve(process.env.KAI_DB_PATH.trim());
  return resolve(join(process.env.KAI_DB_DIR?.trim() || process.env.KAI_DATA_DIR?.trim() || ".market-cache/marketplace", "kai-cloud.sqlite"));
}

export function verifyCardHourTopupAppealDatabase(options = {}) {
  verifyCardHourTopupAppealMigrationMirrors();
  const databasePath = resolve(options.databasePath ?? defaultDatabasePath());
  if (!existsSync(databasePath)) {
    if (options.allowUninitialized) return { ready: true, initialized: false, databasePath };
    throw new Error("CARD_HOUR_TOPUP_APPEALS_DATABASE_MISSING");
  }
  const database = new DatabaseSync(databasePath, { readOnly: !options.apply });
  try {
    const base = objectNames(database, "table", BASE_TABLES);
    if (base.size === 0) {
      if (options.allowUninitialized && !options.apply) return { ready: true, initialized: true, cardHourInitialized: false, databasePath };
      throw new Error("CARD_HOUR_TOPUP_APPEALS_SCHEMA_UNINITIALIZED");
    }
    if (base.size !== BASE_TABLES.length) throw new Error("CARD_HOUR_TOPUP_APPEALS_BASE_SCHEMA_PARTIAL");
    const result = options.apply
      ? applyCardHourTopupAppealMigration(database, readFileSync(SQLITE_MIGRATION_URL, "utf8"))
      : assertCardHourTopupAppealSchemaReady(database);
    return { ...result, initialized: true, cardHourInitialized: true, databasePath };
  } finally { database.close(); }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  try { process.stdout.write(`${JSON.stringify({ status: "ok", ...verifyCardHourTopupAppealDatabase(parseArguments(process.argv.slice(2))) })}\n`); }
  catch (error) { process.stderr.write(`CARD_HOUR_TOPUP_APPEALS_SCHEMA_CHECK_FAILED: ${error instanceof Error ? error.message : "UNKNOWN"}\n`); process.exitCode = 1; }
}
