#!/usr/bin/env node

import { constants, copyFile, open, readFile, rename, stat, unlink } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const MODERN_IDENTITY_ISSUER = "https://auth.kai.com/api/auth";
export const MODERN_IDENTITY_SCOPES = "openid profile email";
const CONFIRMATION = "CONFIGURE_KAI_IDENTITY_WEB_CLIENT";

function fail(message) {
  throw new Error(message);
}

function cliArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!["--env-file", "--credential-file", "--confirm"].includes(argument)) fail(`unknown argument: ${argument}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) fail(`${argument} requires a value`);
    options[argument.slice(2).replace(/-([a-z])/gu, (_, letter) => letter.toUpperCase())] = value;
    index += 1;
  }
  if (!isAbsolute(options.envFile ?? "") || !isAbsolute(options.credentialFile ?? "")) fail("environment and credential paths must be absolute");
  if (options.confirm !== CONFIRMATION) fail(`--confirm must be exactly ${CONFIRMATION}`);
  return { envFile: resolve(options.envFile), credentialFile: resolve(options.credentialFile) };
}

export function parseIdentityClientCredentials(text) {
  let value;
  try { value = JSON.parse(text); } catch { fail("credential file must contain JSON"); }
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("credential file must contain an object");
  const keys = Object.keys(value).sort();
  if (keys.join(",") !== "clientId,clientSecret") fail("credential file must contain only clientId and clientSecret");
  const clientId = value.clientId?.trim();
  const clientSecret = value.clientSecret?.trim();
  if (!clientId || !/^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$/u.test(clientId)) fail("credential file contains an invalid Client ID");
  if (!clientSecret || !/^[A-Za-z0-9._~-]{16,2048}$/u.test(clientSecret)) fail("credential file contains an invalid Client Secret");
  if (clientId === clientSecret) fail("Client ID and Client Secret must differ");
  return Object.freeze({ clientId, clientSecret });
}

function setEnvironmentLine(source, key, encodedValue) {
  const expression = new RegExp(`^${key}=.*$`, "gmu");
  const matches = source.match(expression) ?? [];
  if (matches.length > 1) fail(`${key} is duplicated in the environment file`);
  if (matches.length === 1) return source.replace(expression, `${key}=${encodedValue}`);
  return `${source.replace(/\s*$/u, "")}\n${key}=${encodedValue}\n`;
}

export function renderModernIdentityEnvironment(source, credentials) {
  if (typeof source !== "string" || source.includes("\0")) fail("environment file is invalid");
  let result = source;
  result = setEnvironmentLine(result, "KAI_ACCOUNT_OIDC_CLIENT_ID", credentials.clientId);
  result = setEnvironmentLine(result, "KAI_ACCOUNT_OIDC_CLIENT_SECRET", credentials.clientSecret);
  result = setEnvironmentLine(result, "KAI_ACCOUNT_OIDC_ISSUER", MODERN_IDENTITY_ISSUER);
  result = setEnvironmentLine(result, "KAI_ACCOUNT_OIDC_SCOPES", `'${MODERN_IDENTITY_SCOPES}'`);
  return result.endsWith("\n") ? result : `${result}\n`;
}

async function validateProvider(fetcher) {
  const discovery = `${MODERN_IDENTITY_ISSUER}/.well-known/openid-configuration`;
  let response;
  try {
    response = await fetcher(discovery, { redirect: "manual", cache: "no-store", headers: { accept: "application/json" }, signal: AbortSignal.timeout(5_000) });
  } catch { fail("auth.kai.com Discovery is unreachable"); }
  if (response.status !== 200 || !response.headers.get("content-type")?.toLowerCase().includes("application/json")) fail("auth.kai.com Discovery is not ready");
  const metadata = await response.json().catch(() => null);
  const expected = {
    issuer: MODERN_IDENTITY_ISSUER,
    authorization_endpoint: `${MODERN_IDENTITY_ISSUER}/oauth2/authorize`,
    token_endpoint: `${MODERN_IDENTITY_ISSUER}/oauth2/token`,
    jwks_uri: `${MODERN_IDENTITY_ISSUER}/jwks`,
    userinfo_endpoint: `${MODERN_IDENTITY_ISSUER}/oauth2/userinfo`,
  };
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) fail("auth.kai.com Discovery returned invalid JSON");
  for (const [field, value] of Object.entries(expected)) if (metadata[field] !== value) fail(`auth.kai.com Discovery has an invalid ${field}`);
  if (!Array.isArray(metadata.token_endpoint_auth_methods_supported) || !metadata.token_endpoint_auth_methods_supported.includes("client_secret_basic")) {
    fail("auth.kai.com does not advertise client_secret_basic");
  }
}

function backupSuffix(now) {
  return now.toISOString().replace(/[-:]/gu, "").replace(/\.\d{3}Z$/u, "Z");
}

export async function configureKaiIdentityEnvironment({
  envFile,
  credentialFile,
  fetcher = fetch,
  now = new Date(),
  requireRootOwner = true,
}) {
  const credentialMetadata = await stat(credentialFile);
  if (!credentialMetadata.isFile() || (credentialMetadata.mode & 0o077) !== 0 || (requireRootOwner && credentialMetadata.uid !== 0)) {
    fail("credential file must be a root-owned private regular file");
  }
  const environmentMetadata = await stat(envFile);
  if (!environmentMetadata.isFile()) fail("environment path must be a regular file");
  const credentials = parseIdentityClientCredentials(await readFile(credentialFile, "utf8"));
  await validateProvider(fetcher);
  const nextEnvironment = renderModernIdentityEnvironment(await readFile(envFile, "utf8"), credentials);
  const backupFile = `${envFile}.pre-identity-${backupSuffix(now)}`;
  const temporaryFile = `${envFile}.identity-${crypto.randomUUID()}.tmp`;
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
  return Object.freeze({
    status: "configured",
    issuer: MODERN_IDENTITY_ISSUER,
    scopes: MODERN_IDENTITY_SCOPES,
    clientIdSuffix: credentials.clientId.slice(-8),
    backupFile,
  });
}

async function main() {
  const options = cliArguments(process.argv.slice(2));
  const result = await configureKaiIdentityEnvironment(options);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write(`KAI_IDENTITY_CONFIGURATION_FAILED: ${error.message}\n`);
    process.exitCode = 1;
  });
}
