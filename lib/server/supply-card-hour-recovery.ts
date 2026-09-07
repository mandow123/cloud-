import type { CardHourDatabaseAdapter, CardHourSql } from "./card-hour-store-core.ts";
import { accountAuthDigest } from "./account-auth.ts";
import { paymentInvariant, readSupplyPaymentFacts, supplyCaptureComplete, supplyCaptureStatements, supplyDebitProven, supplyReservationCoherent, type PaymentRow, type SupplyPaymentFacts } from "./supply-card-hour-settlement.ts";

export type SupplyRecoveryDecision = "UNPAID" | "COMPLETE" | "COMPLETE_CAPTURE" | "REVERSE_UNDELIVERED" | "REVERSED" | "MANUAL_REVIEW";
function reversalProven(facts: SupplyPaymentFacts) {
  const { order, payment, debit, delivery, allocation, refundEntries } = facts;
  if (!supplyReservationCoherent(facts) || !supplyDebitProven(facts) || !order || !payment || !debit || !delivery || !allocation
    || debit.status !== "REFUNDED" || order.status !== "REFUNDED" || payment.status !== "REFUNDED" || payment.provider !== "KAI_CARD_HOUR"
    || payment.provider_order_ref !== order.id || payment.provider_transaction_ref !== `KCH_${order.id}` || allocation.status !== "CANCELLED"
    || delivery.status !== "AWAITING_PAYMENT" || delivery.buyer_public_key_fingerprint != null || delivery.secure_endpoint_ref != null
    || delivery.host_key_fingerprint != null || delivery.credential_expires_at != null || delivery.cleanup_evidence_digest != null || facts.checks.length
    || facts.rewardBatches.length || facts.rewards.some((row) => row.status !== "REVERSED" || row.vested_at != null)) return false;
  const batch = facts.batches.find((row) => row.business_key === `order-refund:SUPPLY_PILOT:${order.id}`);
  const refunds = facts.events.filter((row) => row.operation === "REFUND");
  if (!batch || facts.batches.length !== 2 || batch.operation !== "ORDER_REFUND" || batch.status !== "POSTED" || batch.organization_id !== debit.organization_id
    || Number(batch.amount_micros) !== Number(debit.amount_micros) || refundEntries.length !== 2 || refunds.length !== 1) return false;
  const event = refunds[0];
  if (event.provider !== "KAI_CARD_HOUR" || event.outcome !== "APPLIED" || event.resulting_status !== "REFUNDED" || event.provider_transaction_ref !== payment.provider_transaction_ref || Number(event.amount_cents) !== Number(order.amount_cents)) return false;
  return refundEntries.some((row) => row.batch_id === batch.id && row.organization_id === debit.organization_id && row.account_code === "USER_AVAILABLE" && row.side === "CREDIT" && Number(row.amount_micros) === Number(debit.amount_micros))
    && refundEntries.some((row) => row.batch_id === batch.id && row.organization_id == null && row.account_code === "PLATFORM_ORDER_CLEARING" && row.side === "DEBIT" && Number(row.amount_micros) === Number(debit.amount_micros));
}

