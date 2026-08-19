import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { isAccountConsoleV2EnabledForEnvironment, supplyHostingPageRedirectForEnvironment } from "../lib/server/account-console-feature.ts";

test("account console V2 is fail-closed unless explicitly enabled", () => {
  assert.equal(isAccountConsoleV2EnabledForEnvironment({}), false);
  assert.equal(isAccountConsoleV2EnabledForEnvironment({ KAI_ACCOUNT_CONSOLE_V2: "0" }), false);
  assert.equal(isAccountConsoleV2EnabledForEnvironment({ KAI_ACCOUNT_CONSOLE_V2: "1" }), true);
  assert.equal(isAccountConsoleV2EnabledForEnvironment({ KAI_ACCOUNT_CONSOLE_V2: "true" }), true);
});

test("manual supply stays reachable while Hosting-only pages redirect before rendering", async () => {
  assert.equal(supplyHostingPageRedirectForEnvironment({ KAI_ACCOUNT_CONSOLE_V2: "1", KAI_HOSTING_V2_SETUP: "0", KAI_HOSTING_V2: "0" }), "/supply");
  assert.equal(supplyHostingPageRedirectForEnvironment({ KAI_ACCOUNT_CONSOLE_V2: "0", KAI_HOSTING_V2_SETUP: "0", KAI_HOSTING_V2: "0" }), null);
  assert.equal(supplyHostingPageRedirectForEnvironment({ KAI_ACCOUNT_CONSOLE_V2: "1", KAI_HOSTING_V2_SETUP: "1", KAI_HOSTING_V2: "0" }), null);
  assert.equal(supplyHostingPageRedirectForEnvironment({ KAI_ACCOUNT_CONSOLE_V2: "1", KAI_HOSTING_V2_SETUP: "0", KAI_HOSTING_V2: "1" }), null);

  const hostingOnlyPages = [
    "../app/supply/devices/page.tsx",
    "../app/supply/devices/new/page.tsx",
    "../app/supply/devices/[deviceId]/page.tsx",
    "../app/supply/listings/page.tsx",
    "../app/supply/listings/new/page.tsx",
    "../app/supply/orders/page.tsx",
    "../app/supply/orders/[contractId]/page.tsx",
    "../app/supply/earnings/page.tsx",
    "../app/supply/onboarding/page.tsx",
    "../app/supply/tasks/page.tsx",
  ];
  for (const page of hostingOnlyPages) {
    const source = await readFile(new URL(page, import.meta.url), "utf8");
    const gateCall = source.indexOf("requireSupplyHostingPageAccess();");
    const componentRender = source.search(/return\s+</u);
    assert.ok(gateCall >= 0, `${page} must call the server Hosting page gate`);
    assert.ok(componentRender < 0 || gateCall < componentRender, `${page} must gate before rendering its component`);
  }

  for (const page of ["../app/supply/page.tsx", "../app/supply/apply/page.tsx", "../app/supply/applications/page.tsx"]) {
    const source = await readFile(new URL(page, import.meta.url), "utf8");
    assert.doesNotMatch(source, /requireSupplyHostingPageAccess/u, `${page} is part of the manual supply console`);
  }
});

test("production compose and environment example keep account console V2 off by default", async () => {
  const [compose, environment, runbook] = await Promise.all([
    readFile(new URL("../deploy/compose.production.yml", import.meta.url), "utf8"),
    readFile(new URL("../deploy/kai-cloud-app.env.example", import.meta.url), "utf8"),
    readFile(new URL("../deploy/PRODUCTION_RUNBOOK.md", import.meta.url), "utf8"),
  ]);
  assert.match(compose, /KAI_ACCOUNT_CONSOLE_V2: "\$\{KAI_ACCOUNT_CONSOLE_V2:-0\}"/u);
  assert.match(environment, /^KAI_ACCOUNT_CONSOLE_V2=0$/mu);
  assert.match(runbook, /KAI_ACCOUNT_CONSOLE_V2=0/u);
  assert.match(runbook, /恢复旧页面/u);
});

test("account console shell uses server-selected mode and never browser role storage", async () => {
  const [shell, supplyLayout] = await Promise.all([
    readFile(new URL("../components/account-console-shell.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/supply/layout.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(shell, /mode: ConsoleMode/u);
  assert.doesNotMatch(shell, /localStorage|sessionStorage|x-kai-workspace-role/u);
  assert.match(shell, /\/api\/auth\/session/u);
  assert.match(shell, /\/api\/v1\/member\/account-console-summary/u);
  assert.match(shell, /requiresApproval/u);
  assert.match(shell, /capabilities\?\.supplier\?\.approved/u);
  assert.match(supplyLayout, /!accountConsoleV2Enabled && !isHostingV2SetupEnabled\(\)/u);
  assert.match(shell, /requiresHosting/u);
  assert.match(shell, /requiresHosting.*configurationMode\) return null/u);
  assert.doesNotMatch(shell, /requiresTrading/u);
  assert.match(shell, /移动导航/u);
  assert.match(shell, /event\.key !== "Escape"/u);
  assert.doesNotMatch(shell, /\/api\/v1\/admin/u);
});

test("account console overview exposes only truthful buyer and manual supplier facts", async () => {
  const [overview, memberPage, supplyPage] = await Promise.all([
    readFile(new URL("../components/account-console-overview.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/member/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/supply/page.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(memberPage, /isAccountConsoleV2Enabled\(\)/u);
  assert.match(memberPage, /AccountConsoleOverview mode="buyer"/u);
  assert.match(supplyPage, /AccountConsoleOverview mode="supplier"/u);
  assert.match(overview, /等待平台人工确认与交付/u);
  assert.match(overview, /申请已通过（尚未发布）/u);
  assert.match(overview, /record\.status === "PUBLISHED" \? "已发布不代表已锁库存、已成交或运行中" : "不代表已发布、已成交或运行中"/u);
  assert.match(overview, /未锁库存、未付款、未扣卡时/u);
  assert.match(overview, /formatCardHourDisplayMicros/u);
  assert.doesNotMatch(overview, /已购买|运行中实例|累计收益|出租率|自动开通成功/u);
  assert.doesNotMatch(overview, /sshPublicKey|canonicalSsh|buyerAccountId|buyerOrganizationId|idempotency|payloadHash/u);
});
