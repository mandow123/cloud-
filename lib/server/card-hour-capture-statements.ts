import type { CardHourSql } from "./card-hour-store-core.ts";
import type { CardHourStore } from "./card-hour-store.ts";

/** Shared ledger posting statements; the caller owns the transaction boundary. */
export function cardHourCaptureStatements(input: Parameters<CardHourStore["captureOrder"]>[0]) {
  const organizationId = input.account.activeOrganization.id;
  const id = `chp_${crypto.randomUUID()}`;
  const batchId = `chb_${crypto.randomUUID()}`;
  const businessKey = `order:${input.sourceSystem}:${input.orderId}`;
  const rewardMicros = Math.floor(input.amountMicros * 3 / 100);
  const statements: CardHourSql[] = [
    { sql: "INSERT OR IGNORE INTO card_hour_wallets(organization_id,available_micros,held_micros,lifetime_topup_micros,lifetime_spent_micros,version,created_at,updated_at) VALUES(?,0,0,0,0,1,?,?)", values: [organizationId, input.now, input.now] },
    { sql: `INSERT INTO card_hour_order_payments(id,organization_id,account_id,source_system,order_id,amount_micros,cny_reference_cents,rate_numerator,rate_denominator,status,idempotency_key,payload_hash,created_at,updated_at)
      SELECT ?,?,?,?,?,?,?,501,500,'CAPTURED',?,?,?,? FROM card_hour_wallets WHERE organization_id=? AND available_micros>=?`, values: [id, organizationId, input.account.account.id, input.sourceSystem, input.orderId, input.amountMicros, input.cnyReferenceCents, input.idempotencyKey, input.payloadHash, input.now, input.now, organizationId, input.amountMicros] },
    { sql: "UPDATE card_hour_wallets SET available_micros=available_micros-?,lifetime_spent_micros=lifetime_spent_micros+?,version=version+1,updated_at=? WHERE organization_id=? AND EXISTS (SELECT 1 FROM card_hour_order_payments WHERE id=?) AND NOT EXISTS (SELECT 1 FROM card_hour_ledger_batches WHERE business_key=?)", values: [input.amountMicros, input.amountMicros, input.now, organizationId, id, businessKey] },
    { sql: "INSERT INTO card_hour_ledger_batches(id,organization_id,operation,business_key,amount_micros,status,metadata_json,created_at) SELECT ?,?,'ORDER_CAPTURE',?,?,'POSTED',?,? WHERE EXISTS (SELECT 1 FROM card_hour_order_payments WHERE id=?)", values: [batchId, organizationId, businessKey, input.amountMicros, JSON.stringify({ sourceSystem: input.sourceSystem, orderId: input.orderId, cnyReferenceCents: input.cnyReferenceCents }), input.now, id] },
    { sql: "INSERT INTO card_hour_ledger_entries(id,batch_id,organization_id,account_code,side,amount_micros,balance_after_micros,created_at) SELECT ?,?,?, 'USER_AVAILABLE','DEBIT',?,available_micros,? FROM card_hour_wallets WHERE organization_id=? AND EXISTS (SELECT 1 FROM card_hour_ledger_batches WHERE id=?)", values: [`che_${crypto.randomUUID()}`, batchId, organizationId, input.amountMicros, input.now, organizationId, batchId] },
    { sql: "INSERT INTO card_hour_ledger_entries(id,batch_id,organization_id,account_code,side,amount_micros,balance_after_micros,created_at) SELECT ?,?,NULL,'PLATFORM_ORDER_CLEARING','CREDIT',?,NULL,? WHERE EXISTS (SELECT 1 FROM card_hour_ledger_batches WHERE id=?)", values: [`che_${crypto.randomUUID()}`, batchId, input.amountMicros, input.now, batchId] },
    { sql: `INSERT OR IGNORE INTO card_hour_income_accruals(id,organization_id,income_type,source_system,source_id,amount_micros,status,created_at,vested_at)
      SELECT ?,a.referrer_organization_id,'COMMISSION',?,?,?,'PENDING',?,NULL
      FROM card_hour_referral_attributions a WHERE a.invitee_organization_id=? AND ?>0 AND EXISTS (SELECT 1 FROM card_hour_order_payments WHERE id=?)`, values: [`chi_${crypto.randomUUID()}`, input.sourceSystem, input.orderId, rewardMicros, input.now, organizationId, rewardMicros, id] },
  ];
  return { id, statements };
}