export function classifySupplyPayment(facts: SupplyPaymentFacts, now: string): SupplyRecoveryDecision {
  const { order, payment, debit, delivery, allocation, events, rewards } = facts;
  if (!order) return "MANUAL_REVIEW";
  if (payment?.provider_transaction_ref != null && payment.provider_transaction_ref !== `KCH_${order.id}`) return "MANUAL_REVIEW";
  if (!debit && !facts.batches.length && !events.length && !rewards.length && (!payment || (payment.status === "PENDING" && payment.provider_transaction_ref == null))) return "UNPAID";
  if (supplyCaptureComplete(facts)) return "COMPLETE";
  if (reversalProven(facts)) return "REVERSED";
  if (!supplyReservationCoherent(facts) || !supplyDebitProven(facts) || !debit || debit.status !== "CAPTURED" || !delivery || !allocation || facts.batches.length !== 1) return "MANUAL_REVIEW";
  if (payment && (payment.provider !== "KAI_CARD_HOUR" || payment.provider_order_ref !== order.id || !["PENDING","REFUND_PENDING"].includes(String(payment.status)))) return "MANUAL_REVIEW";
  if (delivery.status !== "AWAITING_PAYMENT" || delivery.buyer_public_key_fingerprint != null || delivery.secure_endpoint_ref != null || delivery.host_key_fingerprint != null || delivery.credential_expires_at != null || delivery.cleanup_evidence_digest != null || facts.checks.length) return "MANUAL_REVIEW";
  if (facts.rewardBatches.length || rewards.length > 1 || rewards.some((row) => row.income_type !== "COMMISSION" || row.status !== "PENDING" || row.vested_at != null || !facts.attribution || row.organization_id !== facts.attribution.referrer_organization_id || Number(row.amount_micros) !== Math.floor(Number(debit.amount_micros) * 3 / 100))) return "MANUAL_REVIEW";
  if (events.some((row) => row.provider !== "KAI_CARD_HOUR" || row.operation !== "CAPTURE" || row.outcome !== "APPLIED" || Number(row.amount_cents) !== Number(order.amount_cents) || row.provider_transaction_ref !== `KCH_${order.id}`) || events.length > 1) return "MANUAL_REVIEW";
  if (order.status === "PAYMENT_PENDING" && Date.parse(String(order.expires_at)) > Date.parse(now) && allocation.status === "RESERVED" && !events.length && (!payment || payment.status === "PENDING")) return "COMPLETE_CAPTURE";
  if (["PAYMENT_PENDING","CANCELLED","FAILED","REFUND_PENDING"].includes(String(order.status)) && Date.parse(String(order.expires_at)) <= Date.parse(now) && ["RESERVED","LOCKED","CANCELLED"].includes(String(allocation.status))) return "REVERSE_UNDELIVERED";
  return "MANUAL_REVIEW";
}

