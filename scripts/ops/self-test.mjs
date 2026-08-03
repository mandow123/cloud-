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
    const backupRoot = join(temporaryRoot, "backups");
    await Promise.all([
      mkdir(databaseDirectory, { mode: 0o750 }),
      mkdir(marketDirectory, { mode: 0o750 }),
      mkdir(backupRoot, { mode: 0o750 }),
    ]);
    const databasePath = join(databaseDirectory, "kai-cloud.sqlite");
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
    await writeFile(marketPath, `${JSON.stringify({
      schemaVersion: "kai-model-market-snapshot/1",
      publishedAt: "2026-08-03T06:00:00.000Z",
      quotes: [{ id: "model-a" }, { id: "model-b" }],
      index: { current: 100 },
    }, null, 2)}\n`, "utf8");

    const retention = { hourly: 1, daily: 0, monthly: 0 };
    const first = await createBackup({
      databasePath,
      marketPath,
      backupRoot,
      retention,
      now: "2026-08-03T06:15:00.000Z",
    });
    assert(first.manifest.database.counts.marketplace_requests === 1, "request count was not backed up");
    assert(first.manifest.database.counts.marketplace_quotes === 1, "quote count was not backed up");
    assert(first.manifest.database.userVersion === 7, "user_version was not backed up");

    const restoreDir = join(temporaryRoot, "isolated-restore");
    const restored = await verifyRestore({ bundlePath: first.bundle, restoreDir });
    assert(restored.verification.database.quickCheck === "ok", "restored database quick_check failed");
    assert(restored.verification.database.foreignKeyViolations === 0, "restored database has foreign key violations");
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
      marketPath,
      backupRoot,
      retention,
      now: "2026-08-03T07:15:00.000Z",
    });
    const bundles = (await readdir(backupRoot)).filter((entry) => entry.startsWith("kai-cloud-backup-"));
    assert(bundles.length === 1, "retention did not prune the older hourly backup");
    assert(bundles[0] === second.bundle.split(/[\\/]/).at(-1), "retention kept the wrong backup");

    return {
      status: "ok",
      checks: [
        "VACUUM INTO captured committed WAL data",
        "SHA-256 manifest matched restored files",
        "quick_check and foreign_key_check passed",
        "restore refused to overwrite an existing destination",
        "hourly retention pruned only the older validated bundle",
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
