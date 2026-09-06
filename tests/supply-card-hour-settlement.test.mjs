import assert from "node:assert/strict";
import test from "node:test";
import { paymentFixture } from "./helpers/payment-fixture.mjs";
import { scanSupplyPaymentRecovery, recoverSupplyPayment } from "../lib/server/supply-card-hour-recovery.ts";

const balance = (f) => f.db.prepare("SELECT available_micros FROM card_hour_wallets WHERE organization_id=?").get(f.account.activeOrganization.id).available_micros;
const count = (f, table) => f.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;

test("concurrent requests atomically settle once; paid replay survives expiry and new keys remain bound", async () => {
  const f = await paymentFixture();
  try {
    const results = await Promise.all([f.card.settleSupplyOrder(f.input), f.card.settleSupplyOrder(f.input)]);
    assert.deepEqual(results.map((r) => r.replayed).sort(), [false,true]);
    assert.equal(balance(f), 100000000-results[0].amountMicros);
    assert.equal(count(f,"card_hour_order_payments"),1);
    assert.equal(count(f,"card_hour_ledger_batches"),1);
    assert.equal(count(f,"card_hour_ledger_entries"),2);
    assert.equal(count(f,"supply_trial_payment_events"),1);
    assert.equal(f.db.prepare("SELECT status FROM supply_allocation_bindings").get().status,"LOCKED");
    assert.equal(f.db.prepare("SELECT status FROM supply_trial_deliveries").get().status,"AWAITING_KEY");
    const later = { ...f.input, now: "2099-01-01T00:00:00.000Z", idempotencyKey: "payment-new-key-000001" };
    assert.equal((await f.card.settleSupplyOrder(later)).replayed,true);
    f.db.prepare("INSERT INTO card_hour_order_payments(id,organization_id,account_id,source_system,order_id,amount_micros,cny_reference_cents,rate_numerator,rate_denominator,status,idempotency_key,payload_hash,created_at,updated_at) VALUES('other-payment',?,?,'EXCHANGE','other-order',1000000,101,501,500,'CAPTURED','other-order-key-0001','other-hash',?,?)").run(f.account.activeOrganization.id,f.account.account.id,f.input.now,f.input.now);
    await assert.rejects(f.card.settleSupplyOrder({ ...later, idempotencyKey:"other-order-key-0001" }), (e)=>e.status===409);
    await assert.rejects(f.card.settleSupplyOrder({ ...f.input, actorId:"other-org" }), (e)=>e.status===404);
    assert.equal(count(f,"card_hour_order_payments"),2);
  } finally { f.db.close(); }
});

test("insufficient wallet, unpaid expiry and supply-stage faults never leave a debit or receipt", async () => {
  const f = await paymentFixture();
  try {
    await assert.rejects(f.card.settleSupplyOrder({ ...f.input, now:"2099-01-01T00:00:00.000Z" }), (e)=>e.status===410);
    f.db.exec("UPDATE card_hour_wallets SET available_micros=0");
    await assert.rejects(f.card.settleSupplyOrder(f.input), (e)=>e.code==="CARD_HOUR_BALANCE_INSUFFICIENT");
    f.db.exec("UPDATE card_hour_wallets SET available_micros=100000000");
    f.db.exec("CREATE TEMP TRIGGER fixture_fault BEFORE UPDATE ON supply_trial_deliveries BEGIN SELECT RAISE(ABORT,'injected_delivery_fault'); END");
    await assert.rejects(f.card.settleSupplyOrder(f.input), /injected_delivery_fault/);
    assert.equal(balance(f),100000000);
    for(const table of ["card_hour_order_payments","card_hour_ledger_batches","card_hour_ledger_entries","supply_trial_payment_events","supply_trial_payments"]) assert.equal(count(f,table),0,table);
    assert.equal(f.db.prepare("SELECT COUNT(*) n FROM supply_command_receipts WHERE idempotency_key=?").get(f.input.idempotencyKey).n,0);
    f.db.exec("DROP TRIGGER fixture_fault");
    assert.equal((await f.card.settleSupplyOrder(f.input)).replayed,false);
  } finally { f.db.close(); }
});

