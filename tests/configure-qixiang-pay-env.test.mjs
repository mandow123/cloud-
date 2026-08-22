import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { configureQixiangProductionEnvironment, parseQixiangProductionCredentials, renderQixiangProductionEnvironment, validateProtectedMetadata } from "../scripts/ops/configure-qixiang-pay-env.mjs";

const credentials = Object.freeze({
  pid: "4611",
  key: "realistic-production-key-2026",
  approvalReference: "KAI-PAY-APPROVAL-20260822",
  credentialVersion: "merchant-v1",
  credentialRotatedAt: "2026-08-22T09:20:00.000Z",
  riskReference: "RISK-KAI-QIXIANG-GET-20260822",
  queryCredentialId: "QRY-qixiang-production-v1",
  queryCredentialVersion: "query-v1",
  queryCredentialRotatedAt: "2026-08-22T09:20:00.000Z",
  keyReuseApprovalReference: "",
  keyReuseApprovedAt: "",
  keyReuseDigest: "",
  channel: "ALIPAY",
  organizations: ["org_primary", "org_supplier"],
});

test("Qixiang credential input is exact and rejects unsafe rollout data", () => {
  assert.deepEqual(parseQixiangProductionCredentials(JSON.stringify(credentials)), credentials);
  assert.throws(() => parseQixiangProductionCredentials(JSON.stringify({ ...credentials, extra: true })), /unexpected or missing/u);
  assert.throws(() => parseQixiangProductionCredentials(JSON.stringify({ ...credentials, key: "replace-with-secret" })), /placeholder/u);
  assert.throws(() => parseQixiangProductionCredentials(JSON.stringify({ ...credentials, channel: "WXPAY" })), /ALIPAY/u);
  assert.throws(() => parseQixiangProductionCredentials(JSON.stringify({ ...credentials, organizations: ["org_primary", "org_primary"] })), /duplicate/u);
  assert.throws(() => parseQixiangProductionCredentials(JSON.stringify(credentials).replace('"pid":"4611"', '"pid":"9999","pid":"4611"')), /duplicate or escaped/u);
  assert.throws(() => parseQixiangProductionCredentials(JSON.stringify(credentials).replace('"pid"', '"\\u0070id"')), /duplicate or escaped/u);
  const revoked = {
    ...credentials,
    key: "revoked-fixture-key-1234567890",
    credentialRotatedAt: "",
    queryCredentialRotatedAt: "",
    keyReuseApprovalReference: "RISK-KAI-QIXIANG-KEY-REUSE-20260822",
    keyReuseApprovedAt: "2026-08-22T09:20:00.000Z",
    keyReuseDigest: "48b179abed3a6cbe4f69dfacfeaea8eeec6cc9a405144fb23727fbdb6f37c94b",
  };
  assert.deepEqual(parseQixiangProductionCredentials(JSON.stringify(revoked)), revoked);
  assert.throws(() => parseQixiangProductionCredentials(JSON.stringify({ ...revoked, keyReuseDigest: "0".repeat(64) })), /digest-bound approval/u);
  assert.throws(() => parseQixiangProductionCredentials(JSON.stringify({ ...revoked, credentialRotatedAt: "2026-08-22T09:20:00.000Z" })), /must not claim credential rotation/u);
  assert.throws(() => parseQixiangProductionCredentials(JSON.stringify({ ...revoked, queryCredentialRotatedAt: "2026-08-22T09:20:00.000Z" })), /must not claim credential rotation/u);
  assert.throws(() => parseQixiangProductionCredentials(JSON.stringify({ ...revoked, keyReuseApprovedAt: "2099-08-22T09:20:00.000Z" })), /invalid key reuse approval time/u);
  assert.throws(() => parseQixiangProductionCredentials(JSON.stringify({ ...revoked, keyReuseApprovalReference: "KAI-PAY-APPROVAL-20260822" })), /invalid key reuse approval reference/u);
  assert.throws(() => parseQixiangProductionCredentials(JSON.stringify({ ...credentials, keyReuseApprovedAt: "2026-08-22T09:20:00.000Z" })), /only valid/u);
});

test("reconciliation mode configures the complete gate without enabling checkout", () => {
  const rendered = renderQixiangProductionEnvironment("KAI_PUBLIC_ORIGIN=https://cloud.kai.com\nKAI_QIXIANG_PAY_ENABLED=0\n", credentials, "reconciliation");
  assert.match(rendered, /^KAI_QIXIANG_PAY_ENABLED=0$/mu);
  assert.match(rendered, /^KAI_QIXIANG_PAY_RECONCILIATION_ENABLED=1$/mu);
  assert.match(rendered, /^KAI_QIXIANG_PAY_PID=4611$/mu);
  assert.match(rendered, /^KAI_QIXIANG_PAY_PILOT_ORGANIZATIONS=org_primary,org_supplier$/mu);
  assert.match(rendered, /^KAI_QIXIANG_PAY_GATEWAY=https:\/\/api\.payqixiang\.cn\/mapi\.php$/mu);
  assert.match(rendered, /^KAI_QIXIANG_PAY_QUERY_ENDPOINT=https:\/\/api\.payqixiang\.cn\/api\.php$/mu);
  assert.equal((rendered.match(/^KAI_QIXIANG_PAY_KEY=/gmu) ?? []).length, 1);
  assert.match(rendered, /^KAI_QIXIANG_PAY_CREDENTIAL_ROTATED_AT=2026-08-22T09:20:00.000Z$/mu);
  assert.match(rendered, /^KAI_QIXIANG_PAY_KEY_REUSE_APPROVED=0$/mu);
});

