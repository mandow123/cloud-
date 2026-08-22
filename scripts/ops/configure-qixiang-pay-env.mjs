#!/usr/bin/env node

import { constants, copyFile, lstat, open, readFile, rename, unlink } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";

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
  const expected = ["approvalReference", "channel", "credentialVersion", "key", "organizations", "pid", "queryCredentialId", "queryCredentialVersion", "riskReference"].sort();
  if (Object.keys(value).sort().join(",") !== expected.join(",")) fail("credential file contains unexpected or missing fields");
  const pid = exactString(value.pid, /^\d{1,18}$/u, "credential file contains an invalid merchant identifier");
  const key = exactString(value.key, KEY_PATTERN, "credential file contains an invalid merchant key");
  if (/(?:change[-_ ]?me|dummy|example|placeholder|replace|secret[-_ ]?here|your[-_ ])/iu.test(key)) fail("credential file contains a placeholder merchant key");
  const approvalReference = exactString(value.approvalReference, REFERENCE_PATTERN, "credential file contains an invalid approval reference");
  const credentialVersion = exactString(value.credentialVersion, VERSION_PATTERN, "credential file contains an invalid credential version");
  const riskReference = exactString(value.riskReference, RISK_REFERENCE_PATTERN, "credential file contains an invalid risk reference");
  const queryCredentialId = exactString(value.queryCredentialId, QUERY_ID_PATTERN, "credential file contains an invalid query credential ID");
  const queryCredentialVersion = exactString(value.queryCredentialVersion, VERSION_PATTERN, "credential file contains an invalid query credential version");
  if (value.channel !== "ALIPAY") fail("the production rollout channel must be ALIPAY");
  if (!Array.isArray(value.organizations) || value.organizations.length < 1 || value.organizations.length > 20) fail("credential file must contain 1 to 20 organizations");
  const organizations = value.organizations.map((entry) => exactString(entry, ORGANIZATION_PATTERN, "credential file contains an invalid organization"));
  if (new Set(organizations).size !== organizations.length) fail("credential file contains duplicate organizations");
  return Object.freeze({ pid, key, approvalReference, credentialVersion, riskReference, queryCredentialId, queryCredentialVersion, channel: "ALIPAY", organizations: Object.freeze(organizations) });
}

function setEnvironmentLine(source, key, value) {
  const expression = new RegExp(`^${key}=.*$`, "gmu");
  const matches = source.match(expression) ?? [];
  if (matches.length > 1) fail(`${key} is duplicated in the environment file`);
  if (matches.length === 1) return source.replace(expression, `${key}=${value}`);
  return `${source.replace(/\s*$/u, "")}\n${key}=${value}\n`;
}

export function renderQixiangProductionEnvironment(source, credentials, mode, now = new Date()) {
  if (typeof source !== "string" || source.includes("\0")) fail("environment file is invalid");
  if (!MODES.has(mode)) fail("configuration mode is invalid");
  if (!Number.isFinite(now.getTime())) fail("configuration time is invalid");
  const values = {
    KAI_QIXIANG_PAY_ENABLED: mode === "payment" ? "1" : "0",
    KAI_QIXIANG_PAY_RECONCILIATION_ENABLED: "1",
    KAI_QIXIANG_PAY_PID: credentials.pid,
    KAI_QIXIANG_PAY_KEY: credentials.key,
    KAI_QIXIANG_PAY_APPROVAL_REFERENCE: credentials.approvalReference,
    KAI_QIXIANG_PAY_CREDENTIAL_ROTATED_AT: now.toISOString(),
    KAI_QIXIANG_PAY_CREDENTIAL_VERSION: credentials.credentialVersion,
    KAI_QIXIANG_PAY_LEGACY_QUERY_RISK_ACCEPTED: "1",
    KAI_QIXIANG_PAY_LEGACY_QUERY_RISK_REFERENCE: credentials.riskReference,
    KAI_QIXIANG_PAY_QUERY_CREDENTIAL_ID: credentials.queryCredentialId,
    KAI_QIXIANG_PAY_QUERY_CREDENTIAL_ROTATED_AT: now.toISOString(),
    KAI_QIXIANG_PAY_QUERY_CREDENTIAL_VERSION: credentials.queryCredentialVersion,
    KAI_QIXIANG_PAY_PILOT_ORGANIZATIONS: credentials.organizations.join(","),
    KAI_QIXIANG_PAY_PILOT_CHANNEL: credentials.channel,
    KAI_QIXIANG_PAY_CHANNELS: credentials.channel,
    KAI_QIXIANG_PAY_GATEWAY: GATEWAY,
    KAI_QIXIANG_PAY_QUERY_ENDPOINT: QUERY_ENDPOINT,
  };
  let result = source;
  for (const [key, value] of Object.entries(values)) result = setEnvironmentLine(result, key, value);
  return result.endsWith("\n") ? result : `${result}\n`;
}

function backupSuffix(now) { return now.toISOString().replace(/[-:]/gu, "").replace(/\.\d{3}Z$/u, "Z"); }

export async function configureQixiangProductionEnvironment({ envFile, credentialFile, mode, now = new Date(), requireRootOwner = true }) {
  const credentialMetadata = await lstat(credentialFile);
  if (credentialMetadata.isSymbolicLink() || !credentialMetadata.isFile() || (credentialMetadata.mode & 0o077) !== 0 || (requireRootOwner && credentialMetadata.uid !== 0)) fail("credential file must be a root-owned private regular file");
  const environmentMetadata = await lstat(envFile);
  if (environmentMetadata.isSymbolicLink() || !environmentMetadata.isFile() || (environmentMetadata.mode & 0o022) !== 0 || (requireRootOwner && environmentMetadata.uid !== 0)) fail("environment file must be a protected root-owned regular file");
  const credentials = parseQixiangProductionCredentials(await readFile(credentialFile, "utf8"));
  const nextEnvironment = renderQixiangProductionEnvironment(await readFile(envFile, "utf8"), credentials, mode, now);
  const backupFile = `${envFile}.pre-qixiang-${mode}-${backupSuffix(now)}`;
  const temporaryFile = `${envFile}.qixiang-${crypto.randomUUID()}.tmp`;
  await copyFile(envFile, backupFile, constants.COPYFILE_EXCL);
  let handle;
  try {
    handle = await open(temporaryFile, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, environmentMetadata.mode & 0o777);
    await handle.writeFile(nextEnvironment, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporaryFile, envFile);
    const directory = await open(dirname(envFile), "r");
    try { await directory.sync(); } finally { await directory.close(); }
  } catch (error) {
    if (handle) await handle.close().catch(() => {});
    await unlink(temporaryFile).catch(() => {});
    throw error;
  }
  return Object.freeze({ status: "configured", mode, merchantAccountRef: credentials.pid, channel: credentials.channel, organizationCount: credentials.organizations.length, backupFile });
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
