import { DatabaseSync } from "node:sqlite";
import { mkdirSync, realpathSync, existsSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { parseArgs } from "node:util";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { scanSupplyPaymentRecovery, recoverSupplyPayment } from "../../lib/server/supply-card-hour-recovery.ts";

const { values } = parseArgs({ options: {
  source: { type: "string" }, "copy-directory": { type: "string" }, "order-id": { type: "string" },
  fingerprint: { type: "string" }, operator: { type: "string" }, "after-id": { type: "string" },
  limit: { type: "string", default: "100" },
} });
if (!values.source) throw new Error("SUPPLY_RECOVERY_SOURCE_REQUIRED");
const sourcePath = realpathSync(values.source);
const now = new Date().toISOString();
function adapter(db) {
  return {
    first: async (sql, params = []) => db.prepare(sql).get(...params) ?? null,
    all: async (sql, params = []) => db.prepare(sql).all(...params),
    batch: async (items) => {
      db.exec("BEGIN IMMEDIATE");
      try { const results = items.map(({ sql, values = [] }) => ({ changes: Number(db.prepare(sql).run(...values).changes) })); db.exec("COMMIT"); return results; }
      catch (error) { db.exec("ROLLBACK"); throw error; }
    },
    ensureSchema: async () => { throw new Error("SUPPLY_RECOVERY_NEVER_MIGRATES"); },
  };
}
const source = new DatabaseSync(sourcePath, { readOnly: true, enableForeignKeyConstraints: true });
try {
  if (!values["copy-directory"]) {
    if (values["order-id"] || values.fingerprint || values.operator) throw new Error("SUPPLY_RECOVERY_WRITE_REQUIRES_NEW_COPY");
    const limit = Number(values.limit);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) throw new Error("SUPPLY_RECOVERY_SCAN_LIMIT_INVALID");
    // Read-only scan; keep this internal order inventory outside Git.
    console.log(JSON.stringify({ mode: "READ_ONLY_SCAN", observedAt: now, ...await scanSupplyPaymentRecovery(adapter(source), { now, afterId: values["after-id"], limit }) }));
  } else {
    if (!values["order-id"] || !/^[a-f0-9]{64}$/u.test(values.fingerprint ?? "") || !/^[A-Za-z0-9._:-]{3,128}$/u.test(values.operator ?? "")) throw new Error("SUPPLY_RECOVERY_REVIEWED_ORDER_FINGERPRINT_AND_OPERATOR_REQUIRED");
    const directory = resolve(values["copy-directory"]);
    if (existsSync(directory)) throw new Error("SUPPLY_RECOVERY_COPY_DIRECTORY_MUST_BE_NEW");
    mkdirSync(directory, { mode: 0o700 });
    const copyPath = join(realpathSync(directory), "recovery-copy.sqlite");
    // VACUUM INTO snapshots SQLite/WAL consistently. Source remains read-only.
    source.prepare("VACUUM INTO ?").run(copyPath);
    const beforeSha256 = createHash("sha256").update(readFileSync(copyPath)).digest("hex");
    const copy = new DatabaseSync(copyPath, { enableForeignKeyConstraints: true });
    try {
      const result = await recoverSupplyPayment(adapter(copy), { orderId: values["order-id"], expectedFingerprint: values.fingerprint, now, operatorId: values.operator });
      const integrity = copy.prepare("PRAGMA integrity_check").get().integrity_check;
      const foreignKeyViolations = copy.prepare("PRAGMA foreign_key_check").all().length;
      if (integrity !== "ok" || foreignKeyViolations !== 0) throw new Error("SUPPLY_RECOVERY_COPY_INTEGRITY_FAILED");
      const evidence = { mode: "COPY_REHEARSAL_ONLY", occurredAt: now, sourceUnmodified: true, orderId: values["order-id"], evidenceFingerprint: values.fingerprint, beforeSha256, ...result, integrity, foreignKeyViolations };
      writeFileSync(join(directory, "rehearsal.json"), JSON.stringify(evidence, null, 2), { flag: "wx", mode: 0o600 });
      console.log(JSON.stringify(evidence));
    } finally { copy.close(); }
  }
} finally { source.close(); }
