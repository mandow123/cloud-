#!/usr/bin/env node

import { createHash, randomUUID } from "node:crypto";
import {
  constants as fsConstants,
  chmod,
  copyFile,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";

export const BACKUP_SCHEMA = "kai-cloud-backup/1";

const BACKUP_NAME_PATTERN = /^kai-cloud-backup-(\d{8}T\d{9}Z)-([0-9a-f]{8})$/;
function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function parseRetention(value, fallback, name) {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 10_000) {
    fail("INVALID_RETENTION", `${name} must be an integer between 0 and 10000`);
  }
  return parsed;
}

function retentionFromEnvironment() {
  return {
    hourly: parseRetention(process.env.KAI_BACKUP_RETENTION_HOURLY, 48, "KAI_BACKUP_RETENTION_HOURLY"),
    daily: parseRetention(process.env.KAI_BACKUP_RETENTION_DAILY, 35, "KAI_BACKUP_RETENTION_DAILY"),
    monthly: parseRetention(process.env.KAI_BACKUP_RETENTION_MONTHLY, 12, "KAI_BACKUP_RETENTION_MONTHLY"),
  };
}

function defaultPaths() {
  const configuredDatabaseDirectory = process.env.KAI_DB_DIR ?? process.env.KAI_DATA_DIR;
  const databaseDirectory = configuredDatabaseDirectory
    ? resolve(configuredDatabaseDirectory)
    : resolve(process.cwd(), ".market-cache", "marketplace");
  const marketDirectory = process.env.KAI_MARKET_DATA_DIR
    ? resolve(process.env.KAI_MARKET_DATA_DIR)
    : resolve(process.cwd(), "data");
  return {
    databasePath: resolve(process.env.KAI_DB_PATH ?? join(databaseDirectory, "kai-cloud.sqlite")),
    marketPath: resolve(process.env.KAI_MARKET_SNAPSHOT_PATH ?? join(marketDirectory, "model-market.snapshot.json")),
    backupRoot: resolve(process.env.KAI_BACKUP_DIR ?? join(process.cwd(), ".market-cache", "backups")),
  };
}

function assertSafeRoot(path, name) {
  if (!isAbsolute(path)) fail("UNSAFE_PATH", `${name} must be absolute`);
  const parsed = resolve(path);
  if (parsed === dirname(parsed)) fail("UNSAFE_PATH", `${name} cannot be a filesystem root`);
}

function assertDirectChild(root, path, name) {
  const relation = relative(resolve(root), resolve(path));
  if (!relation || relation.startsWith(`..${sep}`) || relation === ".." || isAbsolute(relation) || relation.includes(sep)) {
    fail("UNSAFE_PATH", `${name} must be a direct child of the backup root`);
  }
}

