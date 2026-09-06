import { cnyCentsToCardHourMicros } from "../card-hours.ts";
import { AccountAuthError, accountAuthDigest, type AccountSessionContext } from "./account-auth.ts";
import { ExchangeDomainError } from "./exchange-errors.ts";
import type { CardHourDatabaseAdapter, CardHourSql } from "./card-hour-store-core.ts";
import { cardHourCaptureStatements } from "./card-hour-capture-statements.ts";
import type { SupplyTrialPayment } from "./supply-domain.ts";

export type SupplyCardHourInput = { account: AccountSessionContext; actorId: string; orderId: string; idempotencyKey: string; now: string };
export type SupplyCardHourResult = { record: SupplyTrialPayment; amountMicros: number; cnyReferenceCents: number; replayed: boolean };
export type PaymentRow = Record<string, unknown>;
export const paymentInvariant = (predicate: string, values: readonly unknown[] = []): CardHourSql => ({ sql: `SELECT CASE WHEN ${predicate} THEN 1 ELSE abs(-9223372036854775808) END`, values });
const conflict = () => new AccountAuthError("IDEMPOTENCY_CONFLICT", 409, "订单、金额或提交标识与已有支付事实不一致。 ");
const review = () => new ExchangeDomainError("EXCHANGE_PAYMENT_REVIEW_REQUIRED", 409, "已有支付事实需要核对，不能再次扣款。 ");
const hash = (value: unknown) => accountAuthDigest(JSON.stringify(value));

export function supplyPaymentRecord(row: PaymentRow): SupplyTrialPayment {
  return { orderId: String(row.order_id), status: row.status as SupplyTrialPayment["status"], provider: String(row.provider), providerOrderRef: String(row.provider_order_ref), providerTransactionRef: row.provider_transaction_ref == null ? null : String(row.provider_transaction_ref), version: Number(row.version), createdAt: String(row.created_at), updatedAt: String(row.updated_at) };
}

export async function readSupplyPaymentFacts(db: CardHourDatabaseAdapter, orderId: string) {
  const [order, payment, debit, delivery, allocation, batches, entries, events, rewards, ownership, checks, rewardBatches, attribution, payerMembership, refundEntries] = await Promise.all([
    db.first<PaymentRow>("SELECT * FROM supply_trial_orders WHERE id=?", [orderId]),
    db.first<PaymentRow>("SELECT * FROM supply_trial_payments WHERE order_id=?", [orderId]),
    db.first<PaymentRow>("SELECT * FROM card_hour_order_payments WHERE source_system='SUPPLY_PILOT' AND order_id=?", [orderId]),
    db.first<PaymentRow>("SELECT * FROM supply_trial_deliveries WHERE order_id=?", [orderId]),
    db.first<PaymentRow>("SELECT * FROM supply_allocation_bindings WHERE trial_order_id=?", [orderId]),
    db.all<PaymentRow>("SELECT * FROM card_hour_ledger_batches WHERE business_key IN (?,?)", [`order:SUPPLY_PILOT:${orderId}`, `order-refund:SUPPLY_PILOT:${orderId}`]),
    db.all<PaymentRow>("SELECT e.* FROM card_hour_ledger_entries e JOIN card_hour_ledger_batches b ON b.id=e.batch_id WHERE b.business_key=?", [`order:SUPPLY_PILOT:${orderId}`]),
    db.all<PaymentRow>("SELECT * FROM supply_trial_payment_events WHERE order_id=?", [orderId]),
    db.all<PaymentRow>("SELECT * FROM card_hour_income_accruals WHERE source_system='SUPPLY_PILOT' AND source_id=?", [orderId]),
    db.first<PaymentRow>("SELECT * FROM admin_entity_ownership WHERE source_system='SUPPLY_PILOT' AND entity_type='ORDER' AND entity_id=?", [orderId]),
    db.all<PaymentRow>("SELECT * FROM supply_trial_connection_checks WHERE order_id=?", [orderId]),
    db.all<PaymentRow>("SELECT * FROM card_hour_ledger_batches WHERE operation IN ('COMMISSION_INCOME','COMMISSION_REVERSAL') AND (instr(business_key,?)>0 OR (json_valid(metadata_json) AND (json_extract(metadata_json,'$.orderId')=? OR json_extract(metadata_json,'$.sourceId')=?)))", [orderId,orderId,orderId]),
    db.first<PaymentRow>("SELECT a.* FROM card_hour_referral_attributions a JOIN supply_trial_orders o ON o.buyer_actor_id=a.invitee_organization_id WHERE o.id=?", [orderId]),
    db.first<PaymentRow>("SELECT m.* FROM admin_memberships m JOIN card_hour_order_payments p ON p.account_id=m.account_id AND p.organization_id=m.organization_id WHERE p.source_system='SUPPLY_PILOT' AND p.order_id=?", [orderId]),
    db.all<PaymentRow>("SELECT e.* FROM card_hour_ledger_entries e JOIN card_hour_ledger_batches b ON b.id=e.batch_id WHERE b.business_key=?", [`order-refund:SUPPLY_PILOT:${orderId}`]),
  ]);
  return { order, payment, debit, delivery, allocation, batches, entries, events, rewards, ownership, checks, payerMembership, rewardBatches, attribution, refundEntries };
}
export type SupplyPaymentFacts = Awaited<ReturnType<typeof readSupplyPaymentFacts>>;