/** Every inspected row and collection is checked again inside the write transaction. */
function snapshotGuards(facts: SupplyPaymentFacts): CardHourSql[] {
  const orderId = String(facts.order!.id);
  const groups: Array<[string, string, unknown[], PaymentRow[]]> = [
    ["supply_trial_orders", "id=?", [orderId], [facts.order!]],
    ["supply_trial_payments", "order_id=?", [orderId], facts.payment ? [facts.payment] : []],
    ["card_hour_order_payments", "source_system='SUPPLY_PILOT' AND order_id=?", [orderId], facts.debit ? [facts.debit] : []],
    ["supply_trial_deliveries", "order_id=?", [orderId], facts.delivery ? [facts.delivery] : []],
    ["supply_allocation_bindings", "trial_order_id=?", [orderId], facts.allocation ? [facts.allocation] : []],
    ["supply_trial_payment_events", "order_id=?", [orderId], facts.events],
    ["card_hour_income_accruals", "source_system='SUPPLY_PILOT' AND source_id=?", [orderId], facts.rewards],
    ["supply_trial_connection_checks", "order_id=?", [orderId], facts.checks],
    ["admin_entity_ownership", "source_system='SUPPLY_PILOT' AND entity_type='ORDER' AND entity_id=?", [orderId], facts.ownership ? [facts.ownership] : []],
    ["card_hour_ledger_batches", "operation IN ('COMMISSION_INCOME','COMMISSION_REVERSAL') AND (instr(business_key,?)>0 OR (json_valid(metadata_json) AND (json_extract(metadata_json,'$.orderId')=? OR json_extract(metadata_json,'$.sourceId')=?)))", [orderId,orderId,orderId], facts.rewardBatches],
    ["card_hour_referral_attributions", "invitee_organization_id=?", [facts.order!.buyer_actor_id], facts.attribution ? [facts.attribution] : []],
    ["admin_memberships", "account_id=? AND organization_id=?", [facts.debit?.account_id ?? "", facts.debit?.organization_id ?? ""], facts.payerMembership ? [facts.payerMembership] : []],
    ["card_hour_ledger_batches", "business_key IN (?,?)", [`order:SUPPLY_PILOT:${orderId}`, `order-refund:SUPPLY_PILOT:${orderId}`], facts.batches],
    ["card_hour_ledger_entries", "batch_id IN (SELECT id FROM card_hour_ledger_batches WHERE business_key=?)", [`order:SUPPLY_PILOT:${orderId}`], facts.entries],
    ["card_hour_ledger_entries", "batch_id IN (SELECT id FROM card_hour_ledger_batches WHERE business_key=?)", [`order-refund:SUPPLY_PILOT:${orderId}`], facts.refundEntries],
  ];
  return groups.flatMap(([table, predicate, values, rows]) => [
    paymentInvariant(`(SELECT COUNT(*) FROM ${table} WHERE ${predicate})=?`, [...values, rows.length]),
    ...rows.map((row) => paymentInvariant(`EXISTS(SELECT 1 FROM ${table} WHERE ${Object.keys(row).map((key) => `"${key.replaceAll('"','""')}" IS ?`).join(" AND ")})`, Object.values(row))),
  ]);
}

export async function scanSupplyPaymentRecovery(db: CardHourDatabaseAdapter, input: { now: string; afterId?: string; limit?: number }) {
  const rows = await db.all<PaymentRow>("SELECT id FROM supply_trial_orders WHERE id>? ORDER BY id LIMIT ?", [input.afterId ?? "", Math.min(500, Math.max(1, input.limit ?? 100))]);
  const records = [];
  for (const row of rows) {
    const facts = await readSupplyPaymentFacts(db, String(row.id));
    const fingerprint = await accountAuthDigest(JSON.stringify(facts));
    records.push({ orderId: String(row.id), decision: classifySupplyPayment(facts, input.now), fingerprint });
  }
  return { records, nextCursor: rows.length ? String(rows[rows.length - 1].id) : null };
}

export async function recoverSupplyPayment(db: CardHourDatabaseAdapter, input: { orderId: string; expectedFingerprint: string; now: string; operatorId: string }) {
  const facts = await readSupplyPaymentFacts(db, input.orderId);
  const fingerprint = await accountAuthDigest(JSON.stringify(facts));
  if (fingerprint !== input.expectedFingerprint) throw new Error("SUPPLY_RECOVERY_FACTS_CHANGED_RESCAN_REQUIRED");
  const decision = classifySupplyPayment(facts, input.now);
  if (["UNPAID","COMPLETE","REVERSED"].includes(decision)) return { decision, applied: false };
  if (!facts.order) throw new Error("SUPPLY_RECOVERY_ORDER_MISSING");
  const auditId = `supply-recovery:${input.orderId}:${decision}`;
  const statements: CardHourSql[] = snapshotGuards(facts);
  if (decision === "COMPLETE_CAPTURE") {
    statements.push(...supplyCaptureStatements(facts, input.now, fingerprint));
  } else if (decision === "REVERSE_UNDELIVERED") {
    const debit = facts.debit!;
    const amount = Number(debit.amount_micros);
    const batchId = `chb_refund_${input.orderId}`;
    statements.push(
      paymentInvariant("EXISTS(SELECT 1 FROM card_hour_wallets WHERE organization_id=? AND lifetime_spent_micros>=?)", [debit.organization_id, amount]),
      { sql: "UPDATE card_hour_wallets SET available_micros=available_micros+?,lifetime_spent_micros=lifetime_spent_micros-?,version=version+1,updated_at=? WHERE organization_id=?", values: [amount, amount, input.now, debit.organization_id] },
      { sql: "INSERT INTO card_hour_ledger_batches(id,organization_id,operation,business_key,amount_micros,status,metadata_json,created_at) VALUES(?,?,'ORDER_REFUND',?,?,'POSTED',?,?)", values: [batchId, debit.organization_id, `order-refund:SUPPLY_PILOT:${input.orderId}`, amount, JSON.stringify({ orderId: input.orderId, originalPaymentId: debit.id, reason: "UNDELIVERED_EXPIRED_CAPTURE", evidenceDigest: fingerprint }), input.now] },
      { sql: "INSERT INTO card_hour_ledger_entries(id,batch_id,organization_id,account_code,side,amount_micros,balance_after_micros,created_at) SELECT ?,?,?,'USER_AVAILABLE','CREDIT',?,available_micros,? FROM card_hour_wallets WHERE organization_id=?", values: [`${batchId}:credit`, batchId, debit.organization_id, amount, input.now, debit.organization_id] },
      { sql: "INSERT INTO card_hour_ledger_entries(id,batch_id,organization_id,account_code,side,amount_micros,balance_after_micros,created_at) VALUES(?,?,NULL,'PLATFORM_ORDER_CLEARING','DEBIT',?,NULL,?)", values: [`${batchId}:debit`, batchId, amount, input.now] },
      { sql: "UPDATE card_hour_order_payments SET status='REFUNDED',updated_at=? WHERE id=?", values: [input.now, debit.id] },
      { sql: "UPDATE card_hour_income_accruals SET status='REVERSED' WHERE source_system='SUPPLY_PILOT' AND source_id=? AND status='PENDING'", values: [input.orderId] },
      { sql: "INSERT OR IGNORE INTO supply_trial_payments(order_id,status,provider,provider_order_ref,provider_transaction_ref,version,created_at,updated_at) VALUES(?,'PENDING','KAI_CARD_HOUR',?,NULL,1,?,?)", values: [input.orderId, input.orderId, input.now, input.now] },
      { sql: "UPDATE supply_trial_payments SET status='REFUNDED',provider_transaction_ref=?,version=version+1,updated_at=? WHERE order_id=?", values: [`KCH_${input.orderId}`, input.now, input.orderId] },
      { sql: "INSERT INTO supply_trial_payment_events(id,order_id,provider,provider_event_ref,provider_transaction_ref,event_type,operation,amount_cents,payload_digest,outcome,resulting_status,occurred_at,received_at) VALUES(?,?,'KAI_CARD_HOUR',?,?,'RECOVERY_REFUNDED','REFUND',?,?,'APPLIED','REFUNDED',?,?)", values: [`${auditId}:event`, input.orderId, `recovery-refund:${input.orderId}`, `KCH_${input.orderId}`, facts.order.amount_cents, fingerprint, input.now, input.now] },
      { sql: "UPDATE supply_trial_orders SET status='REFUNDED',version=version+1,updated_at=? WHERE id=?", values: [input.now, input.orderId] },
      { sql: "UPDATE supply_allocation_bindings SET status='CANCELLED',updated_at=? WHERE trial_order_id=?", values: [input.now, input.orderId] },
    );
  } else {
    statements.push({ sql: "INSERT OR IGNORE INTO admin_work_items(id,source_system,entity_type,entity_id,work_type,title,summary,status,priority,metadata_json,created_by,version,created_at,updated_at) VALUES(?,'SUPPLY_PILOT','ORDER',?,'PAYMENT_RECOVERY','订单卡时支付需人工核对','归属、账本、奖励或交付证据不足，禁止再次扣款或自动冲正。','OPEN','HIGH',?,?,1,?,?)", values: [auditId, input.orderId, JSON.stringify({ evidenceDigest: fingerprint }), input.operatorId, input.now, input.now] });
  }
  statements.push({ sql: "INSERT OR IGNORE INTO admin_audit_events(id,actor_principal_id,source_system,entity_type,entity_id,action,reason,payload_digest,occurred_at) VALUES(?,?,'SUPPLY_PILOT','ORDER',?,'PAYMENT_RECOVERY',?,?,?)", values: [auditId, input.operatorId, input.orderId, decision, fingerprint, input.now] });
  await db.batch(statements);
  return { decision, applied: true };
}
