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
    errors.push("KAI_STATE_ROOT must be a normalized absolute path dedicated to KAI Cloud under /opt (for example /opt/kai-cloud-3050)");
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
    stateDirectories: [result.dbDirectory, result.marketDirectory],
  })}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error.code ?? "PRODUCTION_ENVIRONMENT_VALIDATION_FAILED"}: ${error.message}\n`);
    process.exitCode = 78;
  });
}