/** Proof of an existing debit must include both balanced, immutable ledger entries. */
export function supplyDebitProven(facts: SupplyPaymentFacts) {
  const { order, debit, entries, ownership } = facts;
  if (!order || !debit || debit.source_system !== "SUPPLY_PILOT" || debit.order_id !== order.id || debit.organization_id !== order.buyer_actor_id
    || Number(debit.cny_reference_cents) !== Number(order.amount_cents) || Number(debit.amount_micros) !== cnyCentsToCardHourMicros(Number(order.amount_cents))
    || !ownership || ownership.organization_id !== debit.organization_id || !facts.payerMembership) return false;
  const batch = facts.batches.find((row) => row.business_key === `order:SUPPLY_PILOT:${order.id}`);
  if (!batch || batch.operation !== "ORDER_CAPTURE" || batch.status !== "POSTED" || batch.organization_id !== debit.organization_id || Number(batch.amount_micros) !== Number(debit.amount_micros) || entries.length !== 2) return false;
  return entries.some((row) => row.batch_id === batch.id && row.organization_id === debit.organization_id && row.account_code === "USER_AVAILABLE" && row.side === "DEBIT" && Number(row.amount_micros) === Number(debit.amount_micros))
    && entries.some((row) => row.batch_id === batch.id && row.organization_id == null && row.account_code === "PLATFORM_ORDER_CLEARING" && row.side === "CREDIT" && Number(row.amount_micros) === Number(debit.amount_micros));
}

export function supplyReservationCoherent(facts: SupplyPaymentFacts) {
  const { order, allocation, delivery } = facts;
  return !!order && !!allocation && !!delivery && delivery.order_id === order.id
    && allocation.id === order.allocation_binding_id && allocation.trial_order_id === order.id
    && allocation.buyer_actor_id === order.buyer_actor_id && allocation.member_id === order.member_id
    && allocation.promotion_id === order.promotion_id && allocation.start_at === order.start_at
    && allocation.end_at === order.end_at && Number(allocation.node_hours) === Number(order.duration_hours);
}

export function supplyCaptureComplete(facts: SupplyPaymentFacts) {
  const { order, payment, debit, events, allocation, delivery } = facts;
  if (!supplyReservationCoherent(facts) || !supplyDebitProven(facts) || !order || !payment || !debit || debit.status !== "CAPTURED" || payment.status !== "CAPTURED" || payment.provider !== "KAI_CARD_HOUR"
    || payment.provider_order_ref !== order.id || payment.provider_transaction_ref !== `KCH_${order.id}` || !allocation || !delivery) return false;
  const captured = events.filter((row) => row.operation === "CAPTURE" && row.outcome === "APPLIED");
  return captured.length === 1 && captured[0].provider === "KAI_CARD_HOUR" && Number(captured[0].amount_cents) === Number(order.amount_cents)
    && captured[0].provider_transaction_ref === payment.provider_transaction_ref && !events.some((row) => row.operation === "REFUND")
    && ["PAID", "PROVISIONING", "DELIVERED", "IN_SERVICE", "COMPLETED", "FAILED"].includes(String(order.status))
    && ["LOCKED", "IN_SERVICE", "RELEASED"].includes(String(allocation.status)) && delivery.status !== "AWAITING_PAYMENT";
}

