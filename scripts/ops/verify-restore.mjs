#!/usr/bin/env node

import { constants as fsConstants, chmod, copyFile, lstat, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

import {
  BACKUP_SCHEMA,
  LEGACY_BACKUP_SCHEMA,
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

function bundleUploadFile(bundlePath, uploadDirectory, value, field) {
  if (typeof value !== "string"
    || value.includes("\\")
    || value.startsWith("/")
    || value.split("/").some((part) => !part || part === "." || part === "..")) {
    fail("INVALID_MANIFEST", `${field} must be a safe portable relative path`);
  }
  const root = resolve(bundlePath, uploadDirectory);
  const path = resolve(root, ...value.split("/"));
  const relation = relative(root, path);
  if (!relation || relation.startsWith(`..${sep}`) || relation === ".." || isAbsolute(relation)) {
    fail("INVALID_MANIFEST", `${field} escapes the upload bundle`);
  }
  return path;
}

async function listRegularFiles(root) {
  const rootMetadata = await lstat(root);
  if (!rootMetadata.isDirectory() || rootMetadata.isSymbolicLink()) {
    fail("INVALID_BACKUP_BUNDLE", "uploads must be a real directory");
  }
  const files = [];
  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const path = join(directory, entry.name);
      const metadata = await lstat(path);
      if (metadata.isSymbolicLink()) fail("INVALID_BACKUP_BUNDLE", `${path} must not be a symbolic link`);
      if (metadata.isDirectory()) await visit(path);
      else if (metadata.isFile()) files.push(relative(root, path).split(sep).join("/"));
      else fail("INVALID_BACKUP_BUNDLE", `${path} must be a regular file or directory`);
    }
  }
  await visit(root);
  return files.sort((left, right) => left.localeCompare(right));
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
  if (![BACKUP_SCHEMA, LEGACY_BACKUP_SCHEMA].includes(manifest?.schemaVersion)) {
    fail("INVALID_MANIFEST", `manifest must use ${BACKUP_SCHEMA} or ${LEGACY_BACKUP_SCHEMA}`);
  }
  const hasActivityData = manifest.schemaVersion === BACKUP_SCHEMA;

  const backupDatabase = bundleFile(bundlePath, manifest.database?.file, "database.file");
  const backupMarket = bundleFile(bundlePath, manifest.market?.file, "market.file");
  const backupActivityDatabase = hasActivityData
    ? bundleFile(bundlePath, manifest.activityDatabase?.file, "activityDatabase.file")
    : null;
  await Promise.all([
    assertRegularFile(backupDatabase, "BACKUP_DATABASE_NOT_FOUND"),
    assertRegularFile(backupMarket, "BACKUP_MARKET_NOT_FOUND"),
    ...(backupActivityDatabase ? [assertRegularFile(backupActivityDatabase, "BACKUP_ACTIVITY_DATABASE_NOT_FOUND")] : []),
  ]);
  const [databaseSha256, marketSha256, activityDatabaseSha256] = await Promise.all([
    sha256File(backupDatabase),
    sha256File(backupMarket),
    backupActivityDatabase ? sha256File(backupActivityDatabase) : Promise.resolve(null),
  ]);
  if (databaseSha256 !== manifest.database.sha256) fail("CHECKSUM_MISMATCH", "database checksum does not match manifest");
  if (marketSha256 !== manifest.market.sha256) fail("CHECKSUM_MISMATCH", "market snapshot checksum does not match manifest");
  if (hasActivityData && activityDatabaseSha256 !== manifest.activityDatabase.sha256) {
    fail("CHECKSUM_MISMATCH", "activity database checksum does not match manifest");
  }

  const uploadFiles = [];
  let backupUploadRoot = null;
  if (hasActivityData) {
    if (manifest.uploads?.directory !== "uploads" || !Array.isArray(manifest.uploads.files)) {
      fail("INVALID_MANIFEST", "uploads manifest is incomplete");
    }
    backupUploadRoot = resolve(bundlePath, manifest.uploads.directory);
    const seen = new Set();
    for (const [index, file] of manifest.uploads.files.entries()) {
      if (!file || typeof file !== "object"
        || !Number.isSafeInteger(file.bytes)
        || file.bytes < 0
        || typeof file.sha256 !== "string"
        || !/^[0-9a-f]{64}$/.test(file.sha256)) {
        fail("INVALID_MANIFEST", `uploads.files[${index}] must include a valid byte count and SHA-256`);
      }
      const source = bundleUploadFile(bundlePath, manifest.uploads.directory, file?.path, `uploads.files[${index}].path`);
      if (seen.has(file.path)) fail("INVALID_MANIFEST", `duplicate upload path: ${file.path}`);
      seen.add(file.path);
      const metadata = await assertRegularFile(source, "BACKUP_UPLOAD_NOT_FOUND");
      const checksum = await sha256File(source);
      if (checksum !== file.sha256 || metadata.size !== file.bytes) {
        fail("CHECKSUM_MISMATCH", `upload checksum or size does not match manifest: ${file.path}`);
      }
      uploadFiles.push({ ...file, source });
    }
    const actualFiles = await listRegularFiles(backupUploadRoot);
    const expectedFiles = uploadFiles.map((file) => file.path).sort((left, right) => left.localeCompare(right));
    compareJson(actualFiles, expectedFiles, "upload file list");
    const totalBytes = uploadFiles.reduce((total, file) => total + file.bytes, 0);
    if (manifest.uploads.fileCount !== uploadFiles.length || manifest.uploads.totalBytes !== totalBytes) {
      fail("INVALID_MANIFEST", "upload totals do not match upload entries");
    }
  }

  await mkdir(restoreRoot, { recursive: false, mode: 0o750 });
  const databaseDirectory = join(restoreRoot, "db");
  const marketDirectory = join(restoreRoot, "market");
  const uploadDirectory = join(restoreRoot, "uploads");
  const backupDirectory = join(restoreRoot, "backups");
  await Promise.all([
    mkdir(databaseDirectory, { recursive: false, mode: 0o750 }),
    mkdir(marketDirectory, { recursive: false, mode: 0o750 }),
    mkdir(uploadDirectory, { recursive: false, mode: 0o750 }),
    mkdir(backupDirectory, { recursive: false, mode: 0o750 }),
  ]);
  const restoredDatabase = join(databaseDirectory, "kai-cloud.sqlite");
  const restoredActivityDatabase = join(databaseDirectory, "activity.sqlite");
  const restoredMarket = join(marketDirectory, "model-market.snapshot.json");
  await Promise.all([
    copyFile(backupDatabase, restoredDatabase, fsConstants.COPYFILE_EXCL),
    copyFile(backupMarket, restoredMarket, fsConstants.COPYFILE_EXCL),
    ...(backupActivityDatabase
      ? [copyFile(backupActivityDatabase, restoredActivityDatabase, fsConstants.COPYFILE_EXCL)]
      : []),
  ]);
  for (const upload of uploadFiles) {
    const destination = resolve(uploadDirectory, ...upload.path.split("/"));
    await mkdir(dirname(destination), { recursive: true, mode: 0o750 });
    await copyFile(upload.source, destination, fsConstants.COPYFILE_EXCL);
    await chmod(destination, 0o640);
  }
  await Promise.all([
    chmod(restoredDatabase, 0o640),
    chmod(restoredMarket, 0o640),
    ...(backupActivityDatabase ? [chmod(restoredActivityDatabase, 0o640)] : []),
  ]);

  const [
    databaseInspection,
    marketInspection,
    restoredDatabaseSha256,
    restoredMarketSha256,
    activityDatabaseInspection,
    restoredActivityDatabaseSha256,
  ] = await Promise.all([
    Promise.resolve(inspectDatabase(restoredDatabase)),
    inspectMarketSnapshot(restoredMarket),
    sha256File(restoredDatabase),
    sha256File(restoredMarket),
    backupActivityDatabase ? Promise.resolve(inspectDatabase(restoredActivityDatabase)) : Promise.resolve(null),
    backupActivityDatabase ? sha256File(restoredActivityDatabase) : Promise.resolve(null),
  ]);
  if (restoredDatabaseSha256 !== manifest.database.sha256) fail("RESTORE_MISMATCH", "restored database checksum changed");
  if (restoredMarketSha256 !== manifest.market.sha256) fail("RESTORE_MISMATCH", "restored market checksum changed");
  if (hasActivityData && restoredActivityDatabaseSha256 !== manifest.activityDatabase.sha256) {
    fail("RESTORE_MISMATCH", "restored activity database checksum changed");
  }
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
  if (hasActivityData) {
    compareJson(activityDatabaseInspection.counts, manifest.activityDatabase.counts, "activity database counts");
    compareJson(activityDatabaseInspection.tables, manifest.activityDatabase.tables, "activity database tables");
    if (activityDatabaseInspection.userVersion !== manifest.activityDatabase.userVersion) {
      fail("RESTORE_MISMATCH", "activity database user_version does not match the backup manifest");
    }
    const restoredUploadFiles = await listRegularFiles(uploadDirectory);
    compareJson(restoredUploadFiles, uploadFiles.map((file) => file.path).sort((left, right) => left.localeCompare(right)), "restored upload file list");
    for (const upload of uploadFiles) {
      const restoredUpload = resolve(uploadDirectory, ...upload.path.split("/"));
      if (await sha256File(restoredUpload) !== upload.sha256) {
        fail("RESTORE_MISMATCH", `restored upload checksum changed: ${upload.path}`);
      }
    }
  }

  const verification = {
    schemaVersion: "kai-cloud-restore-verification/1",
    verifiedAt: new Date().toISOString(),
    sourceBackupCreatedAt: manifest.createdAt,
    sourceRelease: manifest.release,
    database: {
      sha256: restoredDatabaseSha256,
      ...databaseInspection,
    },
    activityDatabase: hasActivityData ? {
      sha256: restoredActivityDatabaseSha256,
      ...activityDatabaseInspection,
    } : null,
    market: {
      sha256: restoredMarketSha256,
      ...marketInspection,
    },
    uploads: hasActivityData ? {
      fileCount: uploadFiles.length,
      totalBytes: uploadFiles.reduce((total, file) => total + file.bytes, 0),
    } : null,
    legacyBackup: !hasActivityData,
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
