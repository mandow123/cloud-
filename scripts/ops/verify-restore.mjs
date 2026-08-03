#!/usr/bin/env node

import { constants as fsConstants, chmod, copyFile, lstat, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

import {
  BACKUP_SCHEMA,
  inspectDatabase,
  inspectMarketSnapshot,
  sha256File,
} from "./backup-marketplace.mjs";

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function parseArguments(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--backup") result.backup = argv[++index];
    else if (value === "--restore-dir") result.restoreDir = argv[++index];
    else fail("INVALID_ARGUMENT", `Unknown argument: ${value}`);
  }
  if (!result.backup || !result.restoreDir) {
    fail("INVALID_ARGUMENT", "--backup and --restore-dir are required");
  }
  return result;
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

function bundleFile(bundlePath, value, field) {
  if (typeof value !== "string" || basename(value) !== value || value === "." || value === "..") {
    fail("INVALID_MANIFEST", `${field} must be a plain filename`);
  }
  const path = resolve(bundlePath, value);
  const relation = relative(bundlePath, path);
  if (!relation || relation.startsWith(`..${sep}`) || relation === ".." || isAbsolute(relation)) {
    fail("INVALID_MANIFEST", `${field} escapes the backup bundle`);
  }
  return path;
}

function compareJson(left, right, field) {
  if (JSON.stringify(left) !== JSON.stringify(right)) {
    fail("RESTORE_MISMATCH", `${field} does not match the backup manifest`);
  }
}

async function ensureDestinationDoesNotExist(path) {
  try {
    await lstat(path);
    fail("RESTORE_DESTINATION_EXISTS", `restore destination already exists: ${path}`);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

export async function verifyRestore(options) {
  const bundlePath = resolve(options.bundlePath);
  const restoreRoot = resolve(options.restoreDir);
  if (!isAbsolute(bundlePath) || !isAbsolute(restoreRoot)) {
    fail("UNSAFE_PATH", "backup and restore paths must be absolute");
  }
  if (restoreRoot === dirname(restoreRoot)) fail("UNSAFE_PATH", "restore destination cannot be a filesystem root");
  await ensureDestinationDoesNotExist(restoreRoot);

  const bundleMetadata = await lstat(bundlePath);
  if (!bundleMetadata.isDirectory() || bundleMetadata.isSymbolicLink()) {
    fail("INVALID_BACKUP_BUNDLE", "backup bundle must be a real directory");
  }
  const manifestPath = join(bundlePath, "manifest.json");
  await assertRegularFile(manifestPath, "MANIFEST_NOT_FOUND");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (manifest?.schemaVersion !== BACKUP_SCHEMA) {
    fail("INVALID_MANIFEST", `manifest must use ${BACKUP_SCHEMA}`);
  }

  const backupDatabase = bundleFile(bundlePath, manifest.database?.file, "database.file");
  const backupMarket = bundleFile(bundlePath, manifest.market?.file, "market.file");
  await Promise.all([
    assertRegularFile(backupDatabase, "BACKUP_DATABASE_NOT_FOUND"),
    assertRegularFile(backupMarket, "BACKUP_MARKET_NOT_FOUND"),
  ]);
  const [databaseSha256, marketSha256] = await Promise.all([
    sha256File(backupDatabase),
    sha256File(backupMarket),
  ]);
  if (databaseSha256 !== manifest.database.sha256) fail("CHECKSUM_MISMATCH", "database checksum does not match manifest");
  if (marketSha256 !== manifest.market.sha256) fail("CHECKSUM_MISMATCH", "market snapshot checksum does not match manifest");

  await mkdir(restoreRoot, { recursive: false, mode: 0o750 });
  const databaseDirectory = join(restoreRoot, "db");
  const marketDirectory = join(restoreRoot, "market");
  await Promise.all([
    mkdir(databaseDirectory, { recursive: false, mode: 0o750 }),
    mkdir(marketDirectory, { recursive: false, mode: 0o750 }),
  ]);
  const restoredDatabase = join(databaseDirectory, "kai-cloud.sqlite");
  const restoredMarket = join(marketDirectory, "model-market.snapshot.json");
  await Promise.all([
    copyFile(backupDatabase, restoredDatabase, fsConstants.COPYFILE_EXCL),
    copyFile(backupMarket, restoredMarket, fsConstants.COPYFILE_EXCL),
  ]);
  await Promise.all([chmod(restoredDatabase, 0o640), chmod(restoredMarket, 0o640)]);

  const [databaseInspection, marketInspection, restoredDatabaseSha256, restoredMarketSha256] = await Promise.all([
    Promise.resolve(inspectDatabase(restoredDatabase)),
    inspectMarketSnapshot(restoredMarket),
    sha256File(restoredDatabase),
    sha256File(restoredMarket),
  ]);
  if (restoredDatabaseSha256 !== manifest.database.sha256) fail("RESTORE_MISMATCH", "restored database checksum changed");
  if (restoredMarketSha256 !== manifest.market.sha256) fail("RESTORE_MISMATCH", "restored market checksum changed");
  compareJson(databaseInspection.counts, manifest.database.counts, "database counts");
  compareJson(databaseInspection.tables, manifest.database.tables, "database tables");
  if (databaseInspection.userVersion !== manifest.database.userVersion) {
    fail("RESTORE_MISMATCH", "database user_version does not match the backup manifest");
  }
  compareJson(marketInspection, {
    schemaVersion: manifest.market.schemaVersion,
    publishedAt: manifest.market.publishedAt,
    quoteCount: manifest.market.quoteCount,
    indexCurrent: manifest.market.indexCurrent,
  }, "market snapshot metadata");

  const verification = {
    schemaVersion: "kai-cloud-restore-verification/1",
    verifiedAt: new Date().toISOString(),
    sourceBackupCreatedAt: manifest.createdAt,
    sourceRelease: manifest.release,
    database: {
      sha256: restoredDatabaseSha256,
      ...databaseInspection,
    },
    market: {
      sha256: restoredMarketSha256,
      ...marketInspection,
    },
  };
  await writeFile(join(restoreRoot, "backup-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o640,
  });
  await writeFile(join(restoreRoot, "restore-verification.json"), `${JSON.stringify(verification, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o640,
  });
  const restoredDatabaseMetadata = await stat(restoredDatabase);
  return {
    command: "verify-restore",
    restoreDir: restoreRoot,
    databaseBytes: restoredDatabaseMetadata.size,
    verification,
  };
}

function isMainModule() {
  return process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
}

if (isMainModule()) {
  let options;
  try {
    const parsed = parseArguments(process.argv.slice(2));
    options = { bundlePath: parsed.backup, restoreDir: parsed.restoreDir };
  } catch (error) {
    process.stderr.write(`${error.code ?? "INVALID_ARGUMENT"}: ${error.message}\n`);
    process.exit(2);
  }
  verifyRestore(options)
    .then((result) => process.stdout.write(`${JSON.stringify(result)}\n`))
    .catch((error) => {
      process.stderr.write(`${error.code ?? "RESTORE_VERIFY_FAILED"}: ${error.message}\n`);
      process.exitCode = 1;
    });
}