export function supplyCaptureStatements(facts: SupplyPaymentFacts, now: string, payloadDigest: string): CardHourSql[] {
  const order = facts.order!;
  const orderId = String(order.id);
  return [
    paymentInvariant("EXISTS(SELECT 1 FROM supply_trial_orders WHERE id=? AND version=? AND status='PAYMENT_PENDING' AND expires_at>?)", [orderId, order.version, now]),
    paymentInvariant(`EXISTS(SELECT 1 FROM supply_allocation_bindings a JOIN supply_trial_orders o ON o.id=a.trial_order_id
      WHERE o.id=? AND a.status='RESERVED' AND a.id=o.allocation_binding_id AND a.buyer_actor_id=o.buyer_actor_id
      AND a.member_id=o.member_id AND a.promotion_id=o.promotion_id AND a.start_at=o.start_at AND a.end_at=o.end_at AND a.node_hours=o.duration_hours)`, [orderId]),
    paymentInvariant("EXISTS(SELECT 1 FROM supply_trial_deliveries WHERE order_id=? AND status='AWAITING_PAYMENT' AND secure_endpoint_ref IS NULL AND buyer_public_key_fingerprint IS NULL AND host_key_fingerprint IS NULL AND credential_expires_at IS NULL AND cleanup_evidence_digest IS NULL)", [orderId]),
    { sql: "INSERT OR IGNORE INTO supply_trial_payments(order_id,status,provider,provider_order_ref,provider_transaction_ref,version,created_at,updated_at) VALUES(?,'PENDING','KAI_CARD_HOUR',?,NULL,1,?,?)", values: [orderId, orderId, now, now] },
    paymentInvariant("EXISTS(SELECT 1 FROM supply_trial_payments WHERE order_id=? AND provider='KAI_CARD_HOUR' AND provider_order_ref=? AND status='PENDING' AND provider_transaction_ref IS NULL)", [orderId, orderId]),
    { sql: "INSERT INTO supply_trial_payment_events(id,order_id,provider,provider_event_ref,provider_transaction_ref,event_type,operation,amount_cents,payload_digest,outcome,resulting_status,occurred_at,received_at) VALUES(?,?,'KAI_CARD_HOUR',?,?,'CAPTURED','CAPTURE',?,?,'APPLIED','CAPTURED',?,?)", values: [`KAI-SPE-${crypto.randomUUID()}`, orderId, `capture:${orderId}`, `KCH_${orderId}`, order.amount_cents, payloadDigest, now, now] },
    { sql: "UPDATE supply_trial_payments SET status='CAPTURED',provider_transaction_ref=?,version=version+1,updated_at=? WHERE order_id=?", values: [`KCH_${orderId}`, now, orderId] },
    { sql: "UPDATE supply_trial_orders SET status='PAID',version=version+1,updated_at=? WHERE id=?", values: [now, orderId] },
    { sql: "UPDATE supply_allocation_bindings SET status='LOCKED',updated_at=? WHERE trial_order_id=?", values: [now, orderId] },
    { sql: "UPDATE supply_trial_deliveries SET status='AWAITING_KEY',version=version+1,updated_at=? WHERE order_id=?", values: [now, orderId] },
  ];
}

