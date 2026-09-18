#!/usr/bin/env node

import { constants, lstat, open, rename, unlink } from "node:fs/promises";
import { createPrivateKey, createPublicKey, randomUUID } from "node:crypto";
import { dirname, isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const CONFIRMATION = "CONFIGURE_ALIPAY_PRODUCTION_PAYMENT";
const MODES = new Set(["reconciliation", "payment"]);
const GATEWAY = "https://openapi.alipay.com/gateway.do";
const IDENTIFIER_PATTERN = /^\d{16}$/u;
const REFERENCE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{7,127}$/u;
const VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,63}$/u;
const ORGANIZATION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/u;
const UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;
const EXPECTED_FIELDS = Object.freeze([
  "alipayPublicKey",
  "appId",
  "approvalReference",
  "credentialRotatedAt",
  "credentialVersion",
  "organizations",
  "privateKey",
  "privateKeyType",
  "sellerId",
].sort());

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

function exactTimestamp(value, message) {
  const text = exactString(value, UTC_PATTERN, message);
  const timestamp = Date.parse(text);
  if (!Number.isFinite(timestamp) || timestamp < Date.parse("2020-01-01T00:00:00.000Z") || timestamp > Date.now() + 5 * 60 * 1000) fail(message);
  return text;
}

function normalizedPem(value, expectedHeader, message) {
  if (typeof value !== "string" || value.includes("\0")) fail(message);
  const normalized = value.replaceAll("\\n", "\n").replaceAll("\r\n", "\n").trim();
  if (!normalized.startsWith(`-----BEGIN ${expectedHeader}-----`)
    || !normalized.endsWith(`-----END ${expectedHeader}-----`)
    || /(?:change[-_ ]?me|dummy|example|placeholder|replace|secret[-_ ]?here|your[-_ ])/iu.test(normalized)) fail(message);
  return normalized;
}

function validRsaKey(value, kind, message) {
  try {
    const key = kind === "private" ? createPrivateKey(value) : createPublicKey(value);
    if (key.asymmetricKeyType !== "rsa" || (key.asymmetricKeyDetails?.modulusLength ?? 0) < 2048) fail(message);
  } catch {
    fail(message);
  }
}

export function parseAlipayProductionCredentials(text) {
  let value;
  try { value = JSON.parse(text); } catch { fail("credential file must contain JSON"); }
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("credential file must contain an object");
  if (Object.keys(value).sort().join(",") !== EXPECTED_FIELDS.join(",")) fail("credential file contains unexpected or missing fields");
  const rawKeys = [...text.matchAll(/"((?:\\.|[^"\\])*)"\s*:/gu)].map((match) => match[1]);
  if (rawKeys.some((key) => key.includes("\\")) || rawKeys.sort().join(",") !== EXPECTED_FIELDS.join(",")) fail("credential file contains duplicate or escaped field names");

  const appId = exactString(value.appId, IDENTIFIER_PATTERN, "credential file contains an invalid Alipay application identifier");
  const sellerId = exactString(value.sellerId, IDENTIFIER_PATTERN, "credential file contains an invalid Alipay seller identifier");
  if (value.privateKeyType !== "PKCS8" && value.privateKeyType !== "PKCS1") fail("credential file privateKeyType must be exactly PKCS8 or PKCS1");
  const privateHeader = value.privateKeyType === "PKCS1" ? "RSA PRIVATE KEY" : "PRIVATE KEY";
  const privateKey = normalizedPem(value.privateKey, privateHeader, "credential file contains an invalid private RSA key");
  const alipayPublicKey = normalizedPem(value.alipayPublicKey, "PUBLIC KEY", "credential file contains an invalid Alipay public RSA key");
  validRsaKey(privateKey, "private", "credential file private RSA key must be parseable and at least 2048 bits");
  validRsaKey(alipayPublicKey, "public", "credential file Alipay public RSA key must be parseable and at least 2048 bits");
  const approvalReference = exactString(value.approvalReference, REFERENCE_PATTERN, "credential file contains an invalid approval reference");
  const credentialVersion = exactString(value.credentialVersion, VERSION_PATTERN, "credential file contains an invalid credential version");
  const credentialRotatedAt = exactTimestamp(value.credentialRotatedAt, "credential file contains an invalid credential rotation time");
  if (!Array.isArray(value.organizations) || value.organizations.length < 1 || value.organizations.length > 20) fail("credential file must contain 1 to 20 organizations");
  const organizations = value.organizations.map((entry) => exactString(entry, ORGANIZATION_PATTERN, "credential file contains an invalid organization"));
  if (new Set(organizations).size !== organizations.length) fail("credential file contains duplicate organizations");
  return Object.freeze({
    appId,
    privateKey,
    privateKeyType: value.privateKeyType,
    alipayPublicKey,
    sellerId,
    approvalReference,
    credentialVersion,
    credentialRotatedAt,
    organizations: Object.freeze(organizations),
  });
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

function envPem(value) { return value.replaceAll("\n", "\\n"); }

