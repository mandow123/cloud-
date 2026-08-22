#!/usr/bin/env node

import { accessSync, constants, existsSync, lstatSync, realpathSync } from "node:fs";
import { isIP } from "node:net";
import { posix } from "node:path";
import { pathToFileURL } from "node:url";

const REQUIRED_CONTAINER_STATE_PATHS = Object.freeze({
  KAI_DB_DIR: "/app/db",
  KAI_MARKET_DATA_DIR: "/app/market",
});

const PLACEHOLDER_SECRET_PATTERN = /(?:change[-_ ]?me|deployment[-_ ]?validation|dummy|example|insert|placeholder|replace|secret[-_ ]?here|test[-_ ]?secret|your[-_ ])/i;
const IMAGE_DIGEST_PATTERN = /^[0-9a-f]{64}$/;
const RELEASE_SHA_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const REPOSITORY_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+)*(?::[0-9]+)?(?:\/[a-z0-9]+(?:[._-][a-z0-9]+)*)*$/;
const HOSTING_IMAGE_PATTERN = /^ghcr\.io\/(?:kai-cloud\/cuda-pytorch|mandow123\/kai-cloud-gpu-workload)@sha256:[a-f0-9]{64}$/;
const QIXIANG_PAY_APPROVAL_REFERENCE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{7,127}$/;
const QIXIANG_PAY_CREDENTIAL_VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,63}$/;
const QIXIANG_PAY_LEGACY_QUERY_RISK_REFERENCE_PATTERN = /^RISK-[A-Za-z0-9][A-Za-z0-9._:/-]{7,119}$/;
const QIXIANG_PAY_QUERY_CREDENTIAL_ID_PATTERN = /^QRY-[A-Za-z0-9][A-Za-z0-9._:-]{7,95}$/;

export class ProductionEnvironmentError extends Error {
  constructor(errors) {
    super(`Production environment rejected:\n- ${errors.join("\n- ")}`);
    this.name = "ProductionEnvironmentError";
    this.code = "PRODUCTION_ENVIRONMENT_REJECTED";
    this.errors = errors;
  }
}

function hasControlCharacters(value) {
  return /[\u0000-\u001f\u007f]/u.test(value);
}

function validateCursorSecret(value, errors) {
  if (typeof value !== "string" || value.trim() !== value || Buffer.byteLength(value, "utf8") < 32) {
    errors.push("KAI_CURSOR_SECRET must contain at least 32 UTF-8 bytes with no surrounding whitespace");
    return;
  }
  if (hasControlCharacters(value) || PLACEHOLDER_SECRET_PATTERN.test(value) || new Set(value).size < 8) {
    errors.push("KAI_CURSOR_SECRET must be a non-placeholder, high-entropy secret");
  }
}

function validatePublicOrigin(value, errors) {
  if (typeof value !== "string" || value.trim() !== value || value.length === 0) {
    errors.push("KAI_PUBLIC_ORIGIN must be a canonical HTTPS origin");
    return;
  }
  try {
    const parsed = new URL(value);
    const hostname = parsed.hostname.toLowerCase();
    const forbiddenHostname = hostname === "localhost"
      || hostname.endsWith(".localhost")
      || hostname.endsWith(".local")
      || hostname.endsWith(".invalid")
      || isIP(hostname) !== 0;
    const canonical = parsed.protocol === "https:"
      && parsed.username === ""
      && parsed.password === ""
      && parsed.port === ""
      && parsed.pathname === "/"
      && parsed.search === ""
      && parsed.hash === ""
      && parsed.origin === value
      && hostname.includes(".")
      && !forbiddenHostname;
    if (!canonical) errors.push("KAI_PUBLIC_ORIGIN must be a canonical public HTTPS origin without a path, query, fragment, credentials, port, or trailing slash");
  } catch {
    errors.push("KAI_PUBLIC_ORIGIN must be a valid canonical HTTPS origin");
  }
}

function validateReleaseSha(value, errors) {
  if (typeof value !== "string" || !RELEASE_SHA_PATTERN.test(value) || /^0+$/.test(value)) {
    errors.push("KAI_RELEASE_SHA must be a non-placeholder lowercase 40- or 64-character hexadecimal Git object ID");
  }
}

