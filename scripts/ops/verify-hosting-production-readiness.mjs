#!/usr/bin/env node

import { pathToFileURL } from "node:url";

const STAGES = new Set(["SETUP", "AGENT_CONNECTED", "INTERNAL_TRIAL", "MARKET"]);
const MAX_RESPONSE_BYTES = 256 * 1024;

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function canonicalOrigin(value) {
  const parsed = new URL(value || "https://cloud.kai.com");
  invariant(parsed.protocol === "https:", "Production Hosting verification requires an HTTPS origin");
  invariant(parsed.username === "" && parsed.password === "", "Production origin must not contain credentials");
  invariant(parsed.pathname === "/" && parsed.search === "" && parsed.hash === "", "Production origin must not contain a path, query, or fragment");
  return parsed.origin;
}

function readyCheck(checks, name) {
  invariant(checks?.[name]?.ready === true, `Hosting check is not ready: ${name}${checks?.[name]?.reason ? ` (${checks[name].reason})` : ""}`);
}

export function verifyHostingProductionSnapshot(payload, { stage = "SETUP", expectedRelease } = {}) {
  invariant(STAGES.has(stage), `Unknown Hosting verification stage: ${stage}`);
  invariant(payload?.status === "ok" && payload?.check === "ready", "Cloud readiness endpoint is not healthy");
  invariant(payload?.service === "kai-cloud-marketplace", "Unexpected readiness service identity");
  invariant(payload?.environment?.localAcceptance === false, "Production must never run in local acceptance mode");
  invariant(typeof payload?.release === "string" && /^[a-f0-9]{40,64}$/u.test(payload.release), "Production readiness does not expose an immutable release");
  if (expectedRelease) invariant(payload.release === expectedRelease, `Expected release ${expectedRelease}, received ${payload.release}`);

  for (const store of ["auth", "cardHours", "hostingV2"]) {
    invariant(payload?.storage?.[store]?.ready === true, `Required storage is not ready: ${store}`);
  }
  invariant(payload?.capabilities?.kaiIdentityLogin?.available === true, "KAI Identity login is not available");
  invariant(payload?.capabilities?.alipayLive?.enabled === false && payload?.capabilities?.alipayLive?.available === false, "Alipay must remain closed during the trial rollout");

  const hosting = payload?.hostingV2;
  invariant(hosting?.configurationEnabled === true && hosting?.failClosed === true, "Hosting V2 configuration or fail-closed gate is not active");
  invariant(hosting?.fundingMode === "ADMIN_DUAL_CONTROL_TRIAL_GRANTS", "Unexpected Hosting funding mode");
  const checks = hosting?.checks;
  for (const name of [
    "storage", "supplierIdentity", "trialGrantRequest", "trialGrantApproval", "feeSchedule",
    "cardHourLedger", "approvedImages", "supplierTerms", "cleanup", "alipayClosed",
  ]) readyCheck(checks, name);
  invariant(Number(checks?.approvedImages?.count) >= 1, "No approved immutable workload image is configured");

  const operations = hosting?.operations;
  invariant(operations?.integrity === "ok", "Hosting operational storage integrity is not ok");
  invariant(Number(operations?.approvedSupplierCount) >= 1, "No independently approved supplier is available");
  invariant(Number(operations?.drainingDeviceCount) === 0, "A device is draining and blocks safe rollout");
  invariant(Number(operations?.failedCleanupCount) === 0, "A failed cleanup blocks safe rollout");
  invariant(Number(operations?.cleaningContractCount) === 0, "A contract is still cleaning and blocks safe rollout");

  if (stage === "SETUP") {
    invariant(hosting.enabled === false && hosting.rolloutMode === "SETUP", "SETUP stage must keep public Hosting V2 disabled");
    invariant(checks?.agentDelivery?.ready === false && checks?.agentDelivery?.reason === "HOSTING_ACTIVE_AGENT_MISSING", "SETUP stage must have no active Host Agent");
    invariant(checks?.metering?.ready === false && checks?.metering?.reason === "HOSTING_METERING_NOT_READY", "SETUP stage must keep metering closed until an Agent connects");
    invariant(Number(operations?.activeAgentCount) === 0, "SETUP stage unexpectedly contains an active Host Agent");
  } else {
    readyCheck(checks, "agentDelivery");
    readyCheck(checks, "metering");
    invariant(Number(operations?.activeAgentCount) >= 1, "No active Host Agent is connected");
    if (stage === "AGENT_CONNECTED") {
      invariant(hosting.enabled === false && hosting.rolloutMode === "SETUP", "AGENT_CONNECTED stage must remain closed until the trial switch is enabled");
    } else {
      invariant(hosting.enabled === true && hosting.ready === true && hosting.rolloutMode === "INTERNAL_AGENT_TRIAL", "Internal Hosting trial is not transaction-ready");
    }
  }

  return Object.freeze({
    status: "ok",
    stage,
    release: payload.release,
    approvedSupplierCount: Number(operations.approvedSupplierCount),
    activeAgentCount: Number(operations.activeAgentCount),
    approvedImageCount: Number(checks.approvedImages.count),
  });
}

async function responseJson(response, label) {
  invariant(response.status === 200, `${label} returned HTTP ${response.status}`);
  invariant(response.headers.get("content-type")?.toLowerCase().includes("application/json"), `${label} did not return JSON`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  invariant(bytes.byteLength <= MAX_RESPONSE_BYTES, `${label} response exceeds ${MAX_RESPONSE_BYTES} bytes`);
  try { return JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw new Error(`${label} returned invalid JSON`); }
}

export async function verifyHostingProduction({
  origin = "https://cloud.kai.com",
  stage = "SETUP",
  expectedRelease,
  fetchImpl = fetch,
} = {}) {
  const base = canonicalOrigin(origin);
  const readiness = await responseJson(await fetchImpl(`${base}/api/ready`, {
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
    headers: { accept: "application/json" },
  }), "Cloud readiness");
  const result = verifyHostingProductionSnapshot(readiness, { stage, expectedRelease });

  if (stage === "MARKET") {
    const offers = await responseJson(await fetchImpl(`${base}/api/v2/offers`, {
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
      headers: { accept: "application/json" },
    }), "Public Hosting offers");
    invariant(Array.isArray(offers.items) && offers.items.length >= 1, "MARKET stage has no verified public GPU offer");
    return Object.freeze({ ...result, publicOfferCount: offers.items.length });
  }
  return result;
}

async function main() {
  const result = await verifyHostingProduction({
    origin: process.env.KAI_HOSTING_VERIFY_ORIGIN,
    stage: process.env.KAI_HOSTING_VERIFY_STAGE || "SETUP",
    expectedRelease: process.env.KAI_HOSTING_VERIFY_RELEASE,
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`HOSTING_PRODUCTION_VERIFICATION_FAILED: ${error instanceof Error ? error.message : "Unknown failure"}\n`);
    process.exitCode = 1;
  });
}