function sqlString(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function sqlIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

async function assertRegularFile(path, code) {
  let metadata;
  try {
    metadata = await lstat(path);
  } catch (error) {
    if (error?.code === "ENOENT") fail(code, `${path} does not exist`);
    throw error;
  }
  if (!metadata.isFile() || metadata.isSymbolicLink()) fail(code, `${path} must be a regular file`);
  return metadata;
}

async function syncPath(path) {
  let handle;
  try {
    handle = await open(path, "r");
    await handle.sync();
  } catch (error) {
    if (!new Set(["EINVAL", "EPERM", "EISDIR", "ENOTSUP"]).has(error?.code)) throw error;
  } finally {
    await handle?.close();
  }
}

export async function sha256File(path) {
  const handle = await open(path, "r");
  const hash = createHash("sha256");
  try {
    for await (const chunk of handle.readableWebStream()) hash.update(Buffer.from(chunk));
  } finally {
    await handle.close();
  }
  return hash.digest("hex");
}

function checkRows(rows, key, code) {
  if (rows.length !== 1 || rows[0]?.[key] !== "ok") fail(code, `${key} did not return ok`);
}

export function inspectDatabase(databasePath) {
  const database = new DatabaseSync(databasePath, { readOnly: true, enableForeignKeyConstraints: true });
  try {
    const quickCheck = database.prepare("PRAGMA quick_check").all();
    checkRows(quickCheck, "quick_check", "DATABASE_QUICK_CHECK_FAILED");
    const foreignKeyViolations = database.prepare("PRAGMA foreign_key_check").all();
    if (foreignKeyViolations.length > 0) {
      fail("DATABASE_FOREIGN_KEY_CHECK_FAILED", `database has ${foreignKeyViolations.length} foreign key violation(s)`);
    }
    const userVersionRow = database.prepare("PRAGMA user_version").get();
    const tableRows = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
    const tables = tableRows.map((row) => String(row.name));
    const counts = {};
    for (const table of tables) {
      counts[table] = Number(database.prepare(`SELECT COUNT(*) AS count FROM ${sqlIdentifier(table)}`).get().count);
    }
    return {
      quickCheck: "ok",
      foreignKeyViolations: 0,
      userVersion: Number(userVersionRow?.user_version ?? 0),
      tables,
      counts,
    };
  } finally {
    database.close();
  }
}

export async function inspectMarketSnapshot(snapshotPath) {
  const value = JSON.parse(await readFile(snapshotPath, "utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("INVALID_MARKET_SNAPSHOT", "market snapshot must be a JSON object");
  }
  if (value.schemaVersion !== "kai-model-market-snapshot/1"
    || typeof value.publishedAt !== "string"
    || !Array.isArray(value.quotes)
    || !value.index
    || typeof value.index !== "object") {
    fail("INVALID_MARKET_SNAPSHOT", "market snapshot does not satisfy kai-model-market-snapshot/1");
  }
  const publishedAt = Date.parse(value.publishedAt);
  const indexCurrent = Number(value.index.current);
  if (!Number.isFinite(publishedAt) || !Number.isFinite(indexCurrent)) {
    fail("INVALID_MARKET_SNAPSHOT", "market snapshot has an invalid publication time or index value");
  }
  return {
    schemaVersion: value.schemaVersion,
    publishedAt: value.publishedAt,
    quoteCount: value.quotes.length,
    indexCurrent,
  };
}

function backupName(now) {
  const timestamp = now.toISOString().replaceAll("-", "").replaceAll(":", "").replace(".", "");
  return `kai-cloud-backup-${timestamp}-${randomUUID().slice(0, 8)}`;
}

async function readBackupMetadata(backupRoot, entry) {
  if (!BACKUP_NAME_PATTERN.test(entry.name)) return null;
  const bundlePath = join(backupRoot, entry.name);
  const metadata = await lstat(bundlePath);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) return null;
  try {
    const manifest = JSON.parse(await readFile(join(bundlePath, "manifest.json"), "utf8"));
    if (manifest?.schemaVersion !== BACKUP_SCHEMA || typeof manifest.createdAt !== "string") return null;
    const createdAt = new Date(manifest.createdAt);
    if (!Number.isFinite(createdAt.getTime())) return null;
    return { name: entry.name, path: bundlePath, createdAt };
  } catch {
    return null;
  }
}

export async function applyRetention(backupRoot, retention, options = {}) {
  const entries = await readdir(backupRoot, { withFileTypes: true });
  const candidates = (await Promise.all(entries.map((entry) => readBackupMetadata(backupRoot, entry))))
    .filter(Boolean)
    .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());
  const keep = new Set(candidates.slice(0, retention.hourly).map((entry) => entry.name));
  for (const name of options.protectedNames ?? []) {
    if (BACKUP_NAME_PATTERN.test(name)) keep.add(name);
  }
  const daily = new Set();
  const monthly = new Set();
  for (const entry of candidates) {
    const day = entry.createdAt.toISOString().slice(0, 10);
    if (daily.size < retention.daily && !daily.has(day)) {
      daily.add(day);
      keep.add(entry.name);
    }
    const month = entry.createdAt.toISOString().slice(0, 7);
    if (monthly.size < retention.monthly && !monthly.has(month)) {
      monthly.add(month);
      keep.add(entry.name);
    }
  }
  const pruned = [];
  for (const entry of candidates) {
    if (keep.has(entry.name)) continue;
    assertDirectChild(backupRoot, entry.path, "retention target");
    await rm(entry.path, { recursive: true, force: false });
    pruned.push(entry.name);
  }
  await syncPath(backupRoot);
  return { retained: candidates.length - pruned.length, pruned };
}

async function vacuumInto(databasePath, outputPath) {
  const database = new DatabaseSync(databasePath, { enableForeignKeyConstraints: true });
  try {
    database.exec("PRAGMA busy_timeout = 10000");
    const quickCheck = database.prepare("PRAGMA quick_check").all();
    checkRows(quickCheck, "quick_check", "SOURCE_DATABASE_QUICK_CHECK_FAILED");
    const foreignKeyViolations = database.prepare("PRAGMA foreign_key_check").all();
    if (foreignKeyViolations.length > 0) {
      fail("SOURCE_DATABASE_FOREIGN_KEY_CHECK_FAILED", `source database has ${foreignKeyViolations.length} foreign key violation(s)`);
    }
    database.exec(`VACUUM INTO ${sqlString(outputPath)}`);
  } finally {
    database.close();
  }
}