test("payment mode requires an identical verified reconciliation configuration", () => {
  const disabled = "KAI_PUBLIC_ORIGIN=https://cloud.kai.com\nKAI_QIXIANG_PAY_ENABLED=0\nKAI_QIXIANG_PAY_RECONCILIATION_ENABLED=0\n";
  assert.throws(() => renderQixiangProductionEnvironment(disabled, credentials, "payment"), /verified reconciliation/u);
  const reconciled = renderQixiangProductionEnvironment(disabled, credentials, "reconciliation");
  const payment = renderQixiangProductionEnvironment(reconciled, credentials, "payment");
  assert.match(payment, /^KAI_QIXIANG_PAY_ENABLED=1$/mu);
  assert.equal(payment.match(/^KAI_QIXIANG_PAY_CREDENTIAL_ROTATED_AT=.*$/mu)?.[0], reconciled.match(/^KAI_QIXIANG_PAY_CREDENTIAL_ROTATED_AT=.*$/mu)?.[0]);
  assert.throws(() => renderQixiangProductionEnvironment(reconciled.replace("KAI_QIXIANG_PAY_PID=4611", "KAI_QIXIANG_PAY_PID=9999"), credentials, "payment"), /configuration drift/u);
});

test("payment mode atomically preserves rollback and never returns the key", async () => {
  const directory = await mkdtemp(join(tmpdir(), "kai-qixiang-config-"));
  const envFile = join(directory, "kai-cloud-app.env");
  const credentialFile = join(directory, "qixiang.json");
  const disabled = "KAI_PUBLIC_ORIGIN=https://cloud.kai.com\nKAI_QIXIANG_PAY_ENABLED=0\nKAI_QIXIANG_PAY_RECONCILIATION_ENABLED=0\n";
  const reconciled = renderQixiangProductionEnvironment(disabled, credentials, "reconciliation");
  await writeFile(envFile, reconciled, { mode: 0o640 });
  await writeFile(credentialFile, JSON.stringify(credentials), { mode: 0o600 });
  await chmod(credentialFile, 0o600);
  const result = await configureQixiangProductionEnvironment({ envFile, credentialFile, mode: "payment", now: new Date("2026-08-22T09:21:00.000Z"), requireRootOwner: false });
  assert.equal(result.mode, "payment");
  assert.equal(result.organizationCount, 2);
  assert.equal(await readFile(result.backupFile, "utf8"), reconciled);
  assert.match(await readFile(envFile, "utf8"), /^KAI_QIXIANG_PAY_ENABLED=1$/mu);
  assert.match(await readFile(envFile, "utf8"), /^KAI_QIXIANG_PAY_RECONCILIATION_ENABLED=1$/mu);
  assert.equal((await stat(envFile)).mode & 0o777, 0o640);
  assert.equal((await stat(result.backupFile)).mode & 0o777, 0o640);
  assert.doesNotMatch(JSON.stringify(result), /realistic-production-key/u);
});

test("protected file metadata rejects public and wrong-owner production files", () => {
  const regular = { isSymbolicLink: () => false, isFile: () => true, mode: 0o100640, uid: 0, gid: 0 };
  assert.doesNotThrow(() => validateProtectedMetadata(regular, { expectedMode: 0o640, requireRootOwner: true, label: "environment file" }));
  assert.throws(() => validateProtectedMetadata({ ...regular, mode: 0o100644 }, { expectedMode: 0o640, requireRootOwner: true, label: "environment file" }), /0640/u);
  assert.throws(() => validateProtectedMetadata({ ...regular, gid: 20 }, { expectedMode: 0o640, requireRootOwner: true, label: "environment file" }), /root-owned/u);
});

test("configuration rejects a credential symlink and a public environment file", async () => {
  const directory = await mkdtemp(join(tmpdir(), "kai-qixiang-negative-"));
  const envFile = join(directory, "app.env");
  const realCredential = join(directory, "real.json");
  const credentialLink = join(directory, "link.json");
  await writeFile(envFile, "KAI_QIXIANG_PAY_ENABLED=0\n", { mode: 0o644 });
  await writeFile(realCredential, JSON.stringify(credentials), { mode: 0o600 });
  await symlink(realCredential, credentialLink);
  await assert.rejects(configureQixiangProductionEnvironment({ envFile, credentialFile: realCredential, mode: "reconciliation", requireRootOwner: false }), /0640/u);
  await chmod(envFile, 0o640);
  await assert.rejects(configureQixiangProductionEnvironment({ envFile, credentialFile: credentialLink, mode: "reconciliation", requireRootOwner: false }), /root-owned private|symbolic|ELOOP|regular file/u);
});