function validateImageReference(value, errors) {
  if (typeof value !== "string" || value.trim() !== value || hasControlCharacters(value)) {
    errors.push("KAI_IMAGE_REFERENCE must be repository@sha256:<64 lowercase hexadecimal characters>");
    return;
  }
  const marker = "@sha256:";
  const markerIndex = value.indexOf(marker);
  const repository = markerIndex > 0 ? value.slice(0, markerIndex) : "";
  const digest = markerIndex > 0 ? value.slice(markerIndex + marker.length) : "";
  const immutable = markerIndex > 0
    && value.lastIndexOf(marker) === markerIndex
    && !value.includes("://")
    && REPOSITORY_PATTERN.test(repository)
    && IMAGE_DIGEST_PATTERN.test(digest)
    && !/^0+$/.test(digest);
  if (!immutable) errors.push("KAI_IMAGE_REFERENCE must be an immutable, non-placeholder repository@sha256:<64 lowercase hexadecimal characters> reference");
}

function validAdminPasswordHash(value) {
  const match = /^pbkdf2-sha256:(\d{6,7}):([A-Za-z0-9+/]{22,}={0,2}):([A-Za-z0-9+/]{43}={0,2})$/.exec(value ?? "");
  return Boolean(match && Number(match[1]) >= 310_000 && Number(match[1]) <= 1_000_000);
}

function validateContainerStatePath(name, value, expected, errors, checkFilesystem) {
  if (typeof value !== "string"
    || hasControlCharacters(value)
    || !posix.isAbsolute(value)
    || posix.normalize(value) !== value
    || value !== expected) {
    errors.push(`${name} must be the safe absolute container path ${expected}`);
    return;
  }
  if (!checkFilesystem) return;
  try {
    if (!existsSync(value) || !lstatSync(value).isDirectory() || realpathSync(value) !== expected) {
      errors.push(`${name} must exist as a real directory mounted at ${expected}`);
      return;
    }
    accessSync(value, name === "KAI_DB_DIR" ? constants.R_OK | constants.W_OK : constants.R_OK);
  } catch {
    errors.push(`${name} must exist with the required application-user access at ${expected}`);
  }
}

export function validateStateRoot(value, { checkFilesystem = false } = {}) {
  const errors = [];
  const safeShape = typeof value === "string"
    && !hasControlCharacters(value)
    && posix.isAbsolute(value)
    && posix.normalize(value) === value
    && /^\/opt\/kai-cloud(?:-[a-z0-9][a-z0-9._-]*)?$/.test(value);
  if (!safeShape) {
    errors.push("KAI_STATE_ROOT must be a normalized absolute path dedicated to KAI Cloud under /opt (for example /opt/kai-cloud-3051)");
  } else if (checkFilesystem) {
    for (const child of ["db", "market", "backups"]) {
      const candidate = posix.join(value, child);
      try {
        if (!existsSync(candidate) || !lstatSync(candidate).isDirectory() || realpathSync(candidate) !== candidate) {
          errors.push(`${candidate} must exist as a real directory and must not be a symbolic link`);
        }
      } catch {
        errors.push(`${candidate} must exist and be readable before deployment`);
      }
    }
  }
  if (errors.length > 0) throw new ProductionEnvironmentError(errors);
  return value;
}

