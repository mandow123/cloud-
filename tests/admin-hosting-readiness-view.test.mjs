import assert from "node:assert/strict";
import test from "node:test";

import { hostingReadinessFromPayload } from "../lib/admin-hosting-readiness-view.ts";

function payload(identity) {
  const ready = { ready: true, failClosed: true };
  return {
    capabilities: { kaiIdentityLogin: identity },
    hostingV2: {
      enabled: false,
      configurationEnabled: true,
      ready: true,
      rolloutMode: "SETUP",
      checks: {
        storage: ready,
        supplierIdentity: ready,
        trialGrantRequest: ready,
        trialGrantApproval: ready,
        agentDelivery: ready,
        feeSchedule: ready,
        cardHourLedger: ready,
        approvedImages: ready,
        supplierTerms: ready,
        metering: ready,
        cleanup: ready,
        alipayClosed: ready,
      },
    },
  };
}

test("admin Hosting readiness never displays a failure reason for an available Identity client", () => {
  const view = hostingReadinessFromPayload(payload({
    available: true,
    configured: true,
    failClosed: true,
    missing: [],
    probe: "read-only",
  }));
  const identity = view?.items.find((item) => item.key === "identity");
  assert.deepEqual(identity && { ready: identity.ready, reason: identity.reason }, {
    ready: true,
    reason: "已通过服务端只读核验",
  });
});

test("admin Hosting readiness preserves the Identity failure reason while unavailable", () => {
  const view = hostingReadinessFromPayload(payload({
    available: false,
    configured: false,
    failClosed: true,
    missing: ["OIDC_DISCOVERY_INVALID"],
  }));
  const identity = view?.items.find((item) => item.key === "identity");
  assert.deepEqual(identity && { ready: identity.ready, reason: identity.reason }, {
    ready: false,
    reason: "统一身份中心 Discovery 当前不可用或配置不一致",
  });
});
