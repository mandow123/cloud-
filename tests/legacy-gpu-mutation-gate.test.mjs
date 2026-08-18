import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { requireLegacyGpuMutationSimulation } from "../lib/server/legacy-gpu-mutation-gate.ts";

const ROOT = process.cwd();
const LEGACY_GPU_MUTATION_ROUTES = [
  "app/api/v1/admin/refund-cases/[id]/decision/route.ts",
  "app/api/v1/admin/refund-cases/[id]/retry/route.ts",
  "app/api/v1/admin/refund-cases/route.ts",
  "app/api/v1/checkouts/route.ts",
  "app/api/v1/delivery-packages/[id]/claim/route.ts",
  "app/api/v1/delivery-packages/[id]/connection-tests/route.ts",
  "app/api/v1/delivery-packages/[id]/reviews/route.ts",
  "app/api/v1/delivery-tasks/[id]/packages/route.ts",
  "app/api/v1/integrations/payment-events/route.ts",
  "app/api/v1/lab/gpu-loop/route.ts",
  "app/api/v1/orders/[id]/acceptances/route.ts",
  "app/api/v1/orders/[id]/delivery-start/route.ts",
  "app/api/v1/orders/[id]/payment-intents/route.ts",
  "app/api/v1/orders/[id]/supplier-confirmation/route.ts",
  "app/api/v1/orders/[id]/test-meter-complete/route.ts",
  "app/api/v1/orders/[id]/test-payment/route.ts",
  "app/api/v1/orders/[id]/test-service-start/route.ts",
  "app/api/v1/payments/alipay/notify/route.ts",
  "app/api/v1/settlements/[id]/test-record/route.ts",
  "app/api/v1/supply/orders/[id]/cleanup/route.ts",
  "app/api/v1/supply/orders/[id]/connection-check/route.ts",
  "app/api/v1/supply/orders/[id]/service-complete/route.ts",
  "app/api/v1/supply/orders/[id]/service-start/route.ts",
  "app/api/v1/supply/orders/[id]/ssh-key/route.ts",
  "app/api/v1/supply/trial-orders/route.ts",
].sort();

function routeFiles(directory) {
  return readdirSync(join(ROOT, directory), { withFileTypes: true }).flatMap((entry) => {
    const relative = join(directory, entry.name);
    return entry.isDirectory() ? routeFiles(relative) : entry.name === "route.ts" ? [relative] : [];
  });
}

function isLegacyGpuTransactionMutation(route, source) {
  if (!/export async function (?:POST|PUT|PATCH|DELETE)/u.test(source)) return false;
  return /app\/api\/v1\/(?:admin\/refund-cases(?:\/|$)|checkouts\/|delivery-(?:packages|tasks)\/|integrations\/payment-events\/|lab\/gpu-loop\/|orders\/\[id\]\/(?:acceptances|delivery-start|payment-intents|supplier-confirmation|test-meter-complete|test-payment|test-service-start)\/|payments\/alipay\/notify\/|settlements\/\[id\]\/test-record\/|supply\/(?:trial-orders|orders\/\[id\]\/(?:cleanup|connection-check|service-complete|service-start|ssh-key))\/)/u.test(route);
}

test("every legacy GPU transaction mutation route is guarded by the single server gate", () => {
  const scanned = routeFiles("app/api/v1")
    .filter((route) => isLegacyGpuTransactionMutation(route, readFileSync(join(ROOT, route), "utf8")))
    .sort();
  assert.deepEqual(scanned, LEGACY_GPU_MUTATION_ROUTES, "the scanner and reviewed legacy transaction inventory must stay in sync");
  for (const route of LEGACY_GPU_MUTATION_ROUTES) {
    const source = readFileSync(join(ROOT, route), "utf8");
    assert.match(source, /export async function POST/u, `${route} must remain a mutation route while compatibility exists`);
    assert.match(source, /from "@\/lib\/server\/legacy-gpu-mutation-gate"/u, `${route} must import the shared gate`);
    assert.match(source, /requireLegacyGpuMutationSimulation\(/u, `${route} must call the shared gate before mutation`);
  }
});

test("production fails closed even when legacy simulation flags are copied", { concurrency: false }, () => {
  const previous = { ...process.env };
  try {
    process.env.KAI_ENVIRONMENT = "PRODUCTION";
    process.env.KAI_LEGACY_GPU_MUTATION_SIMULATION = "1";
    process.env.KAI_GPU_LAB_ENABLED = "1";
    assert.throws(() => requireLegacyGpuMutationSimulation(), { code: "LEGACY_GPU_MUTATION_CLOSED", status: 503 });
    assert.throws(() => requireLegacyGpuMutationSimulation("LAB"), { code: "LEGACY_GPU_MUTATION_CLOSED", status: 503 });
  } finally {
    process.env = previous;
  }
});

test("only an explicit local simulation can use legacy compatibility mutations", { concurrency: false }, () => {
  const previous = { ...process.env };
  try {
    process.env.KAI_ENVIRONMENT = "LOCAL";
    delete process.env.KAI_LEGACY_GPU_MUTATION_SIMULATION;
    assert.throws(() => requireLegacyGpuMutationSimulation(), { code: "LEGACY_GPU_MUTATION_CLOSED" });
    process.env.KAI_LEGACY_GPU_MUTATION_SIMULATION = "1";
    assert.doesNotThrow(() => requireLegacyGpuMutationSimulation());
    process.env.KAI_GPU_LAB_ENABLED = "1";
    assert.doesNotThrow(() => requireLegacyGpuMutationSimulation("LAB"));
  } finally {
    process.env = previous;
  }
});

test("Alipay card-hour topups remain independent while its legacy GPU order branch is gated", () => {
  const source = readFileSync(join(ROOT, "app/api/v1/payments/alipay/notify/route.ts"), "utf8");
  const topupBranch = source.indexOf('event.providerOrderId.startsWith("KAI_CH_")');
  const legacyGate = source.indexOf("requireLegacyGpuMutationSimulation();");
  const trialOrderMutation = source.indexOf('getTrialOrder("alipay-notify"');
  assert.ok(topupBranch >= 0 && topupBranch < legacyGate && legacyGate < trialOrderMutation);
});
