#!/usr/bin/env node

import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, unlinkSync, writeSync } from "node:fs";
import { connect } from "node:net";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

const ID_PATTERN = /^[a-z][a-z0-9_]{5,95}$/u;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{40,128}$/u;
const MAX_TOKEN_BYTES = 512;

export class KaiCloudProxyError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "KaiCloudProxyError";
    this.code = code;
  }
}

function parseEndpoint(value) {
  const match = /^(?:\[([0-9a-f:]+)\]|([a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?)):([0-9]{1,5})$/iu.exec(value ?? "");
  const port = Number(match?.[3] ?? 0);
  if (!match || !Number.isSafeInteger(port) || port < 1 || port > 65535) {
    throw new KaiCloudProxyError("ENDPOINT_INVALID", "Gateway 地址无效。请重新生成连接凭据。");
  }
  return { host: match[1] ?? match[2], port };
}

function parseArgs(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith("--")) throw new KaiCloudProxyError("ARGUMENT_INVALID", "连接命令包含无法识别的参数。");
    const key = argument.slice(2);
    if (!["endpoint", "lease-id", "contract-id", "expires-at", "token-file", "token-fd", "token-tty"].includes(key) || values.has(key)) {
      throw new KaiCloudProxyError("ARGUMENT_INVALID", "连接命令包含无法识别的参数。");
    }
    if (key === "token-tty") values.set(key, "true");
    else {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new KaiCloudProxyError("ARGUMENT_MISSING", "连接命令缺少必要参数。");
      values.set(key, value);
      index += 1;
    }
  }
  const endpoint = parseEndpoint(values.get("endpoint"));
  const contractId = values.get("contract-id") ?? "";
  if (contractId && !ID_PATTERN.test(contractId)) throw new KaiCloudProxyError("CONTRACT_INVALID", "连接合同无效。请重新生成连接凭据。");
  if (values.has("lease-id") && contractId) throw new KaiCloudProxyError("LEASE_INVALID", "连接命令不能同时指定合同和租约。");
  const leaseId = values.get("lease-id") ?? (contractId ? `hgw_${createHash("sha256").update(contractId).digest("hex").slice(0, 40)}` : "");
  if (!ID_PATTERN.test(leaseId)) throw new KaiCloudProxyError("LEASE_INVALID", "连接租约无效。请重新生成连接凭据。");
  const expiresAt = values.get("expires-at") ?? "";
  if (!Number.isFinite(Date.parse(expiresAt))) throw new KaiCloudProxyError("EXPIRY_INVALID", "连接凭据有效期无效。");
  const tokenSources = [values.has("token-file"), values.has("token-fd"), values.has("token-tty")].filter(Boolean).length;
  if (tokenSources > 1) throw new KaiCloudProxyError("TOKEN_SOURCE_INVALID", "一次只能使用一种令牌输入方式。");
  return { endpoint, leaseId, expiresAt, tokenFile: values.get("token-file"), tokenFd: values.get("token-fd"), tokenTty: tokenSources === 0 || values.has("token-tty") };
}

function boundedRead(fd) {
  const buffer = Buffer.alloc(MAX_TOKEN_BYTES + 1);
  let bytes = 0;
  while (bytes < buffer.length) {
    const count = readSync(fd, buffer, bytes, buffer.length - bytes, null);
    if (count === 0) break;
    bytes += count;
    if (buffer.subarray(0, bytes).includes(0x0a)) break;
  }
  if (bytes > MAX_TOKEN_BYTES) {
    buffer.fill(0);
    throw new KaiCloudProxyError("TOKEN_TOO_LARGE", "一次性连接令牌无效。");
  }
  const newline = buffer.subarray(0, bytes).indexOf(0x0a);
  const end = newline >= 0 ? newline : bytes;
  const token = Buffer.from(buffer.subarray(0, end).toString("utf8").trim(), "utf8");
  buffer.fill(0);
  if (!TOKEN_PATTERN.test(token.toString("utf8"))) {
    token.fill(0);
    throw new KaiCloudProxyError("TOKEN_INVALID", "一次性连接令牌无效。");
  }
  return token;
}

function readTokenFile(path) {
  let fd;
  try {
    const before = lstatSync(path, { throwIfNoEntry: false });
    if (!before?.isFile() || before.isSymbolicLink() || (before.mode & 0o077) !== 0 || (typeof process.getuid === "function" && before.uid !== process.getuid())) {
      throw new KaiCloudProxyError("TOKEN_FILE_UNSAFE", "令牌临时文件必须由当前用户持有且权限为 0600。");
    }
    fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const opened = fstatSync(fd);
    if (!opened.isFile() || opened.ino !== before.ino || opened.dev !== before.dev || (opened.mode & 0o077) !== 0) {
      throw new KaiCloudProxyError("TOKEN_FILE_UNSAFE", "令牌临时文件校验失败。");
    }
    unlinkSync(path);
    return boundedRead(fd);
  } finally {
    if (fd !== undefined) closeSync(fd);
    try { unlinkSync(path); } catch {}
  }
}

function readTokenFromTty() {
  const fd = openSync("/dev/tty", constants.O_RDWR);
  try {
    writeSync(fd, "KAI Cloud 一次性连接令牌（输入不回显）: ");
    const disabled = spawnSync("stty", ["-echo"], { stdio: [fd, fd, fd] });
    if (disabled.status !== 0) throw new KaiCloudProxyError("TTY_UNAVAILABLE", "无法启用安全令牌输入。");
    try { return boundedRead(fd); }
    finally {
      spawnSync("stty", ["echo"], { stdio: [fd, fd, fd] });
      writeSync(fd, "\n");
    }
  } finally { closeSync(fd); }
}

function readToken(options) {
  if (options.tokenFile) return readTokenFile(options.tokenFile);
  if (options.tokenFd !== undefined) {
    const fd = Number(options.tokenFd);
    if (!Number.isSafeInteger(fd) || fd < 3 || fd > 1024) throw new KaiCloudProxyError("TOKEN_FD_INVALID", "令牌文件描述符无效。");
    return boundedRead(fd);
  }
  return readTokenFromTty();
}

export function runProxy(argv, streams = { stdin: process.stdin, stdout: process.stdout, stderr: process.stderr }) {
  let token;
  try {
    streams.stdin.pause();
    const options = parseArgs(argv);
    token = readToken(options);
    if (Date.parse(options.expiresAt) <= Date.now()) throw new KaiCloudProxyError("TOKEN_EXPIRED", "一次性连接凭据已过期，请在合同页重新生成。");

    const handshake = Buffer.from(`${JSON.stringify({ version: 1, leaseId: options.leaseId, token: token.toString("utf8") })}\n`, "utf8");
    token.fill(0);
    token = undefined;
    const socket = connect(options.endpoint);
    socket.setNoDelay(true);
    socket.once("connect", () => {
      socket.write(handshake, () => handshake.fill(0));
      streams.stdin.pipe(socket);
      socket.pipe(streams.stdout);
    });
    socket.once("error", () => {
      handshake.fill(0);
      streams.stderr.write("KAI Cloud Gateway 连接失败，请重新生成连接凭据后重试。\n");
      process.exitCode = 75;
    });
    socket.once("close", () => {
      handshake.fill(0);
      if (!streams.stdout.destroyed && typeof streams.stdout.end === "function") streams.stdout.end();
    });
    return socket;
  } catch (error) {
    token?.fill(0);
    const message = error instanceof KaiCloudProxyError ? error.message : "安全连接助手启动失败。";
    streams.stderr.write(`${message}\n`);
    process.exitCode = 64;
    return null;
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) runProxy(process.argv.slice(2));
