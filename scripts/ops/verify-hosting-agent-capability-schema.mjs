#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const REQUIRED_COLUMNS = Object.freeze({
  hosting_v2_agent_challenges: ["application_id", "capability_mode"],
  hosting_v2_devices: ["application_id", "capability_mode"],
});

const REQUIRED_INDEXES = Object.freeze({
  hosting_v2_challenge_application_idx: ["application_id", "capability_mode", "expires_at"],
  hosting_v2_devices_application_idx: ["application_id", "capability_mode", "status"],
});

function parseArguments(argv) {
  const options = { apply: false, allowUninitialized: false, databasePath: null, confirm: null };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--apply") { options.apply = true; continue; }
    if (argument === "--allow-uninitialized") { options.allowUninitialized = true; continue; }
    if (argument === "--database" || argument === "--confirm") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`${argument} requires a value`);
      if (argument === "--database") options.databasePath = resolve(value);
      else options.confirm = value;
      index += 1;
      continue;
    }
    throw new Error(`unknown argument: ${argument}`);
  }
  if (options.apply && options.confirm !== "APPLY_0032_HOSTING_AGENT_CAPABILITY_MODES") {
    throw new Error("--apply requires --confirm APPLY_0032_HOSTING_AGENT_CAPABILITY_MODES");
  }
  if (options.apply && options.allowUninitialized) throw new Error("--apply cannot be combined with --allow-uninitialized");
  return options;
}

function quotedIdentifier(value) {
  if (!/^[a-z][a-z0-9_]{1,80}$/u.test(value)) throw new Error("HOSTING_AGENT_CAPABILITY_SCHEMA_IDENTIFIER_INVALID");
  return `"${value}"`;
}

function tableColumns(database, table) {
  return database.prepare(`PRAGMA table_info(${quotedIdentifier(table)})`).all().map((row) => String(row.name));
}

function indexColumns(database, index) {
  return database.prepare(`PRAGMA index_info(${quotedIdentifier(index)})`).all().map((row) => String(row.name));
}

export function inspectHostingAgentCapabilitySchema(database) {
  const migrationTable = database.prepare("SELECT 1 present FROM sqlite_master WHERE type='table' AND name='hosting_v2_schema_migrations'").get();
  const marker = migrationTable
    ? Number(database.prepare("SELECT COALESCE(MAX(version),0) version FROM hosting_v2_schema_migrations").get()?.version ?? 0)
    : 0;
  const missingColumns = [];
  for (const [table, required] of Object.entries(REQUIRED_COLUMNS)) {
    const available = new Set(tableColumns(database, table));
    for (const column of required) if (!available.has(column)) missingColumns.push(`${table}.${column}`);
  }
  const missingIndexes = [];
  const invalidIndexes = [];
  for (const [index, required] of Object.entries(REQUIRED_INDEXES)) {
    const available = indexColumns(database, index);
    if (available.length === 0) missingIndexes.push(index);
    else if (available.join(",") !== required.join(",")) invalidIndexes.push(index);
  }
  return { marker, missingColumns, missingIndexes, invalidIndexes };
}

export function assertHostingAgentCapabilitySchemaReady(database) {
  const state = inspectHostingAgentCapabilitySchema(database);
  if (state.marker !== 14) throw new Error(`HOSTING_AGENT_CAPABILITY_SCHEMA_MARKER_INVALID:${state.marker}`);
  if (state.missingColumns.length || state.missingIndexes.length || state.invalidIndexes.length) {
    throw new Error(`HOSTING_AGENT_CAPABILITY_SCHEMA_NOT_READY:${JSON.stringify(state)}`);
  }
  return Object.freeze({ ready: true, schemaMarker: state.marker, migration: "0032_hosting_agent_capability_modes" });
}

function hostingSchemaObjectPresence(database) {
  const required = ["hosting_v2_schema_migrations", "hosting_v2_agent_challenges", "hosting_v2_devices"];
  const rows = database.prepare(`SELECT name FROM sqlite_master
    WHERE type='table' AND name IN ('hosting_v2_schema_migrations','hosting_v2_agent_challenges','hosting_v2_devices')`).all();
  const present = new Set(rows.map((row) => String(row.name)));
  return {
    present: required.filter((name) => present.has(name)),
    missing: required.filter((name) => !present.has(name)),
  };
}

export function applyHostingAgentCapabilityMigration(database, migrationSql) {
  const before = inspectHostingAgentCapabilitySchema(database);
  if (before.marker !== 14) throw new Error(`HOSTING_AGENT_CAPABILITY_SCHEMA_MARKER_INVALID:${before.marker}`);
  if (before.invalidIndexes.length) throw new Error(`HOSTING_AGENT_CAPABILITY_SCHEMA_INDEX_INVALID:${before.invalidIndexes.join(",")}`);
  if (before.missingColumns.length === 0 && before.missingIndexes.length === 0) return assertHostingAgentCapabilitySchemaReady(database);
  if (before.missingColumns.length !== 4) {
    throw new Error(`HOSTING_AGENT_CAPABILITY_SCHEMA_PARTIAL_MIGRATION:${JSON.stringify(before)}`);
  }
  database.exec("BEGIN IMMEDIATE");
  try {
    database.exec(migrationSql);
    database.exec("COMMIT");
  } catch (error) {
    try { database.exec("ROLLBACK"); } catch { /* Transaction may already be closed. */ }
    throw error;
  }
  return assertHostingAgentCapabilitySchemaReady(database);
}

function defaultDatabasePath() {
  if (process.env.KAI_DB_PATH?.trim()) return resolve(process.env.KAI_DB_PATH.trim());
  return resolve(join(process.env.KAI_DB_DIR?.trim() || process.env.KAI_DATA_DIR?.trim() || ".market-cache/marketplace", "kai-cloud.sqlite"));
}

export function verifyHostingAgentCapabilityDatabase(options = {}) {
  const databasePath = resolve(options.databasePath ?? defaultDatabasePath());
  if (!existsSync(databasePath)) {
    if (options.allowUninitialized) return { ready: true, initialized: false, databasePath };
    throw new Error("HOSTING_AGENT_CAPABILITY_DATABASE_MISSING");
  }
  const database = new DatabaseSync(databasePath, { readOnly: !options.apply });
  try {
    const objects = hostingSchemaObjectPresence(database);
    if (objects.present.length === 0) {
      if (options.allowUninitialized && !options.apply) {
        return { ready: true, initialized: true, hostingInitialized: false, databasePath };
      }
      throw new Error("HOSTING_AGENT_CAPABILITY_SCHEMA_UNINITIALIZED");
    }
    if (objects.missing.length > 0) {
      throw new Error(`HOSTING_AGENT_CAPABILITY_SCHEMA_PARTIAL:${JSON.stringify(objects)}`);
    }
    const result = options.apply
      ? applyHostingAgentCapabilityMigration(database, readFileSync(new URL("../../drizzle/0032_hosting_agent_capability_modes.sql", import.meta.url), "utf8"))
      : assertHostingAgentCapabilitySchemaReady(database);
    return { ...result, initialized: true, hostingInitialized: true, databasePath };
  } finally {
    database.close();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  try {
    const options = parseArguments(process.argv.slice(2));
    const result = verifyHostingAgentCapabilityDatabase(options);
    process.stdout.write(`${JSON.stringify({ status: "ok", ...result })}\n`);
  } catch (error) {
    process.stderr.write(`HOSTING_AGENT_CAPABILITY_SCHEMA_CHECK_FAILED: ${error instanceof Error ? error.message : "UNKNOWN"}\n`);
    process.exitCode = 1;
  }
}
