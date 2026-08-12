#!/usr/bin/env node

import { pbkdf2Sync, randomBytes } from "node:crypto";
import { chmod, chown, lstat, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const ITERATIONS = 310_000;
const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]{2,63}$/u;
const MANAGED_KEYS = [
  "KAI_ADMIN_APPROVER_USERNAME",
  "KAI_ADMIN_APPROVER_PASSWORD_HASH",
  "KAI_ADMIN_APPROVER_DISPLAY_NAME",
];

function fail(message) {
  throw new Error(message);
}

function argumentsFrom(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!["--env-file", "--credential-file", "--username", "--display-name"].includes(argument)) fail(`unknown argument: ${argument}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) fail(`${argument} requires a value`);
    options[argument.slice(2).replace(/-([a-z])/gu, (_, letter) => letter.toUpperCase())] = value;
    index += 1;
  }
  const envFile = resolve(options.envFile ?? "");
  const credentialFile = resolve(options.credentialFile ?? "");
  const username = options.username?.trim().toLowerCase() ?? "";
  const displayName = options.displayName?.trim() ?? "";
  if (!isAbsolute(options.envFile ?? "") || !isAbsolute(options.credentialFile ?? "")) fail("environment and credential paths must be absolute");
  if (!USERNAME_PATTERN.test(username)) fail("finance approver username is invalid");
  if (displayName.length < 3 || displayName.length > 100 || /[\r\n=]/u.test(displayName)) fail("finance approver display name is invalid");
  return { envFile, credentialFile, username, displayName };
}

function parseEnvironment(text) {
  const values = new Map();
  for (const rawLine of text.split(/\r?\n/u)) {
    if (!rawLine || rawLine.trimStart().startsWith("#")) continue;
    const separator = rawLine.indexOf("=");
    if (separator <= 0) continue;
    const key = rawLine.slice(0, separator);
    if (!/^[A-Z][A-Z0-9_]*$/u.test(key)) continue;
    if (values.has(key)) fail(`environment contains duplicate key: ${key}`);
    values.set(key, rawLine.slice(separator + 1));
  }
  return values;
}

function withUpdates(text, updates) {
  const found = new Set();
  const lines = text.split(/\r?\n/u).map((line) => {
    const separator = line.indexOf("=");
    const key = separator > 0 ? line.slice(0, separator) : "";
    if (!Object.hasOwn(updates, key)) return line;
    if (found.has(key)) fail(`environment contains duplicate key: ${key}`);
    found.add(key);
    return `${key}=${updates[key]}`;
  });
  while (lines.at(-1) === "") lines.pop();
  for (const key of Object.keys(updates)) if (!found.has(key)) lines.push(`${key}=${updates[key]}`);
  return `${lines.join("\n")}\n`;
}

export function createFinanceApproverCredential(username, displayName, { random = randomBytes } = {}) {
  if (!USERNAME_PATTERN.test(username)) fail("finance approver username is invalid");
  const password = random(24).toString("base64url");
  const salt = random(16);
  const digest = pbkdf2Sync(password, salt, ITERATIONS, 32, "sha256");
  return Object.freeze({
    username,
    displayName,
    password,
    passwordHash: `pbkdf2-sha256:${ITERATIONS}:${salt.toString("base64")}:${digest.toString("base64")}`,
  });
}

async function atomicReplace(path, content, metadata) {
  const temporary = `${path}.partial-${randomBytes(12).toString("hex")}`;
  const handle = await open(temporary, "wx", metadata.mode & 0o777);
  try {
    await handle.writeFile(content, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await chmod(temporary, metadata.mode & 0o777);
  await chown(temporary, metadata.uid, metadata.gid);
  await rename(temporary, path);
}

export async function configureFinanceApprover(options) {
  const metadata = await lstat(options.envFile);
  if (!metadata.isFile() || metadata.isSymbolicLink()) fail("environment path must be a regular file and not a symlink");
  const source = await readFile(options.envFile, "utf8");
  const environment = parseEnvironment(source);
  for (const key of MANAGED_KEYS) if ((environment.get(key) ?? "").trim()) fail(`${key} is already configured; refusing to rotate it implicitly`);
  const rootUsername = (environment.get("KAI_ADMIN_USERNAME") ?? "").trim().toLowerCase();
  if (!USERNAME_PATTERN.test(rootUsername)) fail("KAI_ADMIN_USERNAME must already be configured");
  if (rootUsername === options.username) fail("finance approver must use a different username from Root");
  try {
    await lstat(options.credentialFile);
    fail("credential file already exists; refusing to overwrite it");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  const credential = createFinanceApproverCredential(options.username, options.displayName);
  const credentialText = [
    "KAI Cloud 独立财务审批账号",
    `账号：${credential.username}`,
    `密码：${credential.password}`,
    "用途：仅审批试运营卡时发放；不具备 Root 权限。",
    "请在首次交接后存入密码管理器，并安全删除本文件。",
    "",
  ].join("\n");
  await writeFile(options.credentialFile, credentialText, { encoding: "utf8", flag: "wx", mode: 0o600 });
  try {
    const next = withUpdates(source, {
      KAI_ADMIN_APPROVER_USERNAME: credential.username,
      KAI_ADMIN_APPROVER_PASSWORD_HASH: credential.passwordHash,
      KAI_ADMIN_APPROVER_DISPLAY_NAME: credential.displayName,
    });
    await atomicReplace(options.envFile, next, metadata);
  } catch (error) {
    await rm(options.credentialFile, { force: true });
    throw error;
  }
  return Object.freeze({ status: "configured", username: credential.username, credentialFile: options.credentialFile });
}

async function main() {
  const result = await configureFinanceApprover(argumentsFrom(process.argv.slice(2)));
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    process.stderr.write(`FINANCE_APPROVER_CONFIGURATION_FAILED: ${error.message}\n`);
    process.exitCode = 1;
  });
}
