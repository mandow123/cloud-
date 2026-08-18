#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const CONFIRMATION = "CONFIGURE_KAI_HOSTING_TRIAL_FEE";

function fail(message) {
  throw new Error(message);
}

function argumentsFrom(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!["--base-url", "--credential-file", "--platform-fee-bps", "--referral-reward-bps", "--confirm"].includes(argument)) fail(`unknown argument: ${argument}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) fail(`${argument} requires a value`);
    options[argument.slice(2).replace(/-([a-z])/gu, (_, letter) => letter.toUpperCase())] = value;
    index += 1;
  }
  if (!isAbsolute(options.credentialFile ?? "")) fail("credential path must be absolute");
  if (options.confirm !== CONFIRMATION) fail(`--confirm must be exactly ${CONFIRMATION}`);
  const baseUrl = new URL(options.baseUrl ?? "https://cloud.kai.com");
  if (baseUrl.protocol !== "https:" || baseUrl.username || baseUrl.password || baseUrl.search || baseUrl.hash || baseUrl.pathname !== "/") {
    fail("base URL must be an origin-only HTTPS URL");
  }
  const platformFeeBps = Number(options.platformFeeBps ?? "100");
  const referralRewardBps = Number(options.referralRewardBps ?? "30");
  if (!Number.isInteger(platformFeeBps) || platformFeeBps < 0 || platformFeeBps > 5000) fail("platform fee must be 0-5000 basis points");
  if (!Number.isInteger(referralRewardBps) || referralRewardBps < 0 || referralRewardBps > platformFeeBps) fail("referral reward must be 0-platform fee basis points");
  return { baseUrl: baseUrl.origin, credentialFile: resolve(options.credentialFile), platformFeeBps, referralRewardBps };
}

export function parseRootCredential(text) {
  const username = text.match(/^Root 账号：(\S+)$/mu)?.[1];
  const password = text.match(/^Root 密码：(\S+)$/mu)?.[1];
  if (!username || !/^[a-z0-9][a-z0-9._-]{2,63}$/u.test(username) || !password || password.length < 12 || password.length > 256) {
    fail("credential handoff does not contain a valid Root account");
  }
  return Object.freeze({ username, password });
}

async function jsonResponse(response, operation) {
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const error = body && typeof body === "object" && !Array.isArray(body) && body.error && typeof body.error === "object" ? body.error : {};
    fail(`${operation} failed (${response.status}): ${error.code ?? "UNKNOWN"} ${error.message ?? ""}`.trim());
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) fail(`${operation} returned invalid JSON`);
  return body;
}

export async function configureHostingTrialFee({
  baseUrl,
  credential,
  platformFeeBps,
  referralRewardBps,
  fetcher = fetch,
  now = new Date(),
  idempotencyKey = `ops-hosting-fee-${randomUUID()}`,
}) {
  const origin = new URL(baseUrl).origin;
  const login = await fetcher(`${origin}/api/auth/admin/password`, {
    method: "POST",
    redirect: "manual",
    headers: { accept: "application/json", "content-type": "application/json", origin },
    body: JSON.stringify(credential),
  });
  const loginBody = await jsonResponse(login, "administrator login");
  const setCookie = login.headers.get("set-cookie");
  const cookie = setCookie?.split(";", 1)[0];
  if (!cookie || !loginBody.admin || !Array.isArray(loginBody.admin.principal?.roles) || !loginBody.admin.principal.roles.includes("ROOT")) {
    fail("administrator login did not create a Root session");
  }
  try {
    const sessionResponse = await fetcher(`${origin}/api/session`, {
      headers: { accept: "application/json", cookie },
      cache: "no-store",
    });
    const session = await jsonResponse(sessionResponse, "marketplace session");
    const marketplaceCookie = sessionResponse.headers.get("set-cookie")?.split(";", 1)[0];
    if (!marketplaceCookie || !/^(__Host-kai_session|kai_session_dev)=[a-f0-9]{64}$/u.test(marketplaceCookie)) {
      fail("marketplace session did not create a bound browser cookie");
    }
    const browserCookie = `${cookie}; ${marketplaceCookie}`;
    const csrfToken = session.session?.csrfToken;
    if (typeof csrfToken !== "string" || csrfToken.length < 20) fail("marketplace session did not return a CSRF token");

    const current = await jsonResponse(await fetcher(`${origin}/api/v2/admin/hosting/fees`, {
      headers: { accept: "application/json", cookie: browserCookie },
      cache: "no-store",
    }), "fee lookup");
    if (current.record) {
      return Object.freeze({ status: "already-configured", record: current.record });
    }

    const created = await jsonResponse(await fetcher(`${origin}/api/v2/admin/hosting/fees`, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        cookie: browserCookie,
        origin,
        "x-kai-csrf": csrfToken,
        "idempotency-key": idempotencyKey,
      },
      body: JSON.stringify({ platformFeeBps, referralRewardBps, activate: true, effectiveFrom: now.toISOString() }),
    }), "fee activation");
    if (!created.record || created.record.status !== "ACTIVE") fail("fee activation did not return an active record");
    return Object.freeze({ status: "configured", record: created.record });
  } finally {
    await fetcher(`${origin}/api/auth/logout`, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json", cookie, origin },
      body: "{}",
    }).catch(() => {});
  }
}

async function main() {
  const options = argumentsFrom(process.argv.slice(2));
  const credential = parseRootCredential(await readFile(options.credentialFile, "utf8"));
  const result = await configureHostingTrialFee({ ...options, credential });
  const record = result.record;
  process.stdout.write(`${JSON.stringify({
    status: result.status,
    record: {
      id: record.id,
      platformFeeBps: record.platformFeeBps,
      referralRewardBps: record.referralRewardBps,
      status: record.status,
      effectiveFrom: record.effectiveFrom,
    },
  })}\n`);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    process.stderr.write(`HOSTING_TRIAL_FEE_CONFIGURATION_FAILED: ${error.message}\n`);
    process.exitCode = 1;
  });
}
