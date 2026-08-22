import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { configureQixiangProductionEnvironment, parseQixiangProductionCredentials, renderQixiangProductionEnvironment } from "../scripts/ops/configure-qixiang-pay-env.mjs";

const credentials = Object.freeze({
  pid: "4611",
  key: "realistic-production-key-2026",
  approvalReference: "KAI-PAY-APPROVAL-20260822",
  credentialVersion: "merchant-v1",
  riskReference: "RISK-KAI-QIXIANG-GET-20260822",
  queryCredentialId: "QRY-qixiang-production-v1",
  queryCredentialVersion: "query-v1",
  channel: "ALIPAY",
  organizations: ["org_primary", "org_supplier"],
});

test("Qixiang credential input is exact and rejects unsafe rollout data", () => {
  assert.deepEqual(parseQixiangProductionCredentials(JSON.stringify(credentials)), credentials);
  assert.throws(() => parseQixiangProductionCredentials(JSON.stringify({ ...credentials, extra: true })), /unexpected or missing/u);
  assert.throws(() => parseQixiangProductionCredentials(JSON.stringify({ ...credentials, key: "replace-with-secret" })), /placeholder/u);
  assert.throws(() => parseQixiangProductionCredentials(JSON.stringify({ ...credentials, channel: "WXPAY" })), /ALIPAY/u);
  assert.throws(() => parseQixiangProductionCredentials(JSON.stringify({ ...credentials, organizations: ["org_primary", "org_primary"] })), /duplicate/u);
});

test("reconciliation mode configures the complete gate without enabling checkout", () => {
  const rendered = renderQixiangProductionEnvironment("KAI_PUBLIC_ORIGIN=https://cloud.kai.com\nKAI_QIXIANG_PAY_ENABLED=0\n", credentials, "reconciliation", new Date("2026-08-22T09:20:00.000Z"));
  assert.match(rendered, /^KAI_QIXIANG_PAY_ENABLED=0$/mu);
  assert.match(rendered, /^KAI_QIXIANG_PAY_RECONCILIATION_ENABLED=1$/mu);
  assert.match(rendered, /^KAI_QIXIANG_PAY_PID=4611$/mu);
  assert.match(rendered, /^KAI_QIXIANG_PAY_PILOT_ORGANIZATIONS=org_primary,org_supplier$/mu);
  assert.match(rendered, /^KAI_QIXIANG_PAY_GATEWAY=https:\/\/api\.payqixiang\.cn\/mapi\.php$/mu);
  assert.match(rendered, /^KAI_QIXIANG_PAY_QUERY_ENDPOINT=https:\/\/api\.payqixiang\.cn\/api\.php$/mu);
  assert.equal((rendered.match(/^KAI_QIXIANG_PAY_KEY=/gmu) ?? []).length, 1);
});

test("payment mode atomically preserves rollback and never returns the key", async () => {
  const directory = await mkdtemp(join(tmpdir(), "kai-qixiang-config-"));
  const envFile = join(directory, "kai-cloud-app.env");
  const credentialFile = join(directory, "qixiang.json");
  await writeFile(envFile, "KAI_PUBLIC_ORIGIN=https://cloud.kai.com\nKAI_QIXIANG_PAY_ENABLED=0\n", { mode: 0o600 });
  await writeFile(credentialFile, JSON.stringify(credentials), { mode: 0o600 });
  await chmod(credentialFile, 0o600);
  const result = await configureQixiangProductionEnvironment({ envFile, credentialFile, mode: "payment", now: new Date("2026-08-22T09:21:00.000Z"), requireRootOwner: false });
  assert.equal(result.mode, "payment");
  assert.equal(result.organizationCount, 2);
  assert.equal(await readFile(result.backupFile, "utf8"), "KAI_PUBLIC_ORIGIN=https://cloud.kai.com\nKAI_QIXIANG_PAY_ENABLED=0\n");
  assert.match(await readFile(envFile, "utf8"), /^KAI_QIXIANG_PAY_ENABLED=1$/mu);
  assert.match(await readFile(envFile, "utf8"), /^KAI_QIXIANG_PAY_RECONCILIATION_ENABLED=1$/mu);
  assert.equal((await stat(envFile)).mode & 0o777, 0o600);
  assert.doesNotMatch(JSON.stringify(result), /realistic-production-key/u);
});
