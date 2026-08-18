import assert from "node:assert/strict";
import test from "node:test";

import { configureHostingTrialFee, parseRootCredential } from "../scripts/ops/configure-hosting-trial-fee.mjs";

test("trial fee setup logs in as Root, uses CSRF/idempotency and logs out without returning credentials", async () => {
  const calls = [];
  const fetcher = async (url, init = {}) => {
    calls.push({ url, init });
    if (url.endsWith("/api/auth/admin/password")) return new Response(JSON.stringify({ admin: { principal: { roles: ["ROOT"] } } }), { status: 200, headers: { "content-type": "application/json", "set-cookie": "__Host-kai_admin_session=secret-cookie; Path=/; Secure; HttpOnly" } });
    if (url.endsWith("/api/session")) return new Response(JSON.stringify({ session: { csrfToken: "csrf-token-long-enough-for-test" } }), { status: 200, headers: { "content-type": "application/json", "set-cookie": `__Host-kai_session=${"a".repeat(64)}; Path=/; Secure; HttpOnly` } });
    if (url.endsWith("/api/v2/admin/hosting/fees") && !init.method) return Response.json({ record: null });
    if (url.endsWith("/api/v2/admin/hosting/fees")) return Response.json({ record: { id: "hfee_test", platformFeeBps: 1000, referralRewardBps: 300, status: "ACTIVE", effectiveFrom: "2026-08-14T08:00:00.000Z" } }, { status: 201 });
    if (url.endsWith("/api/auth/logout")) return Response.json({ ok: true });
    throw new Error(`unexpected request ${url}`);
  };
  const credential = parseRootCredential("Root 账号：kai-root\nRoot 密码：private-root-password-2026\n");
  const result = await configureHostingTrialFee({ baseUrl: "https://cloud.kai.com", credential, platformFeeBps: 1000, referralRewardBps: 300, fetcher, now: new Date("2026-08-14T08:00:00.000Z"), idempotencyKey: "ops-hosting-fee-test-20260814" });
  assert.equal(result.status, "configured");
  assert.equal(result.record.id, "hfee_test");
  assert.deepEqual(JSON.parse(calls[0].init.body), credential);
  const write = calls.find((call) => call.url.endsWith("/api/v2/admin/hosting/fees") && call.init.method === "POST");
  assert.equal(write.init.headers["x-kai-csrf"], "csrf-token-long-enough-for-test");
  assert.equal(write.init.headers["idempotency-key"], "ops-hosting-fee-test-20260814");
  assert.equal(write.init.headers.cookie, `__Host-kai_admin_session=secret-cookie; __Host-kai_session=${"a".repeat(64)}`);
  assert.equal(calls.at(-1).url, "https://cloud.kai.com/api/auth/logout");
  assert.doesNotMatch(JSON.stringify(result), /private-root-password|secret-cookie|csrf-token/u);
});

test("trial fee setup is idempotent when an active fee already exists", async () => {
  const fetcher = async (url) => {
    if (url.endsWith("/api/auth/admin/password")) return new Response(JSON.stringify({ admin: { principal: { roles: ["ROOT"] } } }), { status: 200, headers: { "content-type": "application/json", "set-cookie": "session=secret; Path=/" } });
    if (url.endsWith("/api/session")) return new Response(JSON.stringify({ session: { csrfToken: "csrf-token-long-enough-for-test" } }), { status: 200, headers: { "content-type": "application/json", "set-cookie": `kai_session_dev=${"b".repeat(64)}; Path=/; HttpOnly` } });
    if (url.endsWith("/api/v2/admin/hosting/fees")) return Response.json({ record: { id: "hfee_existing", status: "ACTIVE" } });
    return Response.json({ ok: true });
  };
  const result = await configureHostingTrialFee({ baseUrl: "https://cloud.kai.com", credential: { username: "kai-root", password: "private-root-password-2026" }, platformFeeBps: 1000, referralRewardBps: 300, fetcher });
  assert.deepEqual(result, { status: "already-configured", record: { id: "hfee_existing", status: "ACTIVE" } });
});
