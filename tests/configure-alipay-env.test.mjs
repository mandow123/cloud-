import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { chmod, mkdtemp, readFile, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  configureAlipayProductionEnvironment,
  parseAlipayProductionCredentials,
  renderAlipayProductionEnvironment,
  validateProtectedMetadata,
} from "../scripts/ops/configure-alipay-env.mjs";

function pemPair(modulusLength = 2048) {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  return { privateKey, publicKey };
}

const merchant = pemPair();
const provider = pemPair();
const credentials = Object.freeze({
  appId: "2026000000000001",
  privateKey: merchant.privateKey,
  privateKeyType: "PKCS8",
  alipayPublicKey: provider.publicKey,
  sellerId: "2088000000000001",
  approvalReference: "CHG-2026-09-18-ALIPAY",
  credentialVersion: "alipay-production-v1",
  credentialRotatedAt: "2026-09-18T00:00:00.000Z",
  organizations: ["org_primary", "org_supplier"],
});

test("Alipay credential input is exact and validates production RSA material", () => {
  assert.deepEqual(parseAlipayProductionCredentials(JSON.stringify(credentials)), {
    ...credentials,
    privateKey: credentials.privateKey.trim(),
    alipayPublicKey: credentials.alipayPublicKey.trim(),
  });
  assert.throws(() => parseAlipayProductionCredentials(JSON.stringify({ ...credentials, extra: true })), /unexpected or missing/u);
  assert.throws(() => parseAlipayProductionCredentials(JSON.stringify(credentials).replace('"appId":"2026000000000001"', '"appId":"2026000000000002","appId":"2026000000000001"')), /duplicate or escaped/u);
  assert.throws(() => parseAlipayProductionCredentials(JSON.stringify(credentials).replace('"appId"', '"\\u0061ppId"')), /duplicate or escaped/u);
  assert.throws(() => parseAlipayProductionCredentials(JSON.stringify({ ...credentials, appId: "20260001" })), /application identifier/u);
  assert.throws(() => parseAlipayProductionCredentials(JSON.stringify({ ...credentials, sellerId: "seller" })), /seller identifier/u);
  assert.throws(() => parseAlipayProductionCredentials(JSON.stringify({ ...credentials, privateKeyType: "PKCS1" })), /private RSA key/u);
  assert.throws(() => parseAlipayProductionCredentials(JSON.stringify({ ...credentials, approvalReference: "short" })), /approval reference/u);
  assert.throws(() => parseAlipayProductionCredentials(JSON.stringify({ ...credentials, credentialRotatedAt: "2099-01-01T00:00:00.000Z" })), /rotation time/u);
  assert.throws(() => parseAlipayProductionCredentials(JSON.stringify({ ...credentials, organizations: ["org_primary", "org_primary"] })), /duplicate organizations/u);
  const weak = pemPair(1024);
  assert.throws(() => parseAlipayProductionCredentials(JSON.stringify({ ...credentials, privateKey: weak.privateKey })), /at least 2048 bits/u);
  assert.throws(() => parseAlipayProductionCredentials(JSON.stringify({ ...credentials, alipayPublicKey: weak.publicKey })), /at least 2048 bits/u);
});

test("reconciliation mode writes official configuration without enabling checkout", () => {
  const source = "KAI_PUBLIC_ORIGIN=https://cloud.kai.com\nKAI_PAYMENT_PILOT_ENABLED=0\nKAI_ALIPAY_ENABLED=0\nKAI_ALIPAY_RECONCILIATION_ENABLED=0\n";
  const rendered = renderAlipayProductionEnvironment(source, credentials, "reconciliation");
  assert.match(rendered, /^KAI_PAYMENT_PILOT_ENABLED=0$/mu);
  assert.match(rendered, /^KAI_ALIPAY_ENABLED=0$/mu);
  assert.match(rendered, /^KAI_ALIPAY_RECONCILIATION_ENABLED=1$/mu);
  assert.match(rendered, /^KAI_PAYMENT_PILOT_ENABLED=0$/mu);
  assert.match(rendered, /^KAI_ALIPAY_APP_ID=2026000000000001$/mu);
  assert.match(rendered, /^KAI_ALIPAY_SELLER_ID=2088000000000001$/mu);
  assert.match(rendered, /^KAI_ALIPAY_GATEWAY=https:\/\/openapi\.alipay\.com\/gateway\.do$/mu);
  assert.match(rendered, /^KAI_ALIPAY_PILOT_ORGANIZATIONS=org_primary,org_supplier$/mu);
  assert.equal((rendered.match(/^KAI_ALIPAY_PRIVATE_KEY=/gmu) ?? []).length, 1);
  assert.match(rendered, /^KAI_ALIPAY_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----\\n/mu);
});

