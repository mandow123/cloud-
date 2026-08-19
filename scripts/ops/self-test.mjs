#!/usr/bin/env node

import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { createBackup } from "./backup-marketplace.mjs";
import { verifyRestore } from "./verify-restore.mjs";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function safeTemporaryDirectory(path) {
  const root = resolve(tmpdir());
  const candidate = resolve(path);
  const relation = relative(root, candidate);
  return relation.startsWith("kai-cloud-ops-test-")
    && !relation.includes(sep)
    && candidate !== root;
}

async function main() {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "kai-cloud-ops-test-"));
  if (!safeTemporaryDirectory(temporaryRoot)) throw new Error("temporary test directory failed safety validation");
  let sourceDatabase;
  try {
    const databaseDirectory = join(temporaryRoot, "db");
    const marketDirectory = join(temporaryRoot, "market");
    const uploadDirectory = join(temporaryRoot, "uploads");
    const backupRoot = join(temporaryRoot, "backups");
    await Promise.all([
      mkdir(databaseDirectory, { mode: 0o750 }),
      mkdir(marketDirectory, { mode: 0o750 }),
      mkdir(uploadDirectory, { mode: 0o750 }),
      mkdir(backupRoot, { mode: 0o750 }),
    ]);
    const databasePath = join(databaseDirectory, "kai-cloud.sqlite");
    const activityDatabasePath = join(databaseDirectory, "activity.sqlite");
    const marketPath = join(marketDirectory, "model-market.snapshot.json");
    sourceDatabase = new DatabaseSync(databasePath, { enableForeignKeyConstraints: true });
    sourceDatabase.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA user_version = 7;
      CREATE TABLE marketplace_requests (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL
      );
      CREATE TABLE marketplace_quotes (
        id TEXT PRIMARY KEY,
        demand_id TEXT NOT NULL REFERENCES marketplace_requests(id),
        amount REAL NOT NULL
      );
      CREATE TABLE marketplace_drafts (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL
      );
      INSERT INTO marketplace_requests (id, title) VALUES ('request-1', 'GPU rental');
      INSERT INTO marketplace_quotes (id, demand_id, amount) VALUES ('quote-1', 'request-1', 12.5);
      INSERT INTO marketplace_drafts (id, title) VALUES ('draft-1', 'Capacity draft');
    `);
    const activityDatabase = new DatabaseSync(activityDatabasePath, { enableForeignKeyConstraints: true });
    activityDatabase.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA user_version = 2;
      CREATE TABLE activity_submissions (
        id TEXT PRIMARY KEY,
        asset_key TEXT NOT NULL UNIQUE
      );
      CREATE TABLE activity_votes (
        user_id TEXT NOT NULL,
        submission_id TEXT NOT NULL REFERENCES activity_submissions(id),
        PRIMARY KEY (user_id, submission_id)
      );
      INSERT INTO activity_submissions (id, asset_key) VALUES ('submission-1', 'submissions/user-1/item.png');
      INSERT INTO activity_votes (user_id, submission_id) VALUES ('user-1', 'submission-1');
    `);
    activityDatabase.close();
    await mkdir(join(uploadDirectory, "submissions", "user-1"), { recursive: true, mode: 0o750 });
    await writeFile(join(uploadDirectory, "submissions", "user-1", "item.png"), Buffer.from("test-image-bytes"));
    await writeFile(marketPath, `${JSON.stringify({
      schemaVersion: "kai-model-market-snapshot/1",
      publishedAt: "2026-08-03T06:00:00.000Z",
      quotes: [{ id: "model-a" }, { id: "model-b" }],
      index: { current: 100 },
    }, null, 2)}\n`, "utf8");

    const retention = { hourly: 2, daily: 0, monthly: 0, maxAgeDays: 30 };
    let excessiveRetentionWasRejected = false;
    try {
      await createBackup({
        databasePath,
        activityDatabasePath,
        marketPath,
        uploadDirectory,
        backupRoot,
        retention: { ...retention, maxAgeDays: 31 },
        now: "2026-08-03T06:14:00.000Z",
      });
    } catch (error) {
      excessiveRetentionWasRejected = error.code === "INVALID_RETENTION";
    }
    assert(excessiveRetentionWasRejected, "a backup maximum age above 30 days was accepted");

    const first = await createBackup({
      databasePath,
      activityDatabasePath,
      marketPath,
      uploadDirectory,
      backupRoot,
      retention,
      now: "2026-08-03T06:15:00.000Z",
    });
    assert(first.manifest.database.counts.marketplace_requests === 1, "request count was not backed up");
    assert(first.manifest.database.counts.marketplace_quotes === 1, "quote count was not backed up");
    assert(first.manifest.database.userVersion === 7, "user_version was not backed up");
    assert(first.manifest.activityDatabase.counts.activity_submissions === 1, "activity submission count was not backed up");
    assert(first.manifest.activityDatabase.counts.activity_votes === 1, "activity vote count was not backed up");
    assert(first.manifest.uploads.fileCount === 1, "activity uploads were not backed up");

    const restoreDir = join(temporaryRoot, "isolated-restore");
    const restored = await verifyRestore({ bundlePath: first.bundle, restoreDir });
    assert(restored.verification.database.quickCheck === "ok", "restored database quick_check failed");
    assert(restored.verification.database.foreignKeyViolations === 0, "restored database has foreign key violations");
    assert(restored.verification.activityDatabase.quickCheck === "ok", "restored activity database quick_check failed");
    assert(restored.verification.activityDatabase.counts.activity_submissions === 1, "restored activity submission count changed");
    assert(restored.verification.uploads.fileCount === 1, "restored upload count changed");
    assert((await readFile(join(restoreDir, "uploads", "submissions", "user-1", "item.png"), "utf8")) === "test-image-bytes", "restored upload content changed");
    const restoredManifest = JSON.parse(await readFile(join(restoreDir, "backup-manifest.json"), "utf8"));
    assert(restoredManifest.database.sha256 === first.manifest.database.sha256, "restored manifest changed database checksum");

    let overwriteWasRejected = false;
    try {
      await verifyRestore({ bundlePath: first.bundle, restoreDir });
    } catch (error) {
      overwriteWasRejected = error.code === "RESTORE_DESTINATION_EXISTS";
    }
    assert(overwriteWasRejected, "restore verification did not reject an existing destination");

    const second = await createBackup({
      databasePath,
      activityDatabasePath,
      marketPath,
      uploadDirectory,
      backupRoot,
      retention,
      now: "2026-08-03T07:15:00.000Z",
    });
    const third = await createBackup({
      databasePath,
      activityDatabasePath,
      marketPath,
      uploadDirectory,
      backupRoot,
      retention,
      now: "2026-08-03T08:15:00.000Z",
    });
    let bundles = (await readdir(backupRoot)).filter((entry) => entry.startsWith("kai-cloud-backup-"));
    assert(bundles.length === 2, "hourly retention did not keep exactly the two newest backups");
    assert(bundles.includes(second.bundle.split(/[\\/]/).at(-1)), "hourly retention removed the second-newest backup");
    assert(bundles.includes(third.bundle.split(/[\\/]/).at(-1)), "hourly retention removed the newest backup");

    const fourth = await createBackup({
      databasePath,
      activityDatabasePath,
      marketPath,
      uploadDirectory,
      backupRoot,
      retention,
      now: "2026-09-03T08:16:00.000Z",
    });
    bundles = (await readdir(backupRoot)).filter((entry) => entry.startsWith("kai-cloud-backup-"));
    assert(bundles.length === 1, "the 30-day maximum age did not prune stale backups");
    assert(bundles[0] === fourth.bundle.split(/[\\/]/).at(-1), "the 30-day maximum age kept a stale backup");

    return {
      status: "ok",
      checks: [
        "VACUUM INTO captured committed WAL data",
        "the activity database and upload object tree were captured and restored",
        "SHA-256 manifest matched restored files",
        "quick_check and foreign_key_check passed",
        "restore refused to overwrite an existing destination",
        "backup retention rejected a maximum age above 30 days",
        "hourly retention kept only the requested newest validated bundles",
        "the maximum-age guard pruned every validated bundle older than 30 days",
      ],
    };
  } finally {
    sourceDatabase?.close();
    if (safeTemporaryDirectory(temporaryRoot)) await rm(temporaryRoot, { recursive: true, force: false });
  }
}

main()
  .then((result) => process.stdout.write(`${JSON.stringify(result)}\n`))
  .catch((error) => {
    process.stderr.write(`${error.code ?? "OPS_SELF_TEST_FAILED"}: ${error.message}\n`);
    process.exitCode = 1;
  });
