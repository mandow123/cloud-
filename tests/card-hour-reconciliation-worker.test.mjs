import assert from "node:assert/strict";
import test from "node:test";
import { paymentFixture } from "./helpers/payment-fixture.mjs";
import { createCardHourReconciliationWorker } from "../lib/server/card-hour-reconciliation-worker.ts";

async function topup(f,index=0) {
  return (await f.card.createTopup({account:f.account,provider:"QIXIANG_PAY",providerMerchantRef:"10086",providerPaymentType:"alipay",cardHourMicros:5000000,amountCents:501,idempotencyKey:`topup-fixture-${index}`,payloadHash:`hash-${index}`,now:f.input.now,expiresAt:new Date(Date.parse(f.input.now)+900000).toISOString()})).record;
}
async function alipayTopup(f,index=0) {
  return (await f.card.createTopup({account:f.account,provider:"ALIPAY",providerMerchantRef:null,providerPaymentType:null,cardHourMicros:5000000,amountCents:501,idempotencyKey:`alipay-topup-fixture-${index}`,payloadHash:`alipay-hash-${index}`,now:f.input.now,expiresAt:new Date(Date.parse(f.input.now)+900000).toISOString()})).record;
}
const confirmed=(expected)=>({providerOrderId:expected.orderId,providerEventId:`query:trade_${expected.orderId}:TRADE_SUCCESS`,providerTransactionId:`trade_${expected.orderId}`,eventType:"CAPTURED",amountCents:501,rawPayloadDigest:"f".repeat(64),occurredAt:new Date().toISOString(),verifiedAt:new Date().toISOString()});

test("worker recovers a topup after browser closure, competes safely with a callback, and never double credits",async()=>{
  const f=await paymentFixture();
  try {
    const order=await topup(f);
    let now=Date.parse(f.input.now), queries=0;
    const worker=createCardHourReconciliationWorker({store:f.card,now:()=>now,environment:{KAI_QIXIANG_PAY_PID:"10086"},query:async(expected)=>{queries++; const event=confirmed(expected);await f.card.applyTopupEvent({orderId:order.id,provider:"QIXIANG_PAY",providerEventId:"notify:fixture:TRADE_SUCCESS",providerTransactionId:event.providerTransactionId,eventType:"CAPTURED",amountCents:501,payloadDigest:"a".repeat(64),occurredAt:f.input.now,receivedAt:f.input.now});return event;}});
    const before=f.db.prepare("SELECT available_micros FROM card_hour_wallets").get().available_micros;
    await worker.tick();
    assert.equal((await f.card.getTopup(order.id)).status,"CAPTURED");
    assert.equal(f.db.prepare("SELECT available_micros FROM card_hour_wallets").get().available_micros,before+5000000);
    now+=60000;await worker.tick();assert.equal(queries,1);
    assert.equal(f.db.prepare("SELECT COUNT(*) n FROM card_hour_ledger_batches WHERE operation='TOPUP'").get().n,1);
  } finally { f.db.close(); }
});

test("worker reconciles direct Alipay topups and leaves pending orders uncredited",async()=>{
  const f=await paymentFixture();
  try {
    const order=await alipayTopup(f);
    let now=Date.parse(f.input.now),status="PENDING",queries=0;
    const worker=createCardHourReconciliationWorker({
      store:f.card,
      now:()=>now,
      environment:{KAI_ALIPAY_SELLER_ID:"2088000000000001"},
      alipayQuery:async(expected)=>{
        queries++;
        return {provider:"ALIPAY",environment:"LIVE",providerOrderId:expected.orderId,providerEventId:`query:20260918220000000001:${status}`,providerTransactionId:"20260918220000000001",eventType:status,amountCents:expected.amountCents,currency:"CNY",rawPayloadDigest:"b".repeat(64),occurredAt:new Date(now).toISOString(),verifiedAt:new Date(now).toISOString(),verificationMethod:"ALIPAY_RSA2_ORDER_QUERY",fundsMoved:status==="CAPTURED"};
      },
    });
    const before=f.db.prepare("SELECT available_micros FROM card_hour_wallets").get().available_micros;
    const pending=await worker.tick();
    assert.equal(pending.deferred,1);
    assert.equal((await f.card.getTopup(order.id)).status,"PENDING");
    assert.equal(f.db.prepare("SELECT available_micros FROM card_hour_wallets").get().available_micros,before);
    now+=60000;status="CAPTURED";
    const captured=await worker.tick();
    assert.equal(captured.captured,1);
    assert.equal((await f.card.getTopup(order.id)).status,"CAPTURED");
    assert.equal(f.db.prepare("SELECT available_micros FROM card_hour_wallets").get().available_micros,before+5000000);
    assert.equal(queries,2);
  } finally { f.db.close(); }
});

test("worker scan is bounded to 50 per minute; cooled first page does not starve the next page",async()=>{
  const f=await paymentFixture();
  try {
    for(let i=0;i<60;i++)await topup(f,i);
    let now=Date.parse(f.input.now);let calls=0;
    const worker=createCardHourReconciliationWorker({store:f.card,now:()=>now,environment:{KAI_QIXIANG_PAY_PID:"10086"},query:async()=>{calls++;throw new Error("unknown");}});
    const result=await worker.tick();assert.equal(result.scanned,50);assert.equal(calls,50);
    assert.equal((await worker.tick()).skipped,true);assert.equal(calls,50);
    now+=60000;await worker.tick();
    assert.equal(f.db.prepare("SELECT COUNT(*) n FROM card_hour_topup_reconciliation_claims").get().n,60);
  } finally { f.db.close(); }
});

test("persistent leases survive worker recreation, stale ownership cannot release a newer lease, retries back off",async()=>{
  const f=await paymentFixture();
  try {
    const order=await topup(f);let now=Date.parse(f.input.now);
    const input={orderId:order.id,organizationId:f.account.activeOrganization.id,now:new Date(now).toISOString(),staleBefore:new Date(now-120000).toISOString(),nextEligibleAt:new Date(now+30000).toISOString()};
    const first=await f.card.claimTopupReconciliation(input);assert.equal(first.claimed,true);
    assert.equal((await f.card.claimTopupReconciliation(input)).claimed,false);
    now+=120000;
    const newer=await f.card.claimTopupReconciliation({...input,now:new Date(now).toISOString(),staleBefore:new Date(now-120000).toISOString()});assert.equal(newer.claimed,true);
    await f.card.releaseTopupReconciliation({...input,claimToken:first.claimToken});
    assert.equal(f.db.prepare("SELECT claim_token FROM card_hour_topup_reconciliation_claims").get().claim_token,newer.claimToken);
    await f.card.releaseTopupReconciliation({...input,claimToken:newer.claimToken,now:new Date(now).toISOString()});
    const lease=f.db.prepare("SELECT * FROM card_hour_topup_reconciliation_claims").get();
    assert.equal(Date.parse(lease.next_query_at)-now,60000);
    f.db.exec("UPDATE card_hour_topup_reconciliation_claims SET attempt_count=12");
    await f.card.escalateTopupReconciliation({...input});await f.card.escalateTopupReconciliation({...input});
    assert.equal(f.db.prepare("SELECT COUNT(*) n FROM admin_work_items").get().n,1);
    assert.equal((await f.card.getTopup(order.id)).status,"PENDING");
  } finally { f.db.close(); }
});