function approvedValues(credentials) {
  return {
    KAI_ALIPAY_APP_ID: credentials.appId,
    KAI_ALIPAY_PRIVATE_KEY: envPem(credentials.privateKey.trim()),
    KAI_ALIPAY_PRIVATE_KEY_TYPE: credentials.privateKeyType,
    KAI_ALIPAY_PUBLIC_KEY: envPem(credentials.alipayPublicKey.trim()),
    KAI_ALIPAY_SELLER_ID: credentials.sellerId,
    KAI_ALIPAY_GATEWAY: GATEWAY,
    KAI_ALIPAY_APPROVAL_REFERENCE: credentials.approvalReference,
    KAI_ALIPAY_CREDENTIAL_VERSION: credentials.credentialVersion,
    KAI_ALIPAY_CREDENTIAL_ROTATED_AT: credentials.credentialRotatedAt,
    KAI_ALIPAY_PILOT_ORGANIZATIONS: credentials.organizations.join(","),
  };
}

export function renderAlipayProductionEnvironment(source, credentials, mode) {
  if (typeof source !== "string" || source.includes("\0")) fail("environment file is invalid");
  if (!MODES.has(mode)) fail("configuration mode is invalid");
  const current = environmentValues(source);
  const checkout = current.get("KAI_ALIPAY_ENABLED") || "0";
  const reconciliation = current.get("KAI_ALIPAY_RECONCILIATION_ENABLED") || "0";
  const approved = approvedValues(credentials);

  if (mode === "reconciliation" && (checkout !== "0" || reconciliation !== "0")) {
    fail("reconciliation mode requires both Alipay checkout and reconciliation to be disabled");
  }
  if (mode === "payment") {
    if (checkout !== "0" || reconciliation !== "1") fail("payment mode requires verified Alipay reconciliation while checkout remains disabled");
    for (const [key, value] of Object.entries(approved)) {
      if (current.get(key) !== value) fail(`payment mode refuses configuration drift in ${key}`);
    }
    let result = setEnvironmentLine(source, "KAI_PAYMENT_PILOT_ENABLED", "1");
    result = setEnvironmentLine(result, "KAI_ALIPAY_ENABLED", "1");
    result = setEnvironmentLine(result, "KAI_ALIPAY_RECONCILIATION_ENABLED", "1");
    return result.endsWith("\n") ? result : `${result}\n`;
  }

  const values = {
    KAI_PAYMENT_PILOT_ENABLED: "0",
    KAI_ALIPAY_ENABLED: "0",
    KAI_ALIPAY_RECONCILIATION_ENABLED: "1",
    ...approved,
  };
  let result = source;
  for (const [key, value] of Object.entries(values)) result = setEnvironmentLine(result, key, value);
  return result.endsWith("\n") ? result : `${result}\n`;
}

function backupSuffix(now) { return now.toISOString().replace(/[-:]/gu, "").replace(/\.\d{3}Z$/u, "Z"); }

export function validateProtectedMetadata(metadata, { expectedMode, requireRootOwner, label }) {
  if (metadata.isSymbolicLink?.() || !metadata.isFile?.() || (metadata.mode & 0o777) !== expectedMode || (requireRootOwner && (metadata.uid !== 0 || metadata.gid !== 0))) {
    fail(`${label} must be a root-owned regular file with mode ${expectedMode.toString(8).padStart(4, "0")}`);
  }
}

async function validateParent(path, requireRootOwner) {
  const metadata = await lstat(dirname(path));
  if (metadata.isSymbolicLink() || !metadata.isDirectory() || (metadata.mode & 0o022) !== 0 || (requireRootOwner && (metadata.uid !== 0 || metadata.gid !== 0))) {
    fail("configuration parent directory must not be writable by non-root users");
  }
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
  } finally {
    await handle.close();
  }
}

async function syncParent(path) {
  const directory = await open(dirname(path), constants.O_RDONLY | constants.O_NOFOLLOW);
  try { await directory.sync(); } finally { await directory.close(); }
}

export async function configureAlipayProductionEnvironment({ envFile, credentialFile, mode, now = new Date(), requireRootOwner = true }) {
  if (!Number.isFinite(now.getTime())) fail("configuration time is invalid");
  const credential = await openProtected(credentialFile, 0o600, "credential file", requireRootOwner);
  let environment;
  try {
    environment = await openProtected(envFile, 0o640, "environment file", requireRootOwner);
    const [credentialText, environmentText] = await Promise.all([
      credential.handle.readFile("utf8"),
      environment.handle.readFile("utf8"),
    ]);
    const credentials = parseAlipayProductionCredentials(credentialText);
    const nextEnvironment = renderAlipayProductionEnvironment(environmentText, credentials, mode);
    const backupFile = `${envFile}.pre-alipay-${mode}-${backupSuffix(now)}`;
    const temporaryFile = `${envFile}.alipay-${randomUUID()}.tmp`;
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
    return Object.freeze({
      status: "configured",
      mode,
      applicationId: credentials.appId,
      merchantAccountRef: credentials.sellerId,
      organizationCount: credentials.organizations.length,
      backupFile,
    });
  } finally {
    await credential.handle.close().catch(() => {});
    await environment?.handle.close().catch(() => {});
  }
}

async function main() {
  const options = cliArguments(process.argv.slice(2));
  const result = await configureAlipayProductionEnvironment(options);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write(`ALIPAY_CONFIGURATION_FAILED: ${error.message}\n`);
    process.exitCode = 1;
  });
}
