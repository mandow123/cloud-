#!/usr/bin/env node

import { constants, lstat, open, rename, unlink } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isRevokedQixiangMerchantKey } from "../../lib/server/qixiang-pay-revoked-policy.mjs";

const CONFIRMATION = "CONFIGURE_QIXIANG_PRODUCTION_PAYMENT";
const MODES = new Set(["reconciliation", "payment"]);
const GATEWAY = "https://api.payqixiang.cn/mapi.php";
const QUERY_ENDPOINT = "https://api.payqixiang.cn/api.php";
const KEY_PATTERN = /^[A-Za-z0-9._~-]{16,2048}$/u;
const REFERENCE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{7,127}$/u;
const RISK_REFERENCE_PATTERN = /^RISK-[A-Za-z0-9][A-Za-z0-9._:/-]{7,119}$/u;
const QUERY_ID_PATTERN = /^QRY-[A-Za-z0-9][A-Za-z0-9._:-]{7,95}$/u;
const VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,63}$/u;
const ORGANIZATION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/u;
const UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;

function fail(message) { throw new Error(message); }

function cliArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!["--env-file", "--credential-file", "--mode", "--confirm"].includes(argument)) fail(`unknown argument: ${argument}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) fail(`${argument} requires a value`);
    options[argument.slice(2).replace(/-([a-z])/gu, (_, letter) => letter.toUpperCase())] = value;
    index += 1;
  }
  if (!isAbsolute(options.envFile ?? "") || !isAbsolute(options.credentialFile ?? "")) fail("environment and credential paths must be absolute");
  if (!MODES.has(options.mode)) fail("--mode must be reconciliation or payment");
  if (options.confirm !== CONFIRMATION) fail(`--confirm must be exactly ${CONFIRMATION}`);
  return { envFile: resolve(options.envFile), credentialFile: resolve(options.credentialFile), mode: options.mode };
}

function exactString(value, pattern, message) {
  if (typeof value !== "string" || value !== value.trim() || !pattern.test(value)) fail(message);
  return value;
}

export function parseQixiangProductionCredentials(text) {
  let value;
  try { value = JSON.parse(text); } catch { fail("credential file must contain JSON"); }
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("credential file must contain an object");
  const expected = ["approvalReference", "channel", "credentialRotatedAt", "credentialVersion", "key", "organizations", "pid", "queryCredentialId", "queryCredentialRotatedAt", "queryCredentialVersion", "riskReference"].sort();
  if (Object.keys(value).sort().join(",") !== expected.join(",")) fail("credential file contains unexpected or missing fields");
  const rawKeys = [...text.matchAll(/"((?:\\.|[^"\\])*)"\s*:/gu)].map((match) => match[1]);
  if (rawKeys.some((key) => key.includes("\\")) || rawKeys.sort().join(",") !== expected.join(",")) fail("credential file contains duplicate or escaped field names");
  const pid = exactString(value.pid, /^\d{1,18}$/u, "credential file contains an invalid merchant identifier");
  const key = exactString(value.key, KEY_PATTERN, "credential file contains an invalid merchant key");
  if (/(?:change[-_ ]?me|dummy|example|placeholder|replace|secret[-_ ]?here|your[-_ ])/iu.test(key)) fail("credential file contains a placeholder merchant key");
  if (isRevokedQixiangMerchantKey(key)) fail("credential file contains a revoked merchant key");
  const approvalReference = exactString(value.approvalReference, REFERENCE_PATTERN, "credential file contains an invalid approval reference");
  const credentialVersion = exactString(value.credentialVersion, VERSION_PATTERN, "credential file contains an invalid credential version");
  const credentialRotatedAt = exactTimestamp(value.credentialRotatedAt, "credential file contains an invalid credential rotation time");
  const riskReference = exactString(value.riskReference, RISK_REFERENCE_PATTERN, "credential file contains an invalid risk reference");
  const queryCredentialId = exactString(value.queryCredentialId, QUERY_ID_PATTERN, "credential file contains an invalid query credential ID");
  const queryCredentialVersion = exactString(value.queryCredentialVersion, VERSION_PATTERN, "credential file contains an invalid query credential version");
  const queryCredentialRotatedAt = exactTimestamp(value.queryCredentialRotatedAt, "credential file contains an invalid query credential rotation time");
  if (value.channel !== "ALIPAY") fail("the production rollout channel must be ALIPAY");
  if (!Array.isArray(value.organizations) || value.organizations.length < 1 || value.organizations.length > 20) fail("credential file must contain 1 to 20 organizations");
  const organizations = value.organizations.map((entry) => exactString(entry, ORGANIZATION_PATTERN, "credential file contains an invalid organization"));
  if (new Set(organizations).size !== organizations.length) fail("credential file contains duplicate organizations");
  return Object.freeze({ pid, key, approvalReference, credentialVersion, credentialRotatedAt, riskReference, queryCredentialId, queryCredentialVersion, queryCredentialRotatedAt, channel: "ALIPAY", organizations: Object.freeze(organizations) });
}

function exactTimestamp(value, message) {
  const text = exactString(value, UTC_PATTERN, message);
  const timestamp = Date.parse(text);
  if (!Number.isFinite(timestamp) || timestamp < Date.parse("2020-01-01T00:00:00.000Z") || timestamp > Date.now() + 5 * 60 * 1000) fail(message);
  return text;
}

function setEnvironmentLine(source, key, value) {
  const expression = new RegExp(`^${key}=.*$`, "gmu");
  const matches = source.match(expression) ?? [];
  if (matches.length > 1) fail(`${key} is duplicated in the environment file`);
  if (matches.length === 1) return source.replace(expression, `${key}=${value}`);
  return `${source.replace(/\s*$/u, "")}\n${key}=${value}\n`;
}

function environmentValues(source) {
  const values = new Map();
  for (const line of source.split(/\r?\n/u)) {
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const key = line.slice(0, separator);
    if (!/^[A-Z][A-Z0-9_]*$/u.test(key)) continue;
    if (values.has(key)) fail(`${key} is duplicated in the environment file`);
    values.set(key, line.slice(separator + 1));
  }
  return values;
}

function approvedValues(credentials) {
  return {
    KAI_QIXIANG_PAY_PID: credentials.pid,
    KAI_QIXIANG_PAY_KEY: credentials.key,
    KAI_QIXIANG_PAY_APPROVAL_REFERENCE: credentials.approvalReference,
    KAI_QIXIANG_PAY_CREDENTIAL_ROTATED_AT: credentials.credentialRotatedAt,
    KAI_QIXIANG_PAY_CREDENTIAL_VERSION: credentials.credentialVersion,
    KAI_QIXIANG_PAY_LEGACY_QUERY_RISK_ACCEPTED: "1",
    KAI_QIXIANG_PAY_LEGACY_QUERY_RISK_REFERENCE: credentials.riskReference,
    KAI_QIXIANG_PAY_QUERY_CREDENTIAL_ID: credentials.queryCredentialId,
    KAI_QIXIANG_PAY_QUERY_CREDENTIAL_ROTATED_AT: credentials.queryCredentialRotatedAt,
    KAI_QIXIANG_PAY_QUERY_CREDENTIAL_VERSION: credentials.queryCredentialVersion,
    KAI_QIXIANG_PAY_PILOT_ORGANIZATIONS: credentials.organizations.join(","),
    KAI_QIXIANG_PAY_PILOT_CHANNEL: credentials.channel,
    KAI_QIXIANG_PAY_CHANNELS: credentials.channel,
    KAI_QIXIANG_PAY_GATEWAY: GATEWAY,
    KAI_QIXIANG_PAY_QUERY_ENDPOINT: QUERY_ENDPOINT,
  };
}

export function renderQixiangProductionEnvironment(source, credentials, mode) {
  if (typeof source !== "string" || source.includes("\0")) fail("environment file is invalid");
  if (!MODES.has(mode)) fail("configuration mode is invalid");
  const current = environmentValues(source);
  const payment = current.get("KAI_QIXIANG_PAY_ENABLED") || "0";
  const reconciliation = current.get("KAI_QIXIANG_PAY_RECONCILIATION_ENABLED") || "0";
  const approved = approvedValues(credentials);
  if (mode === "reconciliation" && (payment !== "0" || reconciliation !== "0")) fail("reconciliation mode requires both production payment switches to be disabled");
  if (mode === "payment") {
    if (payment !== "0" || reconciliation !== "1") fail("payment mode requires verified reconciliation to be enabled while checkout remains disabled");
    for (const [key, value] of Object.entries(approved)) if (current.get(key) !== value) fail(`payment mode refuses configuration drift in ${key}`);
    return setEnvironmentLine(source, "KAI_QIXIANG_PAY_ENABLED", "1");
  }
  const values = { KAI_QIXIANG_PAY_ENABLED: "0", KAI_QIXIANG_PAY_RECONCILIATION_ENABLED: "1", ...approved };
  let result = source;
  for (const [key, value] of Object.entries(values)) result = setEnvironmentLine(result, key, value);
  return result.endsWith("\n") ? result : `${result}\n`;
}

function backupSuffix(now) { return now.toISOString().replace(/[-:]/gu, "").replace(/\.\d{3}Z$/u, "Z"); }

export function validateProtectedMetadata(metadata, { expectedMode, requireRootOwner, label }) {
  if (metadata.isSymbolicLink?.() || !metadata.isFile?.() || (metadata.mode & 0o777) !== expectedMode || (requireRootOwner && (metadata.uid !== 0 || metadata.gid !== 0))) fail(`${label} must be a root-owned regular file with mode ${expectedMode.toString(8).padStart(4, "0")}`);
}

async function validateParent(path, requireRootOwner) {
  const metadata = await lstat(dirname(path));
  if (metadata.isSymbolicLink() || !metadata.isDirectory() || (metadata.mode & 0o022) !== 0 || (requireRootOwner && (metadata.uid !== 0 || metadata.gid !== 0))) fail("configuration parent directory must not be writable by non-root users");
}

async function openProtected(path, expectedMode, label, requireRootOwner) {
  await validateParent(path, requireRootOwner);
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const metadata = await handle.stat();
    validateProtectedMetadata(metadata, { expectedMode, requireRootOwner, label });
    return { handle, metadata };
  } catch (error) {
    await handle.close().catch(() => {});
    throw error;
  }
}

async function writeProtected(path, contents, expectedMode, requireRootOwner) {
  const handle = await open(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, expectedMode);
  try {
    await handle.chmod(expectedMode);
    if (requireRootOwner) await handle.chown(0, 0);
    await handle.writeFile(contents, "utf8");
    await handle.sync();
  } finally { await handle.close(); }
}

async function syncParent(path) {
  const directory = await open(dirname(path), constants.O_RDONLY | constants.O_NOFOLLOW);
  try { await directory.sync(); } finally { await directory.close(); }
}

export async function configureQixiangProductionEnvironment({ envFile, credentialFile, mode, now = new Date(), requireRootOwner = true }) {
  if (!Number.isFinite(now.getTime())) fail("configuration time is invalid");
  const credential = await openProtected(credentialFile, 0o600, "credential file", requireRootOwner);
  let environment;
  let credentialText;
  let environmentText;
  try {
    environment = await openProtected(envFile, 0o640, "environment file", requireRootOwner);
    [credentialText, environmentText] = await Promise.all([credential.handle.readFile("utf8"), environment.handle.readFile("utf8")]);
  } finally {
    await credential.handle.close().catch(() => {});
    if (!credentialText || !environmentText) await environment?.handle.close().catch(() => {});
  }
  try {
    const credentials = parseQixiangProductionCredentials(credentialText);
    const nextEnvironment = renderQixiangProductionEnvironment(environmentText, credentials, mode);
    const backupFile = `${envFile}.pre-qixiang-${mode}-${backupSuffix(now)}`;
    const temporaryFile = `${envFile}.qixiang-${crypto.randomUUID()}.tmp`;
    await writeProtected(backupFile, environmentText, 0o640, requireRootOwner);
    await syncParent(backupFile);
    try {
      await writeProtected(temporaryFile, nextEnvironment, 0o640, requireRootOwner);
      const current = await lstat(envFile);
      if (current.isSymbolicLink() || current.dev !== environment.metadata.dev || current.ino !== environment.metadata.ino) fail("environment file changed during configuration");
      await rename(temporaryFile, envFile);
      await syncParent(envFile);
    } catch (error) {
      await unlink(temporaryFile).catch(() => {});
      throw error;
    }
    return Object.freeze({ status: "configured", mode, merchantAccountRef: credentials.pid, channel: credentials.channel, organizationCount: credentials.organizations.length, backupFile });
  } finally {
    await environment.handle.close().catch(() => {});
  }
}

async function main() {
  const options = cliArguments(process.argv.slice(2));
  const result = await configureQixiangProductionEnvironment(options);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write(`QIXIANG_CONFIGURATION_FAILED: ${error.message}\n`);
    process.exitCode = 1;
  });
}