export async function createBackup(options = {}) {
  const defaults = defaultPaths();
  const databasePath = resolve(options.databasePath ?? defaults.databasePath);
  const marketPath = resolve(options.marketPath ?? defaults.marketPath);
  const backupRoot = resolve(options.backupRoot ?? defaults.backupRoot);
  const retention = options.retention ?? retentionFromEnvironment();
  if (retention.hourly + retention.daily + retention.monthly < 1) {
    fail("INVALID_RETENTION", "at least one backup retention tier must keep a recovery bundle");
  }
  const now = options.now ? new Date(options.now) : new Date();
  if (!Number.isFinite(now.getTime())) fail("INVALID_TIME", "backup time is invalid");
  assertSafeRoot(backupRoot, "backup root");
  await assertRegularFile(databasePath, "DATABASE_NOT_FOUND");
  await assertRegularFile(marketPath, "MARKET_SNAPSHOT_NOT_FOUND");
  await mkdir(backupRoot, { recursive: true, mode: 0o750 });

  const name = backupName(now);
  const stagingPath = join(backupRoot, `.partial-${name}`);
  const finalPath = join(backupRoot, name);
  assertDirectChild(backupRoot, stagingPath, "staging backup");
  assertDirectChild(backupRoot, finalPath, "final backup");
  await mkdir(stagingPath, { recursive: false, mode: 0o750 });

  try {
    const databaseFile = "kai-cloud.sqlite";
    const marketFile = "model-market.snapshot.json";
    const stagedDatabase = join(stagingPath, databaseFile);
    const stagedMarket = join(stagingPath, marketFile);
    await vacuumInto(databasePath, stagedDatabase);
    await copyFile(marketPath, stagedMarket, fsConstants.COPYFILE_EXCL);
    await chmod(stagedDatabase, 0o640);
    await chmod(stagedMarket, 0o640);

    const [databaseMetadata, databaseInspection, databaseSha256, marketMetadata, marketInspection, marketSha256] = await Promise.all([
      stat(stagedDatabase),
      Promise.resolve(inspectDatabase(stagedDatabase)),
      sha256File(stagedDatabase),
      stat(stagedMarket),
      inspectMarketSnapshot(stagedMarket),
      sha256File(stagedMarket),
    ]);
    const manifest = {
      schemaVersion: BACKUP_SCHEMA,
      createdAt: now.toISOString(),
      release: process.env.KAI_RELEASE_SHA ?? process.env.KAI_RELEASE ?? null,
      database: {
        file: databaseFile,
        bytes: databaseMetadata.size,
        sha256: databaseSha256,
        ...databaseInspection,
      },
      market: {
        file: marketFile,
        bytes: marketMetadata.size,
        sha256: marketSha256,
        ...marketInspection,
      },
      retention,
    };
    const manifestPath = join(stagingPath, "manifest.json");
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o640 });
    await Promise.all([syncPath(stagedDatabase), syncPath(stagedMarket), syncPath(manifestPath)]);
    await syncPath(stagingPath);
    await rename(stagingPath, finalPath);
    await syncPath(backupRoot);
    const retentionResult = await applyRetention(backupRoot, retention, { protectedNames: [name] });
    return {
      command: "backup",
      bundle: finalPath,
      manifest,
      retention: retentionResult,
    };
  } catch (error) {
    try {
      const stagingMetadata = await lstat(stagingPath);
      if (!stagingMetadata.isSymbolicLink()) await rm(stagingPath, { recursive: true, force: false });
    } catch (cleanupError) {
      if (cleanupError?.code !== "ENOENT") error.cleanupError = cleanupError.message;
    }
    throw error;
  }
}

function isMainModule() {
  return process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
}

if (isMainModule()) {
  const command = process.argv[2] ?? "create";
  if (command !== "create") {
    process.stderr.write("Usage: node scripts/ops/backup-marketplace.mjs create\n");
    process.exitCode = 2;
  } else {
    createBackup()
      .then((result) => process.stdout.write(`${JSON.stringify(result)}\n`))
      .catch((error) => {
        process.stderr.write(`${error.code ?? "BACKUP_FAILED"}: ${error.message}\n`);
        process.exitCode = 1;
      });
  }
}