/** One adapter batch is one database transaction, including the settlement receipt. */
export async function settleSupplyCardHours(db: CardHourDatabaseAdapter, input: SupplyCardHourInput, retry = true): Promise<SupplyCardHourResult> {
  const facts = await readSupplyPaymentFacts(db, input.orderId);
  const { order, payment, debit, ownership } = facts;
  const organizationId = input.account.activeOrganization.id;
  if (!order || order.buyer_actor_id !== input.actorId || input.actorId !== organizationId || !ownership || ownership.organization_id !== organizationId) {
    throw new ExchangeDomainError("EXCHANGE_NOT_FOUND", 404, "订单不存在。 ");
  }
  const amountMicros = cnyCentsToCardHourMicros(Number(order.amount_cents));
  const payloadHash = await hash({ orderId: input.orderId, assetCode: "KAI_CREDIT_HOUR", amountMicros });
  const ensureHash = await hash({ orderId: input.orderId, provider: "KAI_CARD_HOUR", amountMicros });
  const [byKey, receipt] = await Promise.all([
    db.first<PaymentRow>("SELECT * FROM card_hour_order_payments WHERE organization_id=? AND idempotency_key=?", [organizationId, input.idempotencyKey]),
    db.first<PaymentRow>("SELECT * FROM supply_command_receipts WHERE actor_id=? AND idempotency_key=?", [input.actorId, input.idempotencyKey]),
  ]);
  if (byKey && (byKey.order_id !== input.orderId || byKey.source_system !== "SUPPLY_PILOT" || byKey.payload_hash !== payloadHash || Number(byKey.amount_micros) !== amountMicros)) throw conflict();
  if (receipt && (receipt.payload_hash !== ensureHash || receipt.command_type !== "ENSURE_TRIAL_PAYMENT")) throw conflict();
  if (debit && (debit.organization_id !== organizationId || debit.payload_hash !== payloadHash || Number(debit.amount_micros) !== amountMicros)) throw conflict();
  const receiptStatement: CardHourSql = { sql: `INSERT OR IGNORE INTO supply_command_receipts(actor_id,idempotency_key,payload_hash,command_type,response_json,created_at)
    SELECT ?,?,?,'ENSURE_TRIAL_PAYMENT',json_object('orderId',order_id,'status',status,'provider',provider,'providerOrderRef',provider_order_ref,'providerTransactionRef',provider_transaction_ref,'version',version,'createdAt',created_at,'updatedAt',updated_at),? FROM supply_trial_payments WHERE order_id=?`, values: [input.actorId, input.idempotencyKey, ensureHash, input.now, input.orderId] };
  const receiptGuard = paymentInvariant("EXISTS(SELECT 1 FROM supply_command_receipts WHERE actor_id=? AND idempotency_key=? AND payload_hash=? AND command_type='ENSURE_TRIAL_PAYMENT')", [input.actorId, input.idempotencyKey, ensureHash]);
  if (debit) {
    if (!supplyCaptureComplete(facts)) throw review();
    await db.batch([receiptStatement, receiptGuard]);
    return { record: supplyPaymentRecord(payment!), amountMicros, cnyReferenceCents: Number(order.amount_cents), replayed: true };
  }
  if (!supplyReservationCoherent(facts)) throw review();
  if (facts.batches.length || facts.events.length || facts.rewards.length || (payment && (payment.status !== "PENDING" || payment.provider !== "KAI_CARD_HOUR" || payment.provider_order_ref !== input.orderId))) throw review();
  if (Date.parse(String(order.expires_at)) <= Date.parse(input.now)) throw new ExchangeDomainError("EXCHANGE_STATE_CONFLICT", 410, "容量锁和支付时限已经过期。 ");
  if (order.status !== "PAYMENT_PENDING") throw new ExchangeDomainError("EXCHANGE_STATE_CONFLICT", 409, "订单当前不能创建支付。 ");
  const wallet = await db.first<PaymentRow>("SELECT available_micros FROM card_hour_wallets WHERE organization_id=?", [organizationId]);
  if (!wallet || Number(wallet.available_micros) < amountMicros) throw new AccountAuthError("CARD_HOUR_BALANCE_INSUFFICIENT", 409, "卡时余额不足，请先购买卡时。 ");
  const capture = cardHourCaptureStatements({ account: input.account, sourceSystem: "SUPPLY_PILOT", orderId: input.orderId, amountMicros, cnyReferenceCents: Number(order.amount_cents), idempotencyKey: input.idempotencyKey, payloadHash, now: input.now });
  try {
    await db.batch([
      paymentInvariant("EXISTS(SELECT 1 FROM admin_entity_ownership WHERE source_system='SUPPLY_PILOT' AND entity_type='ORDER' AND entity_id=? AND organization_id=?)", [input.orderId, organizationId]),
      paymentInvariant("EXISTS(SELECT 1 FROM admin_memberships m JOIN admin_user_accounts a ON a.id=m.account_id JOIN admin_organizations o ON o.id=m.organization_id WHERE m.account_id=? AND m.organization_id=? AND m.status='ACTIVE' AND a.status='ACTIVE' AND o.status='ACTIVE')", [input.account.account.id, organizationId]),
      ...capture.statements,
      paymentInvariant("EXISTS(SELECT 1 FROM card_hour_order_payments WHERE id=?)", [capture.id]),
      ...supplyCaptureStatements(facts, input.now, payloadHash), receiptStatement, receiptGuard,
    ]);
  } catch (error) {
    // A competing committed request may have won. A real SQL fault is preserved.
    const [winner, keyWinner, receiptWinner] = await Promise.all([
      db.first<PaymentRow>("SELECT id FROM card_hour_order_payments WHERE source_system='SUPPLY_PILOT' AND order_id=?", [input.orderId]),
      db.first<PaymentRow>("SELECT * FROM card_hour_order_payments WHERE organization_id=? AND idempotency_key=?", [organizationId, input.idempotencyKey]),
      db.first<PaymentRow>("SELECT * FROM supply_command_receipts WHERE actor_id=? AND idempotency_key=?", [input.actorId, input.idempotencyKey]),
    ]);
    if (keyWinner && (keyWinner.order_id !== input.orderId || keyWinner.source_system !== "SUPPLY_PILOT" || keyWinner.payload_hash !== payloadHash || Number(keyWinner.amount_micros) !== amountMicros)) throw conflict();
    if (receiptWinner && (receiptWinner.payload_hash !== ensureHash || receiptWinner.command_type !== "ENSURE_TRIAL_PAYMENT")) throw conflict();
    if (retry && winner) return settleSupplyCardHours(db, input, false);
    if (error instanceof Error && error.message.includes("integer overflow")) {
      const [latestWallet, latestMember, latestOrder] = await Promise.all([
        db.first<PaymentRow>("SELECT available_micros FROM card_hour_wallets WHERE organization_id=?", [organizationId]),
        db.first<PaymentRow>("SELECT m.status,a.status AS account_status,o.status AS organization_status FROM admin_memberships m JOIN admin_user_accounts a ON a.id=m.account_id JOIN admin_organizations o ON o.id=m.organization_id WHERE m.account_id=? AND m.organization_id=?", [input.account.account.id, organizationId]),
        db.first<PaymentRow>("SELECT status,expires_at FROM supply_trial_orders WHERE id=?", [input.orderId]),
      ]);
      if (!latestMember || latestMember.status !== "ACTIVE" || latestMember.account_status !== "ACTIVE" || latestMember.organization_status !== "ACTIVE") throw new AccountAuthError("TRADING_SUBJECT_INACTIVE", 403, "当前交易主体已停用，不能支付。 ");
      if (!latestWallet || Number(latestWallet.available_micros) < amountMicros) throw new AccountAuthError("CARD_HOUR_BALANCE_INSUFFICIENT", 409, "卡时余额已变化，无法支付。 ");
      if (!latestOrder || latestOrder.status !== "PAYMENT_PENDING") throw new ExchangeDomainError("EXCHANGE_STATE_CONFLICT", 409, "订单状态已变化，请重新读取订单。 ");
    }
    throw error;
  }
  const captured = await db.first<PaymentRow>("SELECT * FROM supply_trial_payments WHERE order_id=?", [input.orderId]);
  if (!captured) throw new Error("SUPPLY_CARD_HOUR_CAPTURE_INVARIANT");
  return { record: supplyPaymentRecord(captured), amountMicros, cnyReferenceCents: Number(order.amount_cents), replayed: false };
}