test("payment mode requires the identical reconciled configuration and enables the pilot", () => {
  const disabled = "KAI_PUBLIC_ORIGIN=https://cloud.kai.com\nKAI_PAYMENT_PILOT_ENABLED=0\nKAI_ALIPAY_ENABLED=0\nKAI_ALIPAY_RECONCILIATION_ENABLED=0\n";
  assert.throws(() => renderAlipayProductionEnvironment(disabled, credentials, "payment"), /verified Alipay reconciliation/u);
  const reconciled = renderAlipayProductionEnvironment(disabled, credentials, "reconciliation");
  const payment = renderAlipayProductionEnvironment(reconciled, credentials, "payment");
  assert.match(payment, /^KAI_PAYMENT_PILOT_ENABLED=1$/mu);
  assert.match(payment, /^KAI_ALIPAY_ENABLED=1$/mu);
  assert.match(payment, /^KAI_ALIPAY_RECONCILIATION_ENABLED=1$/mu);
  assert.throws(() => renderAlipayProductionEnvironment(reconciled.replace("KAI_ALIPAY_SELLER_ID=2088000000000001", "KAI_ALIPAY_SELLER_ID=2088000000000002"), credentials, "payment"), /configuration drift/u);
  assert.throws(() => renderAlipayProductionEnvironment(reconciled.replace("KAI_ALIPAY_GATEWAY=https://openapi.alipay.com/gateway.do", "KAI_ALIPAY_GATEWAY=https://example.com/gateway.do"), credentials, "payment"), /configuration drift/u);
});

test("payment mode atomically preserves rollback and never returns private material", async () => {
  const directory = await mkdtemp(join(tmpdir(), "kai-alipay-config-"));
  const envFile = join(directory, "kai-cloud-app.env");
  const credentialFile = join(directory, "alipay.json");
  const disabled = "KAI_PUBLIC_ORIGIN=https://cloud.kai.com\nKAI_PAYMENT_PILOT_ENABLED=0\nKAI_ALIPAY_ENABLED=0\nKAI_ALIPAY_RECONCILIATION_ENABLED=0\n";
  const reconciled = renderAlipayProductionEnvironment(disabled, credentials, "reconciliation");
  await writeFile(envFile, reconciled, { mode: 0o640 });
  await writeFile(credentialFile, JSON.stringify(credentials), { mode: 0o600 });
  await chmod(credentialFile, 0o600);
  const result = await configureAlipayProductionEnvironment({
    envFile,
    credentialFile,
    mode: "payment",
    now: new Date("2026-09-18T00:05:00.000Z"),
    requireRootOwner: false,
  });
  assert.equal(result.mode, "payment");
  assert.equal(result.organizationCount, 2);
  assert.equal(await readFile(result.backupFile, "utf8"), reconciled);
  assert.match(await readFile(envFile, "utf8"), /^KAI_PAYMENT_PILOT_ENABLED=1$/mu);
  assert.match(await readFile(envFile, "utf8"), /^KAI_ALIPAY_ENABLED=1$/mu);
  assert.equal((await stat(envFile)).mode & 0o777, 0o640);
  assert.equal((await stat(result.backupFile)).mode & 0o777, 0o640);
  assert.doesNotMatch(JSON.stringify(result), /BEGIN PRIVATE KEY|BEGIN PUBLIC KEY/u);
});

test("protected metadata rejects public and wrong-owner production files", () => {
  const regular = { isSymbolicLink: () => false, isFile: () => true, mode: 0o100640, uid: 0, gid: 0 };
  assert.doesNotThrow(() => validateProtectedMetadata(regular, { expectedMode: 0o640, requireRootOwner: true, label: "environment file" }));
  assert.throws(() => validateProtectedMetadata({ ...regular, mode: 0o100644 }, { expectedMode: 0o640, requireRootOwner: true, label: "environment file" }), /0640/u);
  assert.throws(() => validateProtectedMetadata({ ...regular, uid: 501 }, { expectedMode: 0o640, requireRootOwner: true, label: "environment file" }), /root-owned/u);
});

test("configuration rejects credential symlinks and public environment files", async () => {
  const directory = await mkdtemp(join(tmpdir(), "kai-alipay-negative-"));
  const envFile = join(directory, "app.env");
  const realCredential = join(directory, "real.json");
  const credentialLink = join(directory, "link.json");
  await writeFile(envFile, "KAI_ALIPAY_ENABLED=0\nKAI_ALIPAY_RECONCILIATION_ENABLED=0\n", { mode: 0o644 });
  await writeFile(realCredential, JSON.stringify(credentials), { mode: 0o600 });
  await symlink(realCredential, credentialLink);
  await assert.rejects(configureAlipayProductionEnvironment({ envFile, credentialFile: realCredential, mode: "reconciliation", requireRootOwner: false }), /0640/u);
  await chmod(envFile, 0o640);
  await assert.rejects(configureAlipayProductionEnvironment({ envFile, credentialFile: credentialLink, mode: "reconciliation", requireRootOwner: false }), /root-owned regular|ELOOP/u);
});
