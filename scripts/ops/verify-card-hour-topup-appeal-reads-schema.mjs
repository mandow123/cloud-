#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const SQLITE_MIGRATION_URL = new URL("../../drizzle/0037_card_hour_topup_appeal_reads.sql", import.meta.url);
const D1_MIGRATION_URL = new URL("../../.openai/drizzle/0037_card_hour_topup_appeal_reads.sql", import.meta.url);
const BASE_TABLES = ["card_hour_schema_migrations", "card_hour_topup_appeals"];
const READ_TABLE = "card_hour_topup_appeal_member_reads";
const READ_INDEX = "card_hour_topup_appeal_member_reads_org_idx";

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
  if (options.apply && options.confirm !== "APPLY_0037_CARD_HOUR_TOPUP_APPEAL_READS") throw new Error("--apply requires --confirm APPLY_0037_CARD_HOUR_TOPUP_APPEAL_READS");
  if (options.apply && options.allowUninitialized) throw new Error("--apply cannot be combined with --allow-uninitialized");
  return options;
}

function objectNames(database, type, names) {
  const placeholders = names.map(() => "?").join(",");
  return new Set(database.prepare(`SELECT name FROM sqlite_master WHERE type=? AND name IN (${placeholders})`).all(type, ...names).map((row) => String(row.name)));
}

export function verifyCardHourTopupAppealReadMigrationMirrors() {
  const sqlite = readFileSync(SQLITE_MIGRATION_URL, "utf8");
  const d1 = readFileSync(D1_MIGRATION_URL, "utf8");
  if (sqlite !== d1) throw new Error("CARD_HOUR_TOPUP_APPEAL_READS_MIGRATION_MIRROR_MISMATCH");
  if (!sqlite.includes("VALUES(5,datetime('now'))")) throw new Error("CARD_HOUR_TOPUP_APPEAL_READS_MIGRATION_MARKER_INVALID");
  return Object.freeze({ ready: true, sqliteMigration: "drizzle/0037_card_hour_topup_appeal_reads.sql", d1Migration: ".openai/drizzle/0037_card_hour_topup_appeal_reads.sql" });
}

export function inspectCardHourTopupAppealReadSchema(database) {
  const marker = Number(database.prepare("SELECT COALESCE(MAX(version),0) version FROM card_hour_schema_migrations").get()?.version ?? 0);
  const tableReady = objectNames(database, "table", [READ_TABLE]).has(READ_TABLE);
  const indexReady = objectNames(database, "index", [READ_INDEX]).has(READ_INDEX);
  const foreignKeys = tableReady ? database.prepare(`PRAGMA foreign_key_list(${READ_TABLE})`).all() : [];
  const columns = tableReady ? database.prepare(`PRAGMA table_info(${READ_TABLE})`).all().map((row) => String(row.name)) : [];
  return {
    marker,
    tableReady,
    indexReady,
    appealForeignKeyReady: foreignKeys.some((row) => row.table === "card_hour_topup_appeals" && row.from === "appeal_id" && row.to === "id"),
    missingColumns: ["appeal_id", "organization_id", "seen_version", "seen_at"].filter((name) => !columns.includes(name)),
  };
}

export function assertCardHourTopupAppealReadSchemaReady(database) {
  const state = inspectCardHourTopupAppealReadSchema(database);
  if (state.marker < 5 || state.marker > 6) throw new Error(`CARD_HOUR_TOPUP_APPEAL_READS_SCHEMA_MARKER_INVALID:${state.marker}`);
  if (!state.tableReady || !state.indexReady || !state.appealForeignKeyReady || state.missingColumns.length) throw new Error(`CARD_HOUR_TOPUP_APPEAL_READS_SCHEMA_NOT_READY:${JSON.stringify(state)}`);
  if (database.prepare("PRAGMA foreign_key_check").all().length) throw new Error("CARD_HOUR_TOPUP_APPEAL_READS_FOREIGN_KEY_INVALID");
  return Object.freeze({ ready: true, schemaMarker: state.marker, migration: "0037_card_hour_topup_appeal_reads" });
}

export function applyCardHourTopupAppealReadMigration(database, migrationSql) {
  const before = inspectCardHourTopupAppealReadSchema(database);
  if (before.marker >= 5 && before.marker <= 6) return assertCardHourTopupAppealReadSchemaReady(database);
  if (before.marker !== 4) throw new Error(`CARD_HOUR_TOPUP_APPEAL_READS_SCHEMA_MARKER_INVALID:${before.marker}`);
  if (before.tableReady || before.indexReady || before.appealForeignKeyReady || before.missingColumns.length !== 4) throw new Error(`CARD_HOUR_TOPUP_APPEAL_READS_PARTIAL_MIGRATION:${JSON.stringify(before)}`);
  database.exec("BEGIN IMMEDIATE");
  try {
    database.exec(migrationSql);
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
  return assertCardHourTopupAppealReadSchemaReady(database);
}

function defaultDatabasePath() {
  if (process.env.KAI_DB_PATH?.trim()) return resolve(process.env.KAI_DB_PATH.trim());
  return resolve(join(process.env.KAI_DB_DIR?.trim() || process.env.KAI_DATA_DIR?.trim() || ".market-cache/marketplace", "kai-cloud.sqlite"));
}

export function verifyCardHourTopupAppealReadDatabase(options = {}) {
  verifyCardHourTopupAppealReadMigrationMirrors();
  const databasePath = resolve(options.databasePath ?? defaultDatabasePath());
  if (!existsSync(databasePath)) {
    if (options.allowUninitialized) return { ready: true, initialized: false, databasePath };
    throw new Error("CARD_HOUR_TOPUP_APPEAL_READS_DATABASE_MISSING");
  }
  const database = new DatabaseSync(databasePath, { readOnly: !options.apply });
  try {
    const base = objectNames(database, "table", BASE_TABLES);
    if (base.size === 0) {
      if (options.allowUninitialized && !options.apply) return { ready: true, initialized: true, cardHourInitialized: false, databasePath };
      throw new Error("CARD_HOUR_TOPUP_APPEAL_READS_SCHEMA_UNINITIALIZED");
    }
    if (base.size !== BASE_TABLES.length) throw new Error("CARD_HOUR_TOPUP_APPEAL_READS_BASE_SCHEMA_PARTIAL");
    const result = options.apply
      ? applyCardHourTopupAppealReadMigration(database, readFileSync(SQLITE_MIGRATION_URL, "utf8"))
      : assertCardHourTopupAppealReadSchemaReady(database);
    return { ...result, initialized: true, cardHourInitialized: true, databasePath };
  } finally { database.close(); }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  try { process.stdout.write(`${JSON.stringify({ status: "ok", ...verifyCardHourTopupAppealReadDatabase(parseArguments(process.argv.slice(2))) })}\n`); }
  catch (error) { process.stderr.write(`CARD_HOUR_TOPUP_APPEAL_READS_SCHEMA_CHECK_FAILED: ${error instanceof Error ? error.message : "UNKNOWN"}\n`); process.exitCode = 1; }
}