export function validateProductionEnvironment(environment = process.env, { checkFilesystem = false } = {}) {
  const errors = [];
  validateCursorSecret(environment.KAI_CURSOR_SECRET, errors);
  validatePublicOrigin(environment.KAI_PUBLIC_ORIGIN, errors);
  validateReleaseSha(environment.KAI_RELEASE_SHA, errors);
  validateImageReference(environment.KAI_IMAGE_REFERENCE, errors);
  if (environment.KAI_TRUST_PROXY !== "1") errors.push("KAI_TRUST_PROXY must be exactly 1 in the supported reverse-proxy deployment");
  if (environment.KAI_REQUIRE_HTTPS_WRITES !== "1") errors.push("KAI_REQUIRE_HTTPS_WRITES must be exactly 1 in production");
  if (environment.KAI_ENABLE_HSTS !== "0" && environment.KAI_ENABLE_HSTS !== "1") {
    errors.push("KAI_ENABLE_HSTS must be exactly 0 or 1");
  }
  if (environment.KAI_ALIPAY_ENABLED !== "0") errors.push("KAI_ALIPAY_ENABLED must remain exactly 0 during the trial rollout");
  const qixiangPayEnabled = environment.KAI_QIXIANG_PAY_ENABLED ?? "0";
  const qixiangReconciliationEnabled = environment.KAI_QIXIANG_PAY_RECONCILIATION_ENABLED ?? "0";
  if (qixiangPayEnabled !== "0" && qixiangPayEnabled !== "1") errors.push("KAI_QIXIANG_PAY_ENABLED must be exactly 0 or 1");
  if (qixiangReconciliationEnabled !== "0" && qixiangReconciliationEnabled !== "1") errors.push("KAI_QIXIANG_PAY_RECONCILIATION_ENABLED must be exactly 0 or 1");
  if (qixiangPayEnabled === "1" && qixiangReconciliationEnabled !== "1") errors.push("KAI_QIXIANG_PAY_RECONCILIATION_ENABLED must be exactly 1 before new Qixiang Pay orders are enabled");
  const validQixiangCredentialLifecycle = (rotatedAtName, versionName) => {
    const rotatedAtText = environment[rotatedAtName]?.trim() ?? "";
    const rotatedAt = Date.parse(rotatedAtText);
    const validRotation = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(rotatedAtText)
      && Number.isFinite(rotatedAt)
      && rotatedAt >= Date.parse("2020-01-01T00:00:00.000Z")
      && rotatedAt <= Date.now() + 5 * 60 * 1000;
    return validRotation || QIXIANG_PAY_CREDENTIAL_VERSION_PATTERN.test(environment[versionName]?.trim() ?? "");
  };
  if (qixiangPayEnabled === "1" || qixiangReconciliationEnabled === "1") {
    if (!/^\d{1,18}$/.test(environment.KAI_QIXIANG_PAY_PID ?? "")) errors.push("KAI_QIXIANG_PAY_PID must be a valid merchant identifier when Qixiang Pay or reconciliation is enabled");
    const qixiangPayKey = environment.KAI_QIXIANG_PAY_KEY?.trim() ?? "";
    if (environment.KAI_QIXIANG_PAY_KEY !== qixiangPayKey
      || Buffer.byteLength(qixiangPayKey, "utf8") < 16
      || PLACEHOLDER_SECRET_PATTERN.test(qixiangPayKey)) errors.push("KAI_QIXIANG_PAY_KEY must be a non-placeholder secret of at least 16 bytes when Qixiang Pay or reconciliation is enabled");
    if ((environment.KAI_QIXIANG_PAY_QUERY_ENDPOINT || "https://api.payqixiang.cn/api.php") !== "https://api.payqixiang.cn/api.php") errors.push("KAI_QIXIANG_PAY_QUERY_ENDPOINT must use the approved HTTPS api.php endpoint");
    if (!QIXIANG_PAY_APPROVAL_REFERENCE_PATTERN.test(environment.KAI_QIXIANG_PAY_APPROVAL_REFERENCE?.trim() ?? "")) errors.push("KAI_QIXIANG_PAY_APPROVAL_REFERENCE must identify the approved production change when Qixiang Pay or reconciliation is enabled");
    if (!validQixiangCredentialLifecycle("KAI_QIXIANG_PAY_CREDENTIAL_ROTATED_AT", "KAI_QIXIANG_PAY_CREDENTIAL_VERSION")) errors.push("KAI_QIXIANG_PAY_CREDENTIAL_ROTATED_AT or KAI_QIXIANG_PAY_CREDENTIAL_VERSION must identify the approved merchant credential lifecycle");
    if (environment.KAI_QIXIANG_PAY_LEGACY_QUERY_RISK_ACCEPTED !== "1") errors.push("KAI_QIXIANG_PAY_LEGACY_QUERY_RISK_ACCEPTED must be exactly 1 when Qixiang Pay or reconciliation is enabled");
    if (!QIXIANG_PAY_LEGACY_QUERY_RISK_REFERENCE_PATTERN.test(environment.KAI_QIXIANG_PAY_LEGACY_QUERY_RISK_REFERENCE?.trim() ?? "")) errors.push("KAI_QIXIANG_PAY_LEGACY_QUERY_RISK_REFERENCE must identify the written key-in-GET risk acceptance");
    if (!QIXIANG_PAY_QUERY_CREDENTIAL_ID_PATTERN.test(environment.KAI_QIXIANG_PAY_QUERY_CREDENTIAL_ID?.trim() ?? "")) errors.push("KAI_QIXIANG_PAY_QUERY_CREDENTIAL_ID must be a non-secret QRY-prefixed credential identifier");
    if (!validQixiangCredentialLifecycle("KAI_QIXIANG_PAY_QUERY_CREDENTIAL_ROTATED_AT", "KAI_QIXIANG_PAY_QUERY_CREDENTIAL_VERSION")) errors.push("KAI_QIXIANG_PAY_QUERY_CREDENTIAL_ROTATED_AT or KAI_QIXIANG_PAY_QUERY_CREDENTIAL_VERSION must identify the active query credential lifecycle");
  }
  if (qixiangPayEnabled === "1") {
    const channels = (environment.KAI_QIXIANG_PAY_CHANNELS ?? "").split(",").map((value) => value.trim()).filter(Boolean);
    if (channels.length !== 1 || channels[0] !== "ALIPAY") errors.push("KAI_QIXIANG_PAY_CHANNELS must contain only ALIPAY during production acceptance");
    const pilotOrganizations = (environment.KAI_QIXIANG_PAY_PILOT_ORGANIZATIONS ?? "").split(",").map((value) => value.trim()).filter(Boolean);
    if (pilotOrganizations.length < 1 || pilotOrganizations.length > 20 || pilotOrganizations.some((value) => !/^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/.test(value)) || new Set(pilotOrganizations).size !== pilotOrganizations.length) errors.push("KAI_QIXIANG_PAY_PILOT_ORGANIZATIONS must contain 1-20 unique approved organization identifiers when Qixiang Pay is enabled");
    const pilotChannel = environment.KAI_QIXIANG_PAY_PILOT_CHANNEL?.trim() ?? "";
    if (pilotChannel !== "ALIPAY" || channels[0] !== pilotChannel) errors.push("KAI_QIXIANG_PAY_PILOT_CHANNEL must be ALIPAY during production acceptance");
    if ((environment.KAI_QIXIANG_PAY_GATEWAY || "https://api.payqixiang.cn/mapi.php") !== "https://api.payqixiang.cn/mapi.php") errors.push("KAI_QIXIANG_PAY_GATEWAY must use the approved HTTPS mapi.php endpoint");
  }
  const buyCatalogV2 = environment.KAI_BUY_CATALOG_V2 ?? "0";
  if (buyCatalogV2 !== "0" && buyCatalogV2 !== "1") errors.push("KAI_BUY_CATALOG_V2 must be exactly 0 or 1");
  const accountConsoleV2 = environment.KAI_ACCOUNT_CONSOLE_V2 ?? "0";
  if (accountConsoleV2 !== "0" && accountConsoleV2 !== "1") errors.push("KAI_ACCOUNT_CONSOLE_V2 must be exactly 0 or 1");
  const fulfillmentUsername = environment.KAI_ADMIN_FULFILLMENT_USERNAME ?? "";
  const fulfillmentHash = environment.KAI_ADMIN_FULFILLMENT_PASSWORD_HASH ?? "";
  if (fulfillmentUsername || fulfillmentHash) {
    if (!/^[a-z0-9][a-z0-9._-]{2,63}$/.test(fulfillmentUsername)
      || fulfillmentUsername === environment.KAI_ADMIN_USERNAME
      || fulfillmentUsername === environment.KAI_ADMIN_APPROVER_USERNAME) {
      errors.push("KAI_ADMIN_FULFILLMENT_USERNAME must be a separate valid password administrator");
    }
    if (!validAdminPasswordHash(fulfillmentHash)) {
      errors.push("KAI_ADMIN_FULFILLMENT_PASSWORD_HASH must be a valid PBKDF2 hash");
    } else if (fulfillmentHash === environment.KAI_ADMIN_PASSWORD_HASH || fulfillmentHash === environment.KAI_ADMIN_APPROVER_PASSWORD_HASH) {
      errors.push("KAI_ADMIN_FULFILLMENT_PASSWORD_HASH must use a different password from other administrators");
    }
  }
  if (environment.KAI_HOSTING_V2 !== "0" && environment.KAI_HOSTING_V2 !== "1") errors.push("KAI_HOSTING_V2 must be exactly 0 or 1");
  if (environment.KAI_HOSTING_V2_SETUP !== "0" && environment.KAI_HOSTING_V2_SETUP !== "1") errors.push("KAI_HOSTING_V2_SETUP must be exactly 0 or 1");
  const agentTelemetryV1 = environment.KAI_AGENT_TELEMETRY_V1 ?? "0";
  if (agentTelemetryV1 !== "0" && agentTelemetryV1 !== "1") errors.push("KAI_AGENT_TELEMETRY_V1 must be exactly 0 or 1");
  const manualAppealsV1 = environment.KAI_MANUAL_APPEALS_V1 ?? "0";
  if (manualAppealsV1 !== "0" && manualAppealsV1 !== "1") errors.push("KAI_MANUAL_APPEALS_V1 must be exactly 0 or 1");
  const manualOrderFlowV1 = environment.KAI_MANUAL_ORDER_FLOW_V1 ?? "0";
  if (manualOrderFlowV1 !== "0" && manualOrderFlowV1 !== "1") errors.push("KAI_MANUAL_ORDER_FLOW_V1 must be exactly 0 or 1");
  if (environment.KAI_HOSTING_DEVICE_RETIREMENT !== "0" && environment.KAI_HOSTING_DEVICE_RETIREMENT !== "1") errors.push("KAI_HOSTING_DEVICE_RETIREMENT must be exactly 0 or 1");
  if (environment.KAI_HOSTING_DEVICE_RETIREMENT === "1" && environment.KAI_HOSTING_V2_SETUP !== "1" && environment.KAI_HOSTING_V2 !== "1") {
    errors.push("KAI_HOSTING_DEVICE_RETIREMENT requires Hosting V2 setup or trading to be enabled");
  }
  if (environment.KAI_HOSTING_V2 === "1" || environment.KAI_HOSTING_V2_SETUP === "1") {
    const rootUsername = environment.KAI_ADMIN_USERNAME ?? "";
    if (!/^[a-z0-9][a-z0-9._-]{2,63}$/.test(rootUsername)) {
      errors.push("KAI_ADMIN_USERNAME must be a valid password administrator when Hosting V2 setup or trading is enabled");
    }
    if (!validAdminPasswordHash(environment.KAI_ADMIN_PASSWORD_HASH)) {
      errors.push("KAI_ADMIN_PASSWORD_HASH must be a valid PBKDF2 hash when Hosting V2 setup or trading is enabled");
    }
    const images = (environment.KAI_HOSTING_APPROVED_IMAGES ?? "").split(/[\n,]/).map((value) => value.trim()).filter(Boolean);
    if (images.length < 1 || images.length > 20 || new Set(images).size !== images.length || images.some((image) => !HOSTING_IMAGE_PATTERN.test(image))) {
      errors.push("KAI_HOSTING_APPROVED_IMAGES must contain 1-20 unique immutable controlled image digests when Hosting V2 setup or trading is enabled");
    }
    if (!/^KAI_HOSTING_TERMS_\d{4}_\d{2}$/.test(environment.KAI_HOSTING_TERMS_VERSION ?? "")) {
      errors.push("KAI_HOSTING_TERMS_VERSION must be a dated immutable version when Hosting V2 setup or trading is enabled");
    }
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$/.test(environment.KAI_ACCOUNT_OIDC_CLIENT_ID ?? "")) {
      errors.push("KAI_ACCOUNT_OIDC_CLIENT_ID must be a valid Client ID when Hosting V2 setup or trading is enabled");
    }
    const issuer = environment.KAI_ACCOUNT_OIDC_ISSUER?.trim() || "https://account.kai.com/connect";
    if (issuer !== "https://account.kai.com/connect" && issuer !== "https://auth.kai.com/api/auth") {
      errors.push("KAI_ACCOUNT_OIDC_ISSUER must be an approved KAI Identity issuer when Hosting V2 setup or trading is enabled");
    }
    if (issuer === "https://auth.kai.com/api/auth" && Buffer.byteLength(environment.KAI_ACCOUNT_OIDC_CLIENT_SECRET?.trim() ?? "", "utf8") < 16) {
      errors.push("KAI_ACCOUNT_OIDC_CLIENT_SECRET must be configured for the auth.kai.com server Web client");
    }
    const scopes = (environment.KAI_ACCOUNT_OIDC_SCOPES?.trim() || (issuer === "https://auth.kai.com/api/auth" ? "openid profile email" : "openid kai:name email")).replace(/\s+/g, " ");
    const scopeList = scopes.split(" ");
    if (!/^[A-Za-z0-9:._-]+(?: [A-Za-z0-9:._-]+)*$/.test(scopes) || scopeList.length > 12 || new Set(scopeList).size !== scopeList.length || !scopeList.includes("openid") || !scopeList.includes("email")) {
      errors.push("KAI_ACCOUNT_OIDC_SCOPES must contain unique openid and email scopes");
    }
    const transactionSecret = environment.KAI_ACCOUNT_OIDC_TRANSACTION_SECRET ?? "";
    if (Buffer.byteLength(transactionSecret, "utf8") < 32 || PLACEHOLDER_SECRET_PATTERN.test(transactionSecret)) {
      errors.push("KAI_ACCOUNT_OIDC_TRANSACTION_SECRET must be a non-placeholder secret of at least 32 bytes when Hosting V2 setup or trading is enabled");
    }
    const approverUsername = environment.KAI_ADMIN_APPROVER_USERNAME ?? "";
    if (!/^[a-z0-9][a-z0-9._-]{2,63}$/.test(approverUsername) || approverUsername === rootUsername) {
      errors.push("KAI_ADMIN_APPROVER_USERNAME must be a separate valid password administrator when Hosting V2 setup or trading is enabled");
    }
    if (!validAdminPasswordHash(environment.KAI_ADMIN_APPROVER_PASSWORD_HASH)) {
      errors.push("KAI_ADMIN_APPROVER_PASSWORD_HASH must be a valid PBKDF2 hash when Hosting V2 setup or trading is enabled");
    } else if (environment.KAI_ADMIN_APPROVER_PASSWORD_HASH === environment.KAI_ADMIN_PASSWORD_HASH) {
      errors.push("KAI_ADMIN_APPROVER_PASSWORD_HASH must use a different password from the Root administrator when Hosting V2 setup or trading is enabled");
    }
  }
  for (const [name, expected] of Object.entries(REQUIRED_CONTAINER_STATE_PATHS)) {
    validateContainerStatePath(name, environment[name], expected, errors, checkFilesystem);
  }
  if (environment.KAI_DB_DIR === environment.KAI_MARKET_DATA_DIR) {
    errors.push("KAI_DB_DIR and KAI_MARKET_DATA_DIR must be distinct");
  }
  if (errors.length > 0) throw new ProductionEnvironmentError(errors);
  return Object.freeze({
    imageReference: environment.KAI_IMAGE_REFERENCE,
    publicOrigin: environment.KAI_PUBLIC_ORIGIN,
    releaseSha: environment.KAI_RELEASE_SHA,
    hstsEnabled: environment.KAI_ENABLE_HSTS === "1",
    accountConsoleV2Enabled: environment.KAI_ACCOUNT_CONSOLE_V2 === "1",
    hostingV2Enabled: environment.KAI_HOSTING_V2 === "1",
    hostingV2SetupEnabled: environment.KAI_HOSTING_V2_SETUP === "1" || environment.KAI_HOSTING_V2 === "1",
    agentTelemetryV1Enabled: agentTelemetryV1 === "1",
    hostingDeviceRetirementEnabled: environment.KAI_HOSTING_DEVICE_RETIREMENT === "1",
    alipayEnabled: false,
    qixiangPayEnabled: qixiangPayEnabled === "1",
    qixiangPayReconciliationEnabled: qixiangReconciliationEnabled === "1",
    dbDirectory: environment.KAI_DB_DIR,
    marketDirectory: environment.KAI_MARKET_DATA_DIR,
  });
}

async function main() {
  const result = validateProductionEnvironment(process.env, {
    checkFilesystem: process.argv.includes("--check-filesystem"),
  });
  process.stdout.write(`${JSON.stringify({
    status: "ok",
    imageReference: result.imageReference,
    publicOrigin: result.publicOrigin,
    releaseSha: result.releaseSha,
    hstsEnabled: result.hstsEnabled,
    stateDirectories: [result.dbDirectory, result.marketDirectory],
  })}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error.code ?? "PRODUCTION_ENVIRONMENT_VALIDATION_FAILED"}: ${error.message}\n`);
    process.exitCode = 78;
  });
}