test("legacy debit is reviewed without a new debit, then recoverable live reservation completes once", async () => {
  const f = await paymentFixture();
  try {
    await f.legacyDebit();
    const before = balance(f);
    await assert.rejects(f.card.settleSupplyOrder(f.input), (e)=>e.code==="EXCHANGE_PAYMENT_REVIEW_REQUIRED");
    const scan = await scanSupplyPaymentRecovery(f.adapter,{now:f.input.now});
    assert.equal(scan.records[0].decision,"COMPLETE_CAPTURE");
    assert.equal(count(f,"admin_audit_events"),0,"scan has no side effects");
    const result = await recoverSupplyPayment(f.adapter,{orderId:f.order.id,expectedFingerprint:scan.records[0].fingerprint,now:f.input.now,operatorId:"fixture-operator"});
    assert.equal(result.decision,"COMPLETE_CAPTURE");
    assert.equal(balance(f),before);
    assert.equal((await f.card.settleSupplyOrder(f.input)).replayed,true);
  } finally { f.db.close(); }
});

test("expired undelivered debit gets one compensating ledger batch and preserves all original facts", async () => {
  const f = await paymentFixture();
  try {
    await f.legacyDebit();
    const now="2099-01-01T00:00:00.000Z";
    const scan=await scanSupplyPaymentRecovery(f.adapter,{now});
    assert.equal(scan.records[0].decision,"REVERSE_UNDELIVERED");
    const input={orderId:f.order.id,expectedFingerprint:scan.records[0].fingerprint,now,operatorId:"fixture-operator"};
    await recoverSupplyPayment(f.adapter,input);
    assert.equal(balance(f),100000000);
    assert.equal(count(f,"card_hour_ledger_batches"),2);
    assert.equal(count(f,"card_hour_ledger_entries"),4);
    await assert.rejects(recoverSupplyPayment(f.adapter,input),/FACTS_CHANGED/);
    const rescan=await scanSupplyPaymentRecovery(f.adapter,{now});
    assert.equal(rescan.records[0].decision,"REVERSED");
    assert.equal((await recoverSupplyPayment(f.adapter,{...input,expectedFingerprint:rescan.records[0].fingerprint})).applied,false);
  } finally { f.db.close(); }
});

test("changed facts, delivered state or vested commission cannot be automatically repaired", async () => {
  const f=await paymentFixture();
  try {
    await f.legacyDebit();
    const now="2099-01-01T00:00:00.000Z";
    const scan=await scanSupplyPaymentRecovery(f.adapter,{now});
    f.db.exec("UPDATE supply_trial_deliveries SET status='READY',version=version+1,secure_endpoint_ref='secure-ref:fixture-test'");
    await assert.rejects(recoverSupplyPayment(f.adapter,{orderId:f.order.id,expectedFingerprint:scan.records[0].fingerprint,now,operatorId:"operator"}),/FACTS_CHANGED/);
    const rescan=await scanSupplyPaymentRecovery(f.adapter,{now});
    assert.equal(rescan.records[0].decision,"MANUAL_REVIEW");
    const before=balance(f);
    await recoverSupplyPayment(f.adapter,{orderId:f.order.id,expectedFingerprint:rescan.records[0].fingerprint,now,operatorId:"operator"});
    assert.equal(balance(f),before);
    assert.equal(count(f,"admin_work_items"),1);
  } finally { f.db.close(); }
});

test("vested or contradictory commission evidence always enters manual review without moving value",async()=>{
  for(const scenario of ["VESTED","PENDING_WITH_VEST_DATE","PENDING_WITH_POSTED_LEDGER"]) {
    const f=await paymentFixture();
    try {
      f.db.prepare("INSERT INTO card_hour_referral_codes(organization_id,code,created_at) VALUES('referrer-org','REFERRALFIXTURE',?)").run(f.input.now);
      f.db.prepare("INSERT INTO card_hour_referral_attributions(invitee_organization_id,referrer_organization_id,referral_code,created_at) VALUES(?,'referrer-org','REFERRALFIXTURE',?)").run(f.account.activeOrganization.id,f.input.now);
      await f.legacyDebit();
      if(scenario==="VESTED")f.db.prepare("UPDATE card_hour_income_accruals SET status='VESTED',vested_at=?").run(f.input.now);
      if(scenario==="PENDING_WITH_VEST_DATE")f.db.prepare("UPDATE card_hour_income_accruals SET vested_at=?").run(f.input.now);
      if(scenario==="PENDING_WITH_POSTED_LEDGER")f.db.prepare("INSERT INTO card_hour_ledger_batches(id,organization_id,operation,business_key,amount_micros,status,metadata_json,created_at) VALUES('commission-fixture','referrer-org','COMMISSION_INCOME',?,1000,'POSTED',?,?)").run(`commission:SUPPLY_PILOT:${f.order.id}`,JSON.stringify({orderId:f.order.id}),f.input.now);
      const now="2099-01-01T00:00:00.000Z";
      const scan=await scanSupplyPaymentRecovery(f.adapter,{now});
      assert.equal(scan.records[0].decision,"MANUAL_REVIEW",scenario);
      const before=balance(f);
      await recoverSupplyPayment(f.adapter,{orderId:f.order.id,expectedFingerprint:scan.records[0].fingerprint,now,operatorId:"operator"});
      assert.equal(balance(f),before,scenario);
      assert.equal(count(f,"admin_work_items"),1);
    } finally {f.db.close();}
  }
});

