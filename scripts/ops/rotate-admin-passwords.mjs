#!/usr/bin/env node

import { pbkdf2Sync, randomBytes } from "node:crypto";
import { chmod, chown, lstat, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const ITERATIONS = 310_000;
const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]{2,63}$/u;
const HASH_PATTERN = /^pbkdf2-sha256:(\d{6,7}):[^:]+:[^:]+$/u;
const CONFIRMATION = "ROTATE_KAI_ADMIN_PASSWORDS";

function fail(message) {
  throw new Error(message);
}

function argumentsFrom(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!["--env-file", "--credential-file", "--confirm"].includes(argument)) fail(`unknown argument: ${argument}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) fail(`${argument} requires a value`);
    options[argument.slice(2).replace(/-([a-z])/gu, (_, letter) => letter.toUpperCase())] = value;
    index += 1;
  }
  if (!isAbsolute(options.envFile ?? "") || !isAbsolute(options.credentialFile ?? "")) {
    fail("environment and credential paths must be absolute");
  }
  if (options.confirm !== CONFIRMATION) fail(`--confirm must be exactly ${CONFIRMATION}`);
  return { envFile: resolve(options.envFile), credentialFile: resolve(options.credentialFile) };
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
  for (const key of Object.keys(updates)) if (!found.has(key)) fail(`environment is missing managed key: ${key}`);
  return `${lines.join("\n")}\n`;
}

function passwordCredential(username, displayName, random = randomBytes) {
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

export async function rotateAdminPasswords({ envFile, credentialFile, random = randomBytes }) {
  const metadata = await lstat(envFile);
  if (!metadata.isFile() || metadata.isSymbolicLink()) fail("environment path must be a regular file and not a symlink");
  const source = await readFile(envFile, "utf8");
  const environment = parseEnvironment(source);
  const rootUsername = (environment.get("KAI_ADMIN_USERNAME") ?? "").trim().toLowerCase();
  const approverUsername = (environment.get("KAI_ADMIN_APPROVER_USERNAME") ?? "").trim().toLowerCase();
  const rootDisplayName = (environment.get("KAI_ADMIN_DISPLAY_NAME") ?? "KAI Cloud Root").replace(/^['"]|['"]$/gu, "");
  const approverDisplayName = (environment.get("KAI_ADMIN_APPROVER_DISPLAY_NAME") ?? "KAI Cloud Finance Approver").replace(/^['"]|['"]$/gu, "");
  if (!USERNAME_PATTERN.test(rootUsername) || !USERNAME_PATTERN.test(approverUsername) || rootUsername === approverUsername) {
    fail("two distinct administrator usernames must already be configured");
  }
  if (!HASH_PATTERN.test((environment.get("KAI_ADMIN_PASSWORD_HASH") ?? "").trim())
    || !HASH_PATTERN.test((environment.get("KAI_ADMIN_APPROVER_PASSWORD_HASH") ?? "").trim())) {
    fail("both administrator password hashes must already be configured");
  }
  try {
    await lstat(credentialFile);
    fail("credential file already exists; refusing to overwrite it");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  const root = passwordCredential(rootUsername, rootDisplayName, random);
  const approver = passwordCredential(approverUsername, approverDisplayName, random);
  if (root.password === approver.password || root.passwordHash === approver.passwordHash) fail("generated administrator credentials must be distinct");
  const credentialText = [
    "KAI Cloud 管理员凭据（本次轮换后唯一有效密码）",
    `Root 账号：${root.username}`,
    `Root 密码：${root.password}`,
    `财务审批账号：${approver.username}`,
    `财务审批密码：${approver.password}`,
    "Root 与财务审批账号必须由不同人员使用；请存入密码管理器后安全删除本文件。",
    "",
  ].join("\n");
  await writeFile(credentialFile, credentialText, { encoding: "utf8", flag: "wx", mode: 0o600 });
  try {
    const next = withUpdates(source, {
      KAI_ADMIN_PASSWORD_HASH: root.passwordHash,
      KAI_ADMIN_APPROVER_PASSWORD_HASH: approver.passwordHash,
    });
    await atomicReplace(envFile, next, metadata);
  } catch (error) {
    await rm(credentialFile, { force: true });
    throw error;
  }
  return Object.freeze({
    status: "rotated",
    rootUsername,
    approverUsername,
    credentialFile,
  });
}

async function main() {
  const result = await rotateAdminPasswords(argumentsFrom(process.argv.slice(2)));
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    process.stderr.write(`ADMIN_PASSWORD_ROTATION_FAILED: ${error.message}\n`);
    process.exitCode = 1;
  });
}

