import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("application list renders telemetry CTA only from server eligibility", () => {
  const page = readFileSync("app/supply/applications/page.tsx", "utf8");
  const records = readFileSync("components/supply-offer-records.tsx", "utf8");
  const api = readFileSync("app/api/v1/supply/offers/route.ts", "utf8");

  assert.match(page, /isAgentTelemetryV1Enabled\(\)/u);
  assert.match(page, /isAgentTelemetryV1Enabled\(\)[\s\S]*\? <SupplyOfferRecords telemetryEnabled \/>[\s\S]*: <SupplyOfferRecords \/>/u);
  assert.match(records, /telemetryEnabled && record\.telemetryConnectionEligible/u);
  assert.match(records, /\/supply\/devices\/new\?applicationId=/u);
  assert.match(records, />连接个人 GPU</u);
  assert.match(api, /telemetryEligibleApplicationIds/u);
  assert.match(api, /telemetryConnectionEligible: eligibleIds\.has\(item\.id\)/u);

  const telemetryBranch = records.slice(records.indexOf("telemetryEnabled &&"), records.indexOf("data-label=\"提交时间\""));
  assert.doesNotMatch(telemetryBranch, /record\.status|record\.supplierType|record\.resourceType/u);
});

test("telemetry deep link is fail-closed and leaves the full-host page unchanged without applicationId", () => {
  const page = readFileSync("app/supply/devices/new/page.tsx", "utf8");

  assert.match(page, /const telemetryEnabled = isAgentTelemetryV1Enabled\(\)/u);
  assert.match(page, /if \(applicationId && !telemetryEnabled\) redirect\("\/supply\/applications"\)/u);
  assert.match(page, /requireTradingAccountSession/u);
  assert.match(page, /isTelemetryApplicationEligibleForAccount\(account, applicationId\)/u);
  assert.match(page, /if \(!eligible\) redirect\("\/supply\/applications"\)/u);
  assert.match(page, /else \{\s*requireSupplyHostingPageAccess\(\)/u);
  assert.match(page, /<SupplyResourceRegistration telemetryApplicationId=\{applicationId\} \/>/u);

  const eligibilityGate = page.slice(page.indexOf("if (applicationId)"), page.indexOf("return <SupplyResourceRegistration"));
  assert.ok(eligibilityGate.indexOf("isTelemetryApplicationEligibleForAccount") < eligibilityGate.indexOf("if (!eligible) redirect"));
});

test("telemetry pairing is collection-only and does not expose an unverified installer", () => {
  const source = readFileSync("components/supply-resource-registration.tsx", "utf8");
  const start = source.indexOf("if (telemetryMode && telemetryApplicationId)");
  const end = source.indexOf("\n  }\n\n  return (", start);
  const telemetry = source.slice(start, end);

  assert.ok(start > 0 && end > start, "telemetry render branch must be isolated");
  for (const label of ["申请审核通过", "连接资源采集 Agent", "平台复核", "资源采集已连接", "查看采集信息", "返回上架申请"]) {
    assert.match(telemetry, new RegExp(label, "u"));
  }
  assert.match(telemetry, /NAT 转发、堡垒机中转和仅内网可达设备暂不支持/u);
  assert.match(telemetry, /采集组件待平台发布/u);
  assert.match(telemetry, /disabled type="button">采集组件待平台发布/u);
  assert.match(source, /applicationId: telemetryApplicationId/u);
  assert.match(source, /capabilityMode: "TELEMETRY_ONLY"/u);
  assert.match(source, /agentOnline && pairedDevice/u);
  assert.match(telemetry, /平台尚未收到首个有效心跳/u);
  assert.match(source, /observedAt - lastSeenAt <= 90_000/u);
  assert.match(source, /!telemetryMode && agentOnline/u);
  assert.match(telemetry, /资源采集连接已中断/u);
  assert.doesNotMatch(telemetry, /进入设备验真|已验真|可售|已上架|自动交付/u);
  assert.doesNotMatch(telemetry, /\.exe|Windows|win32/u);
});

test("telemetry feature remains disabled in production defaults", () => {
  const feature = readFileSync("lib/server/agent-telemetry-feature.ts", "utf8");
  const compose = readFileSync("deploy/compose.production.yml", "utf8");
  const example = readFileSync("deploy/kai-cloud-app.env.example", "utf8");

  assert.match(feature, /environment\.KAI_AGENT_TELEMETRY_V1\?\.trim\(\) === "1"/u);
  assert.match(compose, /KAI_AGENT_TELEMETRY_V1: "\$\{KAI_AGENT_TELEMETRY_V1:-0\}"/u);
  assert.match(example, /^KAI_AGENT_TELEMETRY_V1=0$/mu);
});
