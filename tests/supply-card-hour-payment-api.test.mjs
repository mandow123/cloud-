import assert from "node:assert/strict";
import test from "node:test";
import { paymentFixture } from "./helpers/payment-fixture.mjs";
import { createSqliteAccountAuthStore } from "../lib/server/account-auth-sqlite.ts";
import { createAccountSession } from "../lib/server/account-auth.ts";
import { hashText } from "../lib/server/marketplace-actor.ts";
import { POST } from "../app/api/v1/orders/[id]/payment-intents/route.ts";

async function apiFixture() {
  const auth=await createSqliteAccountAuthStore(":memory:");
  const identityInput={provider:"EMAIL",tenantKey:"EXTERNAL",subject:"payment-fixture",displayName:"Fixture",normalizedEmail:"fixture@example.test",organizationExternalKey:"PAYMENT-FIXTURE",organizationName:"Fixture",verifiedAt:new Date().toISOString()};
  let identity=await auth.resolveOrCreateIdentity(identityInput);
  await auth.activateMembership(identity.membership.id,[],identityInput.verifiedAt);
  identity=await auth.resolveOrCreateIdentity(identityInput);
  const issued=await createAccountSession(new Request("https://cloud.kai.com/api/auth/fixture"),identity,"EMAIL_OTP",{store:auth});
  const f=await paymentFixture(issued.context);
  const globals=["__kaiAccountAuthStorePromise","__kaiSupplyStorePromise","__kaiCardHourStorePromise","__kaiMarketplaceStorePromise"];
  const previous=Object.fromEntries(globals.map(key=>[key,globalThis[key]]));
  const legacy=process.env.KAI_ALLOW_LEGACY_ANON_WRITES;
  delete process.env.KAI_ALLOW_LEGACY_ANON_WRITES;
  globalThis.__kaiAccountAuthStorePromise=Promise.resolve(auth);
  globalThis.__kaiSupplyStorePromise=Promise.resolve(f.supply);
  globalThis.__kaiCardHourStorePromise=Promise.resolve(f.card);
  globalThis.__kaiMarketplaceStorePromise=Promise.resolve({touchSession:async()=>true});
  const browserToken="b".repeat(64);
  const csrf=await hashText(`kai-cloud-csrf:${browserToken}`);
  function request(key=f.input.idempotencyKey, cookie=issued.cookie.split(";")[0]) {return new Request(`https://cloud.kai.com/api/v1/orders/${f.order.id}/payment-intents`,{method:"POST",headers:{origin:"https://cloud.kai.com",cookie:`${cookie}; __Host-kai_session=${browserToken}`,"x-kai-csrf":csrf,"idempotency-key":key}});}
  async function call(key,cookie){return POST(request(key,cookie),{params:Promise.resolve({id:f.order.id})});}
  function close(){Object.assign(globalThis,previous);if(legacy===undefined)delete process.env.KAI_ALLOW_LEGACY_ANON_WRITES;else process.env.KAI_ALLOW_LEGACY_ANON_WRITES=legacy;auth.close();f.db.close();}
  return {...f,auth,call,close};
}

test("real payment API authenticates, returns 201 once and 200 for same or new key after expiry",async()=>{
  const f=await apiFixture();
  try {
    assert.equal((await f.call(undefined,"")).status,401);
    const responses=await Promise.all([f.call(),f.call()]);
    assert.deepEqual(responses.map(r=>r.status).sort(),[200,201]);
    const records=await Promise.all(responses.map(r=>r.json()));
    assert.equal(records[0].record.orderId,f.order.id);
    f.db.prepare("UPDATE supply_trial_orders SET expires_at=? WHERE id=?").run("2020-01-01T00:00:00.000Z",f.order.id);
    const replay=await f.call("payment-after-expiry-0001");
    assert.equal(replay.status,200);assert.equal(replay.headers.get("idempotency-replayed"),"true");
    assert.equal(f.db.prepare("SELECT COUNT(*) n FROM card_hour_order_payments").get().n,1);
    assert.equal(f.db.prepare("SELECT COUNT(*) n FROM supply_trial_payment_events").get().n,1);
  } finally {f.close();}
});

test("real payment API returns 410 before debit for an unpaid expired reservation",async()=>{
  const f=await apiFixture();
  try {
    f.db.prepare("UPDATE supply_trial_orders SET expires_at=? WHERE id=?").run("2020-01-01T00:00:00.000Z",f.order.id);
    assert.equal((await f.call()).status,410);
    assert.equal(f.db.prepare("SELECT COUNT(*) n FROM card_hour_order_payments").get().n,0);
  } finally {f.close();}
});