test("foreign allocation ownership and prior cleanup evidence cannot be released by recovery",async()=>{
  for(const scenario of ["FOREIGN_ALLOCATION","MISMATCHED_WINDOW","PRIOR_CLEANUP"]) {
    const f=await paymentFixture();
    try {
      await f.legacyDebit();
      if(scenario==="FOREIGN_ALLOCATION") f.db.exec("UPDATE supply_allocation_bindings SET buyer_actor_id='foreign-organization'");
      if(scenario==="MISMATCHED_WINDOW") f.db.exec("UPDATE supply_allocation_bindings SET node_hours=2");
      if(scenario==="PRIOR_CLEANUP") f.db.exec("UPDATE supply_trial_deliveries SET cleanup_evidence_digest='sha256:previous-delivery'");
      const now="2099-01-01T00:00:00.000Z";
      const scan=await scanSupplyPaymentRecovery(f.adapter,{now});assert.equal(scan.records[0].decision,"MANUAL_REVIEW",scenario);
      const before=balance(f);
      await recoverSupplyPayment(f.adapter,{orderId:f.order.id,expectedFingerprint:scan.records[0].fingerprint,now,operatorId:"operator"});
      assert.equal(balance(f),before);
      assert.equal(f.db.prepare("SELECT status FROM supply_allocation_bindings").get().status,"RESERVED");
    } finally {f.db.close();}
  }
});

test("a different order winning the same key at the transaction barrier yields 409, not SQL 500",async()=>{
  const f=await paymentFixture();
  try {
    const original=f.adapter.batch;
    let reached,release;
    const barrier=new Promise(resolve=>{reached=resolve;});
    const waiting=new Promise(resolve=>{release=resolve;});
    f.adapter.batch=async(items)=>{
      if(items.some(item=>item.sql.startsWith("INSERT INTO card_hour_order_payments")&&item.values.includes("SUPPLY_PILOT"))) {reached();await waiting;}
      return original(items);
    };
    const pending=f.card.settleSupplyOrder(f.input);
    await barrier;
    await f.card.captureOrder({...f.input,sourceSystem:"EXCHANGE",orderId:"other-committed-order",amountMicros:1000000,cnyReferenceCents:101,payloadHash:"other-order-hash"});
    release();
    await assert.rejects(pending,error=>error.code==="IDEMPOTENCY_CONFLICT"&&error.status===409);
    assert.equal(balance(f),99000000);
    assert.equal(f.db.prepare("SELECT COUNT(*) n FROM supply_trial_payment_events").get().n,0);
  } finally {f.db.close();}
});

test("a refunded marker with missing compensating entries is a manual case, not a completed recovery",async()=>{
  const f=await paymentFixture();
  try {
    await f.legacyDebit();
    const now="2099-01-01T00:00:00.000Z";
    const scan=await scanSupplyPaymentRecovery(f.adapter,{now});
    await recoverSupplyPayment(f.adapter,{orderId:f.order.id,expectedFingerprint:scan.records[0].fingerprint,now,operatorId:"operator"});
    // Deliberately emulate an inconsistent imported historical database.
    f.db.exec("DROP TRIGGER card_hour_entries_immutable_delete");
    f.db.exec("DELETE FROM card_hour_ledger_entries WHERE batch_id IN (SELECT id FROM card_hour_ledger_batches WHERE operation='ORDER_REFUND')");
    const rescan=await scanSupplyPaymentRecovery(f.adapter,{now});
    assert.equal(rescan.records[0].decision,"MANUAL_REVIEW");
    const before=balance(f);
    await recoverSupplyPayment(f.adapter,{orderId:f.order.id,expectedFingerprint:rescan.records[0].fingerprint,now,operatorId:"operator"});
    assert.equal(balance(f),before);assert.equal(count(f,"admin_work_items"),1);
  } finally {f.db.close();}
});
