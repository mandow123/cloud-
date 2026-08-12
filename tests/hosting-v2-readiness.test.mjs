import assert from "node:assert/strict";
import test from "node:test";

import { evaluateHostingV2Capability } from "../lib/server/hosting-v2-readiness.ts";
import { isHostingV2ConfigurationEnabled } from "../lib/server/hosting-v2-feature.ts";

const image = `ghcr.io/kai-cloud/cuda-pytorch@sha256:${"a".repeat(64)}`;
const storage = { ready: true };
const operations = {
  schemaVersion: 3,
  integrity: "ok",
  activeFeeScheduleId: "hfee_active",
  approvedSupplierCount: 1,
  activeAgentCount: 1,
  drainingDeviceCount: 0,
  failedCleanupCount: 0,
  cleaningContractCount: 0,
};
const alipayClosed = { enabled: false, configured: false, canCreatePayment: false, missing: ["KAI_ALIPAY_APP_ID"], gateway: "https://openapi.alipay.com/gateway.do", merchantAccountRef: null };

test("disabled Hosting V2 defers schema initialization so the previous image remains a direct rollback", () => {
  assert.equal(isHostingV2ConfigurationEnabled({}), false);
  assert.equal(isHostingV2ConfigurationEnabled({ KAI_HOSTING_V2: "0", KAI_HOSTING_V2_SETUP: "0" }), false);
  assert.equal(isHostingV2ConfigurationEnabled({ KAI_HOSTING_V2_SETUP: "true" }), true);
  assert.equal(isHostingV2ConfigurationEnabled({ KAI_HOSTING_V2: "1" }), true);
});

test("disabled Hosting V2 stays rollback-safe without pretending its dependencies are ready", () => {
  const result = evaluateHostingV2Capability({ environment: { KAI_HOSTING_V2: "0" }, hostingStorage: storage, cardHourStorage: storage, operations: null, kaiIdentityAvailable: false, adminPasswordAvailable: false, financeApprovalAvailable: false, alipay: alipayClosed });
  assert.equal(result.enabled, false);
  assert.equal(result.configurationEnabled, false);
  assert.equal(result.ready, true);
  assert.equal(result.rolloutMode, "DISABLED");
  assert.equal(result.checks.agentDelivery.ready, false);
});

test("setup mode exposes configuration readiness without opening public trading", () => {
  const result = evaluateHostingV2Capability({ environment: { KAI_HOSTING_V2: "0", KAI_HOSTING_V2_SETUP: "1" }, hostingStorage: storage, cardHourStorage: storage, operations: null, kaiIdentityAvailable: false, adminPasswordAvailable: false, financeApprovalAvailable: false, alipay: alipayClosed });
  assert.equal(result.enabled, false);
  assert.equal(result.configurationEnabled, true);
  assert.equal(result.ready, true, "setup mode must not remove the healthy public app from service");
  assert.equal(result.rolloutMode, "SETUP");
  assert.equal(result.checks.supplierIdentity.ready, false);
});

test("enabled Hosting V2 fails closed until every trial dependency is present", () => {
  const result = evaluateHostingV2Capability({ environment: { KAI_HOSTING_V2: "1" }, hostingStorage: { ready: false, errorCode: "HOSTING_DB_DOWN" }, cardHourStorage: { ready: false, errorCode: "CARD_HOUR_DB_DOWN" }, operations: null, kaiIdentityAvailable: false, adminPasswordAvailable: false, financeApprovalAvailable: false, alipay: alipayClosed });
  assert.equal(result.ready, false);
  assert.equal(result.checks.storage.reason, "HOSTING_DB_DOWN");
  assert.equal(result.checks.cardHourLedger.reason, "CARD_HOUR_DB_DOWN");
  assert.equal(result.checks.supplierIdentity.reason, "KAI_IDENTITY_NOT_READY");
  assert.equal(result.checks.trialGrantRequest.reason, "HOSTING_ROOT_ADMIN_NOT_READY");
  assert.equal(result.checks.trialGrantApproval.reason, "HOSTING_FINANCE_APPROVER_NOT_READY");
  assert.equal(result.checks.approvedImages.ready, false);
  assert.equal(result.checks.supplierTerms.ready, false);
});

test("internal Agent trial becomes ready only with identity, policy, fee, ledger and cleanup safety", () => {
  const environment = { KAI_HOSTING_V2: "1", KAI_HOSTING_APPROVED_IMAGES: image, KAI_HOSTING_TERMS_VERSION: "KAI_HOSTING_TERMS_2026_08" };
  const ready = evaluateHostingV2Capability({ environment, hostingStorage: storage, cardHourStorage: storage, operations, kaiIdentityAvailable: true, adminPasswordAvailable: true, financeApprovalAvailable: true, alipay: alipayClosed });
  assert.equal(ready.ready, true);
  assert.equal(ready.fundingMode, "ADMIN_DUAL_CONTROL_TRIAL_GRANTS");
  assert.equal(ready.checks.approvedImages.count, 1);
  assert.equal(ready.checks.metering.ready, true);
  assert.equal(ready.checks.cleanup.ready, true);
  assert.equal(ready.checks.alipayClosed.ready, true);
  assert.equal("activeFeeScheduleId" in ready.operations, false, "public readiness must not expose internal fee identifiers");
  assert.equal(ready.operations.activeFeeScheduleConfigured, true);

  const cleanupFailure = evaluateHostingV2Capability({ environment, hostingStorage: storage, cardHourStorage: storage, operations: { ...operations, activeAgentCount: 0, drainingDeviceCount: 1, failedCleanupCount: 1, cleaningContractCount: 1 }, kaiIdentityAvailable: true, adminPasswordAvailable: true, financeApprovalAvailable: true, alipay: alipayClosed });
  assert.equal(cleanupFailure.ready, false);
  assert.equal(cleanupFailure.checks.agentDelivery.ready, false);
  assert.equal(cleanupFailure.checks.cleanup.ready, false);

  const accidentalPaymentEnablement = evaluateHostingV2Capability({ environment, hostingStorage: storage, cardHourStorage: storage, operations, kaiIdentityAvailable: true, adminPasswordAvailable: true, financeApprovalAvailable: true, alipay: { ...alipayClosed, enabled: true, configured: true, canCreatePayment: true, missing: [] } });
  assert.equal(accidentalPaymentEnablement.ready, false);
  assert.equal(accidentalPaymentEnablement.checks.alipayClosed.reason, "ALIPAY_MUST_REMAIN_DISABLED_DURING_TRIAL");
});
