import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source=(path)=>readFileSync(new URL(`../${path}`,import.meta.url),"utf8");

test("liveness remains a lightweight process-only check",()=>{
  const live=source("app/api/live/route.ts");
  assert.doesNotMatch(live,/readiness|getMarketplaceStore|getExchangeStore|getSupplyStore|getAdminOperationsStore|getAccountAuthStore/);
  assert.match(live,/status:\s*"ok"/);assert.match(live,/check:\s*"live"/);
});

test("readiness probes every storage domain without creating identities or granting roles",()=>{
  const route=source("app/api/ready/route.ts"),readiness=source("lib/server/readiness.ts");
  assert.match(route,/evaluateReadiness/);
  for(const dependency of ["createMarketplaceReadinessStore","getExchangeStore","getSupplyStore","getAdminOperationsStore","getAccountAuthStore","getStandardizationStore","getCardHourStore","getHostingV2Store","evaluateHostingV2Capability"])assert.match(readiness,new RegExp(dependency));
  assert.doesNotMatch(readiness,/resolveOrCreateIdentity|activateMembership|invitePrincipal|createOffer|createResource|createCheckout/);
  assert.match(readiness,/failClosed:true/);
  assert.match(readiness,/isHostingV2ConfigurationEnabled\(environment\)/);
  assert.match(readiness,/probe:"deferred"/);
});
