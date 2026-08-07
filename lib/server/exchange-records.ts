import {
  createExchangeId,
  deriveCapacityAmountCents,
  deriveCommissionEstimateCents,
  gpuHoursFromSeconds,
  type CapacityLot,
  type CreateCapacityLot,
  type CreateListingVersion,
  type CreateResourceAsset,
  type CreateVerificationRun,
  type CreateCheckout,
  type ExchangeOrder,
  type PaymentIntent,
  type DeliveryTask,
  type DeliveryPackage,
  type DeliveryReview,
  type DeliveryClaim,
  type ConnectionCheck,
  type MeteringSession,
  type OrderAcceptance,
  type TestSettlement,
  type ListingVersion,
  type ProductVersion,
  type ProductCapacityPolicy,
  type OrderContractSnapshot,
  type MeterInterval,
  type MeterEvidence,
  type ResourceAsset,
  type Reservation,
  type VerificationRun,
  type EnabledCapacityDescriptor,
  type CapacityWithdrawal,
  type SwapQuote,
  type SwapQuoteLegSnapshot,
  type ReferralCode,
  type ReferralDecision,
  type ReferralAttribution,
  type CommissionAccrual,
} from "../exchange.ts";
import { ExchangeDomainError } from "./exchange-errors.ts";

export type ProductRow = {
  id: string;
  product_code: ProductVersion["productCode"];
  pricing_unit_code: ProductVersion["pricingUnitCode"];
  display_name: string;
  manufacturer: string;
  model: string;
  form_factor: string;
  specs_json: string;
  immutable_hash: string;
  created_at: string;
};

export type ProductCapacityPolicyRow = {
  id: string;
  product_version_id: string | null;
  policy_key: string;
  product_code: ProductCapacityPolicy["productCode"];
  rate_unit_code: ProductCapacityPolicy["rateUnitCode"];
  fulfillment_model: ProductCapacityPolicy["fulfillmentModel"];
  pricing_unit_code: ProductCapacityPolicy["pricingUnitCode"];
  rate_unit_scale_numerator: number;
  rate_unit_scale_denominator: number;
  rate_unit_reference_code: ProductCapacityPolicy["rateUnitReferenceCode"];
  price_basis_base_units: number;
  feature_status: ProductCapacityPolicy["featureStatus"];
  identity_spec_json: string;
  immutable_hash: string;
  created_at: string;
};

export type OrderContractSnapshotRow = {
  id: string;
  order_id: string;
  listing_version_id: string;
  product_version_id: string;
  capacity_policy_id: string;
  product_code: OrderContractSnapshot["productCode"];
  rate_unit_code: OrderContractSnapshot["rateUnitCode"];
  fulfillment_model: OrderContractSnapshot["fulfillmentModel"];
  pricing_unit_code: OrderContractSnapshot["pricingUnitCode"];
  rate_units: number;
  duration_seconds: number;
  capacity_base_units: number;
  unit_price_micros: number;
  price_basis_base_units: number;
  gross_amount_cents: number;
  currency: "CNY";
  product_identity_json: string;
  sla_json: string;
  evidence_policy_version: string;
  snapshot_digest: string;
  created_at: string;
};

export type MeterIntervalRow = {
  id: string;
  metering_session_id: string;
  order_id: string;
  capacity_policy_id: string;
  sequence_number: number;
  interval_start_at: string;
  interval_end_at: string;
  duration_seconds: number;
  reserved_rate_units: number;
  proven_rate_units: number;
  scheduled_capacity_base_units: number;
  available_capacity_base_units: number;
  unavailable_capacity_base_units: number;
  unproven_capacity_base_units: number;
  evidence_status: MeterInterval["evidenceStatus"];
  adapter: MeterInterval["adapter"];
  evidence_digest: string;
  created_at: string;
};

export type MeterEvidenceRow = {
  id: string;
  meter_interval_id: string;
  evidence_type: MeterEvidence["evidenceType"];
  source: MeterEvidence["source"];
  model_identity_digest: string | null;
  payload_digest: string;
  observed_at: string;
  created_at: string;
};

export type ResourceRow = {
  id: string;
  supplier_actor_id: string;
  payload_hash: string;
  product_version_id: string;
  title: string;
  region: string;
  delivery_form: string;
  total_parallel_units: number;
  product_code?: EnabledCapacityDescriptor["productCode"];
  rate_unit_code?: EnabledCapacityDescriptor["rateUnitCode"];
  fulfillment_model?: EnabledCapacityDescriptor["fulfillmentModel"];
  policy_pricing_unit_code?: EnabledCapacityDescriptor["pricingUnitCode"];
  price_basis_base_units?: number;
  interruptibility: ResourceAsset["interruptibility"];
  network_scope: string;
  status: ResourceAsset["status"];
  version: number;
  created_at: string;
  updated_at: string;
};

export type VerificationRow = {
  id: string;
  resource_asset_id: string;
  operator_actor_id: string;
  payload_hash: string;
  method: VerificationRun["method"];
  result: VerificationRun["result"];
  evidence_summary: string;
  evidence_digest: string;
  valid_until: string | null;
  created_at: string;
};

export type CapacityLotRow = {
  id: string;
  supplier_actor_id: string;
  payload_hash: string;
  resource_asset_id: string;
  verification_run_id: string;
  start_at: string;
  end_at: string;
  rate_unit_code: EnabledCapacityDescriptor["rateUnitCode"];
  rate_units: number;
  capacity_base_units: number;
  parallel_units: number | null;
  capacity_gpu_seconds: number | null;
  accounting_schema_version: 1 | 2 | 3 | 4;
  product_code?: EnabledCapacityDescriptor["productCode"];
  fulfillment_model?: EnabledCapacityDescriptor["fulfillmentModel"];
  policy_pricing_unit_code?: EnabledCapacityDescriptor["pricingUnitCode"];
  price_basis_base_units?: number;
  interruptibility: CapacityLot["interruptibility"];
  status: CapacityLot["status"];
  version: number;
  created_at: string;
  updated_at: string;
};

export type ListingRow = {
  id: string;
  listing_id: string;
  version_number: number;
  supplier_actor_id: string;
  payload_hash: string;
  capacity_lot_id: string;
  rate_unit_code: EnabledCapacityDescriptor["rateUnitCode"];
  unit_price_micros: number;
  unit_price_cents: number | null;
  currency: "CNY";
  pricing_unit_code: EnabledCapacityDescriptor["pricingUnitCode"];
  min_rate_units: number;
  max_rate_units: number;
  min_parallel_units: number | null;
  max_parallel_units: number | null;
  product_code?: EnabledCapacityDescriptor["productCode"];
  fulfillment_model?: EnabledCapacityDescriptor["fulfillmentModel"];
  policy_pricing_unit_code?: EnabledCapacityDescriptor["pricingUnitCode"];
  price_basis_base_units?: number;
  min_duration_minutes: number;
  tax_included: number;
  energy_included: number;
  network_included: number;
  scope_note: string;
  sla_json: string;
  delivery_form: string;
  valid_from: string;
  valid_until: string;
  status: ListingVersion["status"];
  created_at: string;
};

export type OrderRow = {
  id: string;
  buyer_actor_id: string;
  supplier_actor_id: string;
  payload_hash: string;
  listing_version_id: string;
  rate_unit_code: EnabledCapacityDescriptor["rateUnitCode"];
  rate_units: number;
  parallel_units: number | null;
  start_at: string;
  end_at: string;
  capacity_base_units: number;
  capacity_gpu_seconds: number | null;
  unit_price_micros: number;
  unit_price_cents: number | null;
  total_amount_cents: number;
  currency: "CNY";
  status: ExchangeOrder["status"];
  accounting_schema_version: 1 | 2 | 3 | 4;
  snapshot_id?: string | null;
  snapshot_product_code?: EnabledCapacityDescriptor["productCode"] | null;
  snapshot_rate_unit_code?: EnabledCapacityDescriptor["rateUnitCode"] | null;
  snapshot_fulfillment_model?: EnabledCapacityDescriptor["fulfillmentModel"] | null;
  snapshot_pricing_unit_code?: EnabledCapacityDescriptor["pricingUnitCode"] | null;
  snapshot_price_basis_base_units?: number | null;
  hold_expires_at: string;
  version: number;
  created_at: string;
  updated_at: string;
};

export type CapacityWithdrawalRow = {
  id: string;
  capacity_lot_id: string;
  supplier_actor_id: string;
  idempotency_key: string;
  payload_hash: string;
  expected_lot_version: number;
  transfer_id: string;
  rate_unit_code: CapacityWithdrawal["rateUnitCode"];
  capacity_base_units: number;
  capacity_gpu_seconds: number | null;
  accounting_schema_version: number;
  reason: string;
  occurred_at: string;
};

export type SwapQuoteRow = {
  id: string;
  initiator_actor_id: string;
  counterparty_actor_id: string;
  idempotency_key: string;
  payload_hash: string;
  offered_value_cents: number;
  wanted_value_cents: number;
  cash_adjustment_signed_cents: number;
  cash_adjustment_amount_cents: number;
  cash_adjustment_payer_actor_id: string | null;
  cash_adjustment_payee_actor_id: string | null;
  generated_at: string;
  expires_at: string;
  quote_digest: string;
};

export type SwapQuoteSnapshotRow = {
  id: string;
  quote_id: string;
  leg_role: SwapQuoteLegSnapshot["legRole"];
  source_listing_version_id: string;
  listing_created_at: string;
  listing_valid_from: string;
  product_version_id: string;
  capacity_policy_id: string;
  product_code: SwapQuoteLegSnapshot["productCode"];
  rate_unit_code: SwapQuoteLegSnapshot["rateUnitCode"];
  fulfillment_model: SwapQuoteLegSnapshot["fulfillmentModel"];
  pricing_unit_code: SwapQuoteLegSnapshot["pricingUnitCode"];
  rate_units: number;
  start_at: string;
  end_at: string;
  duration_seconds: number;
  capacity_base_units: number;
  unit_price_micros: number;
  price_basis_base_units: number;
  value_cents: number;
  currency: "CNY";
  generated_at: string;
  expires_at: string;
  snapshot_digest: string;
};

export type SwapQuoteStatusEventRow = {
  id: string;
  quote_id: string;
  actor_id: string;
  idempotency_key: string;
  payload_hash: string;
  status: SwapQuote["status"];
  version: number;
  reason: string;
  occurred_at: string;
};

export type ReferralCodeRow = {
  id: string;
  agent_actor_id: string;
  idempotency_key: string;
  payload_hash: string;
  code: string;
  created_at: string;
};

export type ReferralDecisionRow = {
  id: string;
  order_id: string;
  outcome: ReferralDecision["outcome"];
  resolved_code_id: string | null;
  submitted_code_digest: string | null;
  decided_at: string;
};

export type ReferralAttributionRow = {
  id: string;
  order_id: string;
  decision_id: string;
  referral_code_id: string;
  agent_actor_id: string;
  buyer_actor_id: string;
  supplier_actor_id: string;
  attributed_at: string;
};

export type CommissionAccrualRow = {
  id: string;
  order_id: string;
  settlement_id: string;
  attribution_id: string;
  agent_actor_id: string;
  environment: "TEST";
  record_kind: "ESTIMATE_ONLY";
  commission_base_cents: number;
  commission_rate_basis_points: 300;
  commission_estimate_cents: number;
  funds_moved: 0;
  created_at: string;
};

export function assertReferralFacts(
  order: Pick<OrderRow, "id" | "buyer_actor_id" | "supplier_actor_id">,
  decision: ReferralDecisionRow | null | undefined,
  attribution: ReferralAttributionRow | null | undefined,
  code: ReferralCodeRow | null | undefined,
) {
  if (!decision || decision.order_id !== order.id) {
    throw new Error("EXCHANGE_INVARIANT_CORRUPTION:REFERRAL_DECISION_MISSING");
  }
  const hasCode = Boolean(code);
  const resolvedCodeMatches = decision.resolved_code_id !== null
    && code?.id === decision.resolved_code_id;
  const valid = decision.outcome === "NONE"
    ? decision.resolved_code_id === null && decision.submitted_code_digest === null && !hasCode && !attribution
    : decision.outcome === "INVALID"
      ? decision.resolved_code_id === null && decision.submitted_code_digest !== null && !hasCode && !attribution
      : decision.outcome === "SELF_BUYER"
        ? resolvedCodeMatches && code!.agent_actor_id === order.buyer_actor_id && !attribution
        : decision.outcome === "SELF_SUPPLIER"
          ? resolvedCodeMatches && code!.agent_actor_id === order.supplier_actor_id && !attribution
          : decision.outcome === "APPLIED"
            ? resolvedCodeMatches && Boolean(attribution)
              && attribution!.order_id === order.id && attribution!.decision_id === decision.id
              && attribution!.referral_code_id === code!.id
              && attribution!.agent_actor_id === code!.agent_actor_id
              && attribution!.buyer_actor_id === order.buyer_actor_id
              && attribution!.supplier_actor_id === order.supplier_actor_id
              && code!.agent_actor_id !== order.buyer_actor_id
              && code!.agent_actor_id !== order.supplier_actor_id
            : false;
  if (!valid) throw new Error("EXCHANGE_INVARIANT_CORRUPTION:REFERRAL_FACTS_INVALID");
}

export function assertSettlementCommissionFacts(
  order: Pick<OrderRow, "id">,
  snapshot: OrderContractSnapshotRow | null | undefined,
  settlement: SettlementRow | null | undefined,
  attribution: ReferralAttributionRow | null | undefined,
  commission: CommissionAccrualRow | null | undefined,
) {
  if (!settlement) {
    if (commission) throw new Error("EXCHANGE_INVARIANT_CORRUPTION:COMMISSION_WITHOUT_SETTLEMENT");
    return;
  }
  if (!snapshot || snapshot.order_id !== order.id || settlement.order_id !== order.id
    || settlement.gross_amount_cents !== snapshot.gross_amount_cents) {
    throw new Error("EXCHANGE_INVARIANT_CORRUPTION:SETTLEMENT_SNAPSHOT_FACTS_INVALID");
  }
  const commissionRequired = settlement.status === "TEST_RECORDED" && Boolean(attribution);
  if (commissionRequired !== Boolean(commission)) {
    throw new Error("EXCHANGE_INVARIANT_CORRUPTION:COMMISSION_CARDINALITY_INVALID");
  }
  if (commission && (!attribution
    || commission.order_id !== order.id || commission.settlement_id !== settlement.id
    || commission.attribution_id !== attribution.id || commission.agent_actor_id !== attribution.agent_actor_id)) {
    throw new Error("EXCHANGE_INVARIANT_CORRUPTION:COMMISSION_ASSOCIATION_INVALID");
  }
  mapSettlement(settlement, commission);
}

export type OrderLifecycleRow = {
  order_id: string;
  phase: "AWAITING_SUPPLIER" | "AWAITING_PAYMENT" | "FULFILLING" | "AWAITING_ACCEPTANCE" | "COMPLETED" | "EXCEPTION";
  state_reason: string;
  version: number;
  updated_at: string;
};

export type PaymentIntentRow = {
  id: string;
  order_id: string;
  provider: string;
  environment: "TEST" | "LIVE";
  merchant_account_ref: string;
  amount_cents: number;
  currency: "CNY";
  status: PaymentIntent["status"];
  provider_payment_id: string | null;
  expires_at: string;
  version: number;
  created_at: string;
  updated_at: string;
};

export type DeliveryTaskRow = {
  id: string;
  order_id: string;
  payment_event_id: string;
  reservation_id: string;
  capacity_lot_id: string;
  listing_version_id: string;
  resource_asset_id: string;
  product_version_id: string;
  lock_transfer_id: string;
  parallel_units: number;
  start_at: string;
  end_at: string;
  delivery_form: string;
  method: DeliveryTask["method"];
  status: DeliveryTask["status"];
  attempt: number;
  evidence_policy_version: string;
  provisioning_due_at: string;
  version: number;
  created_at: string;
  updated_at: string;
};

export type DeliveryPackageRow = {
  id: string;
  delivery_task_id: string;
  order_id: string;
  supplier_actor_id: string;
  revision: number;
  environment: "TEST";
  status: DeliveryPackage["status"];
  public_profile_json: string;
  submission_evidence_digest: string;
  credential_expires_at: string;
  version: number;
  created_at: string;
  updated_at: string;
};

export type DeliveryReviewRow = {
  id: string;
  package_id: string;
  delivery_task_id: string;
  reviewer_actor_id: string;
  decision: DeliveryReview["decision"];
  verification_method: DeliveryReview["verificationMethod"];
  reason: string;
  evidence_digest: string;
  created_at: string;
};

export type DeliveryClaimRow = {
  id: string;
  package_id: string;
  order_id: string;
  buyer_actor_id: string;
  claim_code_digest: string;
  claimed_at: string;
};

export type ConnectionCheckRow = {
  id: string;
  package_id: string;
  delivery_task_id: string;
  order_id: string;
  buyer_actor_id: string;
  attempt: number;
  adapter: ConnectionCheck["adapter"];
  status: ConnectionCheck["status"];
  diagnostic_code: string;
  summary: string;
  evidence_digest: string;
  started_at: string;
  finished_at: string | null;
  created_at: string;
};

export type PaymentEventRow = {
  id: string;
  provider: string;
  environment: "TEST" | "LIVE";
  provider_event_id: string;
  provider_transaction_id: string;
  payment_intent_id: string;
  merchant_account_ref: string;
  event_type: "CAPTURED";
  amount_cents: number;
  currency: "CNY";
  funds_moved: number;
  verification_method: string;
  verified_at: string;
  raw_payload_digest: string;
  payload_hash: string;
  outcome: "APPLIED" | "IGNORED_DUPLICATE_TRANSACTION" | "LATE_CAPTURE_REVIEW" | "REVIEW_REQUIRED";
  occurred_at: string;
  received_at: string;
};

export type MeteringSessionRow = {
  id: string;
  order_id: string;
  payment_event_id: string;
  delivery_task_id: string;
  reservation_id: string;
  environment: "TEST";
  status: MeteringSession["status"];
  scheduled_start_at: string;
  scheduled_end_at: string;
  actual_start_at: string | null;
  finalized_at: string | null;
  rate_unit_code: EnabledCapacityDescriptor["rateUnitCode"];
  reserved_rate_units: number;
  scheduled_capacity_base_units: number;
  available_capacity_base_units: number;
  unavailable_capacity_base_units: number;
  unproven_capacity_base_units: number;
  scheduled_gpu_seconds: number | null;
  available_gpu_seconds: number | null;
  unavailable_gpu_seconds: number | null;
  unproven_gpu_seconds: number | null;
  availability_ppm: number | null;
  version: number;
  created_at: string;
  updated_at: string;
};

export type AcceptanceRow = {
  id: string;
  order_id: string;
  metering_final_id: string;
  buyer_actor_id: string;
  status: OrderAcceptance["status"];
  reason: string | null;
  evidence_digest: string | null;
  version: number;
  created_at: string;
  updated_at: string;
};

export type SettlementRow = {
  id: string;
  order_id: string;
  metering_final_id: string;
  acceptance_id: string;
  environment: "TEST";
  status: TestSettlement["status"];
  gross_amount_cents: number;
  base_credit_cents: number;
  dispute_credit_cents: number;
  net_supplier_payable_cents: number;
  funds_moved: 0;
  ledger_batch_id: string | null;
  version: number;
  created_at: string;
  updated_at: string;
};

export type SettlementLedgerBatchRow = {
  id: string;
  settlement_id: string;
  environment: "TEST";
  entry_count: number;
  debit_total_cents: number;
  credit_total_cents: number;
  funds_moved: 0;
  created_at: string;
};

export type SettlementLedgerEntryRow = {
  id: string;
  batch_id: string;
  settlement_id: string;
  account_code: "TEST_BUYER_SETTLEMENT_CLEARING" | "TEST_SUPPLIER_PAYABLE" | "TEST_BUYER_CREDIT";
  side: "DEBIT" | "CREDIT";
  amount_cents: number;
  created_at: string;
};

export function assertExactTestSettlementLedger(
  settlement: SettlementRow,
  batch: SettlementLedgerBatchRow | null | undefined,
  entries: ReadonlyArray<SettlementLedgerEntryRow>,
) {
  const buyerCreditCents = settlement.base_credit_cents + settlement.dispute_credit_cents;
  const expected = [
    { account_code: "TEST_BUYER_SETTLEMENT_CLEARING", side: "DEBIT", amount_cents: settlement.gross_amount_cents },
    ...(settlement.net_supplier_payable_cents > 0
      ? [{ account_code: "TEST_SUPPLIER_PAYABLE", side: "CREDIT", amount_cents: settlement.net_supplier_payable_cents }]
      : []),
    ...(buyerCreditCents > 0
      ? [{ account_code: "TEST_BUYER_CREDIT", side: "CREDIT", amount_cents: buyerCreditCents }]
      : []),
  ] as const;
  const debitTotal = entries.reduce((sum, entry) => sum + (entry.side === "DEBIT" ? entry.amount_cents : 0), 0);
  const creditTotal = entries.reduce((sum, entry) => sum + (entry.side === "CREDIT" ? entry.amount_cents : 0), 0);
  const exactEntries = entries.length === expected.length && expected.every((fact) => entries.filter((entry) =>
    entry.batch_id === batch?.id && entry.settlement_id === settlement.id
    && entry.account_code === fact.account_code && entry.side === fact.side
    && entry.amount_cents === fact.amount_cents).length === 1);
  if (!batch || settlement.status !== "TEST_RECORDED" || settlement.environment !== "TEST"
    || settlement.funds_moved !== 0 || settlement.ledger_batch_id !== batch.id
    || batch.settlement_id !== settlement.id || batch.environment !== "TEST" || batch.funds_moved !== 0
    || batch.entry_count !== entries.length || batch.entry_count !== expected.length
    || batch.debit_total_cents !== settlement.gross_amount_cents
    || batch.credit_total_cents !== settlement.gross_amount_cents
    || batch.debit_total_cents !== batch.credit_total_cents
    || debitTotal !== batch.debit_total_cents || creditTotal !== batch.credit_total_cents
    || !exactEntries) {
    throw new Error("EXCHANGE_INVARIANT_CORRUPTION:SETTLEMENT_LEDGER_PROJECTION_INVALID");
  }
}

export type ReservationRow = {
  id: string;
  order_id: string;
  capacity_lot_id: string;
  rate_unit_code: EnabledCapacityDescriptor["rateUnitCode"];
  rate_units: number;
  parallel_units: number | null;
  start_at: string;
  end_at: string;
  capacity_base_units: number;
  capacity_gpu_seconds: number | null;
  state: Reservation["state"];
  hold_expires_at: string;
  version: number;
  created_at: string;
  updated_at: string;
};

export function maximumConcurrentRateUnits(
  rows: ReadonlyArray<{ start_at: string; end_at: string; rate_units: number }>,
  startAt: string,
  endAt: string,
) {
  const overlapping = rows.filter((row) => row.start_at < endAt && row.end_at > startAt);
  const points = new Set([
    startAt,
    ...overlapping.map((row) => row.start_at).filter((point) => point >= startAt && point < endAt),
  ]);
  let maximum = 0;
  for (const point of points) {
    let active = 0;
    for (const row of overlapping) {
      if (row.start_at <= point && row.end_at > point) active += row.rate_units;
    }
    maximum = Math.max(maximum, active);
  }
  return maximum;
}

export const maximumConcurrentParallelUnits = maximumConcurrentRateUnits;

type CapacityDescriptorProjection = {
  productCode?: EnabledCapacityDescriptor["productCode"];
  rateUnitCode?: EnabledCapacityDescriptor["rateUnitCode"];
  fulfillmentModel?: EnabledCapacityDescriptor["fulfillmentModel"];
  pricingUnitCode?: EnabledCapacityDescriptor["pricingUnitCode"];
  priceBasisBaseUnits?: number;
};

export function capacityDescriptor(
  rateUnitCode: EnabledCapacityDescriptor["rateUnitCode"],
  policy?: CapacityDescriptorProjection,
): EnabledCapacityDescriptor {
  const descriptor: EnabledCapacityDescriptor = rateUnitCode === "GPU"
    ? {
      productCode: "GPU_COMPUTE", rateUnitCode: "GPU", fulfillmentModel: "GPU_ALLOCATION",
      pricingUnitCode: "GPU_HOUR", priceBasisBaseUnits: 3_600,
    }
    : rateUnitCode === "MODEL_INSTANCE"
      ? {
      productCode: "MODEL_INSTANCE", rateUnitCode: "MODEL_INSTANCE", fulfillmentModel: "MODEL_INSTANCE_ALLOCATION",
      pricingUnitCode: "MODEL_INSTANCE_HOUR", priceBasisBaseUnits: 3_600,
      }
      : rateUnitCode === "MILLI_M_TOKEN_PER_HOUR"
        ? {
        productCode: "TOKEN_THROUGHPUT", rateUnitCode: "MILLI_M_TOKEN_PER_HOUR",
        fulfillmentModel: "TOKEN_THROUGHPUT_RESERVATION", pricingUnitCode: "M_TOKEN_CAPACITY_HOUR",
        priceBasisBaseUnits: 3_600_000,
        }
        : rateUnitCode === "GIB_STORAGE"
          ? {
            productCode: "NAS_STORAGE", rateUnitCode: "GIB_STORAGE",
            fulfillmentModel: "NAS_VOLUME_ALLOCATION", pricingUnitCode: "TIB_HOUR",
            priceBasisBaseUnits: 3_686_400,
          }
          : {
            productCode: "RACK_SPACE", rateUnitCode: "RACK",
            fulfillmentModel: "RACK_COLOCATION_ALLOCATION", pricingUnitCode: "RACK_HOUR",
            priceBasisBaseUnits: 3_600,
          };
  if ((policy?.productCode !== undefined && policy.productCode !== descriptor.productCode)
    || (policy?.rateUnitCode !== undefined && policy.rateUnitCode !== descriptor.rateUnitCode)
    || (policy?.fulfillmentModel !== undefined && policy.fulfillmentModel !== descriptor.fulfillmentModel)
    || (policy?.pricingUnitCode !== undefined && policy.pricingUnitCode !== descriptor.pricingUnitCode)
    || (policy?.priceBasisBaseUnits !== undefined && policy.priceBasisBaseUnits !== descriptor.priceBasisBaseUnits)) {
    throw new Error("EXCHANGE_INVARIANT_CORRUPTION:CAPACITY_POLICY_MISMATCH");
  }
  return policy?.priceBasisBaseUnits === undefined ? descriptor : { ...descriptor, priceBasisBaseUnits: policy.priceBasisBaseUnits };
}

function descriptorFromProjectedPolicy(row: {
  rate_unit_code: EnabledCapacityDescriptor["rateUnitCode"];
  product_code?: EnabledCapacityDescriptor["productCode"];
  fulfillment_model?: EnabledCapacityDescriptor["fulfillmentModel"];
  policy_pricing_unit_code?: EnabledCapacityDescriptor["pricingUnitCode"];
  price_basis_base_units?: number;
}) {
  return capacityDescriptor(row.rate_unit_code, {
    productCode: row.product_code,
    rateUnitCode: row.rate_unit_code,
    fulfillmentModel: row.fulfillment_model,
    pricingUnitCode: row.policy_pricing_unit_code,
    priceBasisBaseUnits: row.price_basis_base_units,
  });
}

export function mapProduct(row: ProductRow): ProductVersion {
  return {
    id: row.id,
    productCode: row.product_code,
    pricingUnitCode: row.pricing_unit_code,
    displayName: row.display_name,
    manufacturer: row.manufacturer,
    model: row.model,
    formFactor: row.form_factor,
    specs: JSON.parse(row.specs_json) as ProductVersion["specs"],
    createdAt: row.created_at,
  };
}

export function mapProductCapacityPolicy(row: ProductCapacityPolicyRow): ProductCapacityPolicy {
  return {
    id: row.id,
    productVersionId: row.product_version_id,
    policyKey: row.policy_key,
    productCode: row.product_code,
    rateUnitCode: row.rate_unit_code,
    fulfillmentModel: row.fulfillment_model,
    pricingUnitCode: row.pricing_unit_code,
    rateUnitScaleNumerator: row.rate_unit_scale_numerator,
    rateUnitScaleDenominator: row.rate_unit_scale_denominator,
    rateUnitReferenceCode: row.rate_unit_reference_code,
    priceBasisBaseUnits: row.price_basis_base_units,
    featureStatus: row.feature_status,
    identitySpec: JSON.parse(row.identity_spec_json) as ProductCapacityPolicy["identitySpec"],
    immutableHash: row.immutable_hash,
    createdAt: row.created_at,
  };
}

export function mapOrderContractSnapshot(row: OrderContractSnapshotRow): OrderContractSnapshot {
  return {
    id: row.id,
    orderId: row.order_id,
    listingVersionId: row.listing_version_id,
    productVersionId: row.product_version_id,
    capacityPolicyId: row.capacity_policy_id,
    productCode: row.product_code,
    rateUnitCode: row.rate_unit_code,
    fulfillmentModel: row.fulfillment_model,
    pricingUnitCode: row.pricing_unit_code,
    rateUnits: row.rate_units,
    durationSeconds: row.duration_seconds,
    capacityBaseUnits: row.capacity_base_units,
    unitPriceMicros: row.unit_price_micros,
    priceBasisBaseUnits: row.price_basis_base_units,
    grossAmountCents: row.gross_amount_cents,
    currency: row.currency,
    productIdentity: JSON.parse(row.product_identity_json) as Record<string, unknown>,
    sla: JSON.parse(row.sla_json) as Record<string, unknown>,
    evidencePolicyVersion: row.evidence_policy_version,
    snapshotDigest: row.snapshot_digest,
    createdAt: row.created_at,
  };
}

export function mapMeterInterval(row: MeterIntervalRow): MeterInterval {
  return {
    id: row.id,
    meteringSessionId: row.metering_session_id,
    orderId: row.order_id,
    capacityPolicyId: row.capacity_policy_id,
    sequenceNumber: row.sequence_number,
    intervalStartAt: row.interval_start_at,
    intervalEndAt: row.interval_end_at,
    durationSeconds: row.duration_seconds,
    reservedRateUnits: row.reserved_rate_units,
    provenRateUnits: row.proven_rate_units,
    scheduledCapacityBaseUnits: row.scheduled_capacity_base_units,
    availableCapacityBaseUnits: row.available_capacity_base_units,
    unavailableCapacityBaseUnits: row.unavailable_capacity_base_units,
    unprovenCapacityBaseUnits: row.unproven_capacity_base_units,
    evidenceStatus: row.evidence_status,
    adapter: row.adapter,
    evidenceDigest: row.evidence_digest,
    createdAt: row.created_at,
  };
}

export function mapMeterEvidence(row: MeterEvidenceRow): MeterEvidence {
  const base = {
    id: row.id,
    meterIntervalId: row.meter_interval_id,
    source: row.source,
    payloadDigest: row.payload_digest,
    observedAt: row.observed_at,
    createdAt: row.created_at,
  };
  if (row.evidence_type === "MODEL_IDENTITY") {
    if (!row.model_identity_digest) throw new Error("EXCHANGE_INVARIANT_CORRUPTION:MODEL_IDENTITY_DIGEST_MISSING");
    return { ...base, evidenceType: "MODEL_IDENTITY", modelIdentityDigest: row.model_identity_digest };
  }
  if (row.evidence_type === "STORAGE_IDENTITY" || row.evidence_type === "FACILITY_IDENTITY") {
    if (!row.model_identity_digest) throw new Error("EXCHANGE_INVARIANT_CORRUPTION:CAPACITY_IDENTITY_DIGEST_MISSING");
    return { ...base, evidenceType: row.evidence_type, identityDigest: row.model_identity_digest };
  }
  return { ...base, evidenceType: row.evidence_type };
}

export function mapResource(row: ResourceRow): ResourceAsset {
  if (!row.rate_unit_code) throw new Error("EXCHANGE_INVARIANT_CORRUPTION:RESOURCE_POLICY_MISSING");
  const descriptor = descriptorFromProjectedPolicy(row as ResourceRow & { rate_unit_code: EnabledCapacityDescriptor["rateUnitCode"] });
  const base = {
    id: row.id,
    supplierActorId: row.supplier_actor_id,
    productVersionId: row.product_version_id,
    ...descriptor,
    title: row.title,
    region: row.region,
    deliveryForm: row.delivery_form,
    totalRateUnits: row.total_parallel_units,
    interruptibility: row.interruptibility,
    networkScope: row.network_scope,
    status: row.status,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  return (descriptor.rateUnitCode === "GPU" ? { ...base, totalParallelUnits: row.total_parallel_units } : base) as ResourceAsset;
}

export function mapVerification(row: VerificationRow): VerificationRun {
  return {
    id: row.id,
    resourceAssetId: row.resource_asset_id,
    operatorActorId: row.operator_actor_id,
    method: row.method,
    result: row.result,
    evidenceSummary: row.evidence_summary,
    evidenceDigest: row.evidence_digest,
    validUntil: row.valid_until,
    createdAt: row.created_at,
  };
}

export function mapCapacityLot(row: CapacityLotRow): CapacityLot {
  const descriptor = descriptorFromProjectedPolicy(row);
  const durationSeconds = (Date.parse(row.end_at) - Date.parse(row.start_at)) / 1_000;
  const base = {
    id: row.id,
    supplierActorId: row.supplier_actor_id,
    resourceAssetId: row.resource_asset_id,
    verificationRunId: row.verification_run_id,
    ...descriptor,
    startAt: row.start_at,
    endAt: row.end_at,
    rateUnits: row.rate_units,
    durationSeconds,
    capacityBaseUnits: row.capacity_base_units,
    interruptibility: row.interruptibility,
    status: Date.parse(row.end_at) <= Date.now() && row.status === "READY" ? "EXPIRED" : row.status,
    allowedActions: row.status === "READY" ? ["CREATE_LISTING"] as const : [],
    withdrawalEligibility: {
      eligible: false,
      reasonCode: row.status === "WITHDRAWN" ? "ALREADY_WITHDRAWN" : "LOT_NOT_READY",
    } as const,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  return (descriptor.rateUnitCode === "GPU"
    ? {
      ...base,
      parallelUnits: row.parallel_units as number,
      capacityGpuSeconds: row.capacity_gpu_seconds as number,
      capacityGpuHours: gpuHoursFromSeconds(row.capacity_gpu_seconds as number),
    }
    : base) as CapacityLot;
}

export function mapListing(row: ListingRow): ListingVersion {
  const descriptor = descriptorFromProjectedPolicy(row);
  const base = {
    id: row.id,
    listingId: row.listing_id,
    versionNumber: row.version_number,
    supplierActorId: row.supplier_actor_id,
    capacityLotId: row.capacity_lot_id,
    ...descriptor,
    unitPriceMicros: row.unit_price_micros,
    currency: row.currency,
    pricingUnitCode: row.pricing_unit_code,
    minRateUnits: row.min_rate_units,
    maxRateUnits: row.max_rate_units,
    minDurationMinutes: row.min_duration_minutes,
    taxIncluded: row.tax_included === 1,
    energyIncluded: row.energy_included === 1,
    networkIncluded: row.network_included === 1,
    scopeNote: row.scope_note,
    sla: JSON.parse(row.sla_json) as ListingVersion["sla"],
    deliveryForm: row.delivery_form,
    validFrom: row.valid_from,
    validUntil: row.valid_until,
    status: Date.parse(row.valid_until) <= Date.now() && row.status === "ACTIVE" ? "EXPIRED" : row.status,
    createdAt: row.created_at,
  };
  return (descriptor.rateUnitCode === "GPU"
    ? {
      ...base,
      productCode: "GPU_COMPUTE",
      rateUnitCode: "GPU",
      pricingUnitCode: "GPU_HOUR",
      unitPriceCents: row.unit_price_cents as number,
      minParallelUnits: row.min_parallel_units as number,
      maxParallelUnits: row.max_parallel_units as number,
    }
    : base) as ListingVersion;
}

export function mapReservation(row: ReservationRow): Reservation {
  const descriptor = capacityDescriptor(row.rate_unit_code);
  const durationSeconds = (Date.parse(row.end_at) - Date.parse(row.start_at)) / 1_000;
  const base = {
    id: row.id,
    orderId: row.order_id,
    capacityLotId: row.capacity_lot_id,
    ...descriptor,
    rateUnits: row.rate_units,
    startAt: row.start_at,
    endAt: row.end_at,
    durationSeconds,
    capacityBaseUnits: row.capacity_base_units,
    state: row.state,
    holdExpiresAt: row.hold_expires_at,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  return (descriptor.rateUnitCode === "GPU"
    ? {
      ...base,
      parallelUnits: row.parallel_units as number,
      capacityGpuSeconds: row.capacity_gpu_seconds as number,
      capacityGpuHours: gpuHoursFromSeconds(row.capacity_gpu_seconds as number),
    }
    : base) as Reservation;
}

function orderPhase(status: ExchangeOrder["status"]): ExchangeOrder["userPhase"] {
  if (status === "PENDING_SUPPLIER_CONFIRMATION") return "待确认";
  if (status === "AWAITING_PAYMENT") return "待支付";
  if (status === "FULFILLING") return "开通中";
  if (status === "AWAITING_ACCEPTANCE") return "待验收";
  if (status === "COMPLETED") return "已完成";
  return "异常";
}

export function mapMeteringSession(row: MeteringSessionRow): MeteringSession {
  const descriptor = capacityDescriptor(row.rate_unit_code);
  const base = {
    id: row.id,
    orderId: row.order_id,
    ...descriptor,
    environment: row.environment,
    status: row.status,
    scheduledStartAt: row.scheduled_start_at,
    scheduledEndAt: row.scheduled_end_at,
    actualStartAt: row.actual_start_at,
    finalizedAt: row.finalized_at,
    scheduledCapacityBaseUnits: row.scheduled_capacity_base_units,
    availableCapacityBaseUnits: row.available_capacity_base_units,
    unavailableCapacityBaseUnits: row.unavailable_capacity_base_units,
    unprovenCapacityBaseUnits: row.unproven_capacity_base_units,
    availabilityPpm: row.availability_ppm,
    version: row.version,
    allowedActions: [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  return (descriptor.rateUnitCode === "GPU"
    ? {
      ...base,
      scheduledGpuSeconds: row.scheduled_gpu_seconds as number,
      availableGpuSeconds: row.available_gpu_seconds as number,
      unavailableGpuSeconds: row.unavailable_gpu_seconds as number,
      unprovenGpuSeconds: row.unproven_gpu_seconds as number,
    }
    : base) as MeteringSession;
}

export function mapAcceptance(row: AcceptanceRow): OrderAcceptance {
  return {
    id: row.id,
    orderId: row.order_id,
    status: row.status,
    reason: row.reason,
    evidenceDigest: row.evidence_digest,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapCapacityWithdrawal(row: CapacityWithdrawalRow): CapacityWithdrawal {
  return {
    id: row.id,
    capacityLotId: row.capacity_lot_id,
    supplierActorId: row.supplier_actor_id,
    transferId: row.transfer_id,
    rateUnitCode: row.rate_unit_code,
    capacityBaseUnits: row.capacity_base_units,
    reason: row.reason,
    occurredAt: row.occurred_at,
  };
}

export function mapSwapQuoteSnapshot(row: SwapQuoteSnapshotRow): SwapQuoteLegSnapshot {
  return {
    id: row.id, quoteId: row.quote_id, legRole: row.leg_role,
    sourceListingVersionId: row.source_listing_version_id,
    listingCreatedAt: row.listing_created_at, listingValidFrom: row.listing_valid_from,
    productVersionId: row.product_version_id, capacityPolicyId: row.capacity_policy_id,
    productCode: row.product_code, rateUnitCode: row.rate_unit_code,
    fulfillmentModel: row.fulfillment_model, pricingUnitCode: row.pricing_unit_code,
    rateUnits: row.rate_units, startAt: row.start_at, endAt: row.end_at,
    durationSeconds: row.duration_seconds, capacityBaseUnits: row.capacity_base_units,
    unitPriceMicros: row.unit_price_micros, priceBasisBaseUnits: row.price_basis_base_units,
    valueCents: row.value_cents, currency: row.currency, generatedAt: row.generated_at,
    expiresAt: row.expires_at, snapshotDigest: row.snapshot_digest,
  };
}

export function mapSwapQuote(
  row: SwapQuoteRow,
  snapshots: readonly [SwapQuoteSnapshotRow, SwapQuoteSnapshotRow],
  latest: SwapQuoteStatusEventRow,
  now = new Date().toISOString(),
  viewerActorId?: string,
): SwapQuote {
  const offered = snapshots.find((snapshot) => snapshot.leg_role === "OFFERED");
  const wanted = snapshots.find((snapshot) => snapshot.leg_role === "WANTED");
  if (!offered || !wanted || snapshots.length !== 2) {
    throw new Error("EXCHANGE_INVARIANT_CORRUPTION:SWAP_QUOTE_SNAPSHOTS_INVALID");
  }
  const signed = wanted.value_cents - offered.value_cents;
  const expectedPayer = signed > 0 ? row.initiator_actor_id : signed < 0 ? row.counterparty_actor_id : null;
  const expectedPayee = signed > 0 ? row.counterparty_actor_id : signed < 0 ? row.initiator_actor_id : null;
  if (offered.value_cents !== row.offered_value_cents || wanted.value_cents !== row.wanted_value_cents
    || row.cash_adjustment_signed_cents !== signed || row.cash_adjustment_amount_cents !== Math.abs(signed)
    || row.cash_adjustment_payer_actor_id !== expectedPayer || row.cash_adjustment_payee_actor_id !== expectedPayee
    || offered.generated_at !== row.generated_at || wanted.generated_at !== row.generated_at
    || offered.expires_at !== row.expires_at || wanted.expires_at !== row.expires_at) {
    throw new Error("EXCHANGE_INVARIANT_CORRUPTION:SWAP_QUOTE_VALUES_INVALID");
  }
  const status = now >= row.expires_at && (latest.status === "QUOTED" || latest.status === "OPS_REVIEW")
    ? "EXPIRED" as const
    : latest.status;
  return {
    id: row.id, initiatorActorId: row.initiator_actor_id, counterpartyActorId: row.counterparty_actor_id,
    offered: mapSwapQuoteSnapshot(offered), wanted: mapSwapQuoteSnapshot(wanted),
    offeredValueCents: row.offered_value_cents, wantedValueCents: row.wanted_value_cents,
    cashAdjustmentSignedCents: row.cash_adjustment_signed_cents,
    cashAdjustmentAmountCents: row.cash_adjustment_amount_cents,
    cashAdjustmentPayerActorId: row.cash_adjustment_payer_actor_id,
    cashAdjustmentPayeeActorId: row.cash_adjustment_payee_actor_id,
    status,
    allowedActions: viewerActorId !== row.initiator_actor_id
      ? []
      : now >= row.expires_at && (latest.status === "QUOTED" || latest.status === "OPS_REVIEW")
        ? ["EXPIRED"]
        : latest.status === "QUOTED"
          ? ["OPS_REVIEW", "CANCELLED"]
          : latest.status === "OPS_REVIEW"
            ? ["CANCELLED"]
            : [],
    version: latest.version, generatedAt: row.generated_at, expiresAt: row.expires_at,
    quoteDigest: row.quote_digest,
  };
}

export function mapReferralCode(row: ReferralCodeRow): ReferralCode {
  return { id: row.id, agentActorId: row.agent_actor_id, code: row.code, createdAt: row.created_at };
}

export function mapReferralDecision(row: ReferralDecisionRow): ReferralDecision {
  return {
    id: row.id, orderId: row.order_id, outcome: row.outcome,
    resolvedCodeId: row.resolved_code_id, submittedCodeDigest: row.submitted_code_digest,
    decidedAt: row.decided_at,
  };
}

export function mapReferralAttribution(row: ReferralAttributionRow): ReferralAttribution {
  return {
    id: row.id, orderId: row.order_id, decisionId: row.decision_id,
    referralCodeId: row.referral_code_id, agentActorId: row.agent_actor_id,
    buyerActorId: row.buyer_actor_id, supplierActorId: row.supplier_actor_id,
    attributedAt: row.attributed_at,
  };
}

export function mapCommissionAccrual(row: CommissionAccrualRow): CommissionAccrual {
  return {
    id: row.id, orderId: row.order_id, settlementId: row.settlement_id,
    attributionId: row.attribution_id, agentActorId: row.agent_actor_id,
    environment: row.environment, recordKind: row.record_kind,
    commissionBaseCents: row.commission_base_cents,
    commissionRateBasisPoints: row.commission_rate_basis_points,
    commissionEstimateCents: row.commission_estimate_cents, fundsMoved: false,
    createdAt: row.created_at,
  };
}

export function mapSettlement(row: SettlementRow, commissionRow?: CommissionAccrualRow | null): TestSettlement {
  if (commissionRow && (
    commissionRow.order_id !== row.order_id
    || commissionRow.settlement_id !== row.id
    || commissionRow.environment !== "TEST"
    || commissionRow.record_kind !== "ESTIMATE_ONLY"
    || commissionRow.commission_base_cents !== row.gross_amount_cents
    || commissionRow.commission_rate_basis_points !== 300
    || commissionRow.commission_estimate_cents !== deriveCommissionEstimateCents(row.gross_amount_cents)
    || commissionRow.funds_moved !== 0
  )) {
    throw new Error("EXCHANGE_INVARIANT_CORRUPTION:COMMISSION_ACCRUAL_FACTS_INVALID");
  }
  return {
    id: row.id,
    orderId: row.order_id,
    environment: row.environment,
    status: row.status,
    grossAmountCents: row.gross_amount_cents,
    baseCreditCents: row.base_credit_cents,
    disputeCreditCents: row.dispute_credit_cents,
    netSupplierPayableCents: row.net_supplier_payable_cents,
    fundsMoved: false,
    ledgerBatchId: row.ledger_batch_id,
    commission: commissionRow ? mapCommissionAccrual(commissionRow) : null,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapPaymentIntent(row: PaymentIntentRow): PaymentIntent {
  return {
    id: row.id,
    orderId: row.order_id,
    provider: row.provider,
    environment: row.environment,
    merchantAccountRef: row.merchant_account_ref,
    amountCents: row.amount_cents,
    currency: row.currency,
    status: row.status,
    providerPaymentId: row.provider_payment_id,
    expiresAt: row.expires_at,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapDeliveryReview(row: DeliveryReviewRow): DeliveryReview {
  return {
    id: row.id,
    packageId: row.package_id,
    reviewerActorId: row.reviewer_actor_id,
    decision: row.decision,
    verificationMethod: row.verification_method,
    reason: row.reason,
    evidenceDigest: row.evidence_digest,
    createdAt: row.created_at,
  };
}

export function mapDeliveryClaim(row: DeliveryClaimRow): DeliveryClaim {
  return {
    id: row.id,
    packageId: row.package_id,
    buyerActorId: row.buyer_actor_id,
    claimedAt: row.claimed_at,
  };
}

export function mapConnectionCheck(row: ConnectionCheckRow): ConnectionCheck {
  return {
    id: row.id,
    packageId: row.package_id,
    buyerActorId: row.buyer_actor_id,
    adapter: row.adapter,
    status: row.status,
    diagnosticCode: row.diagnostic_code,
    summary: row.summary,
    evidenceDigest: row.evidence_digest,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    createdAt: row.created_at,
  };
}

export function mapDeliveryPackage(
  row: DeliveryPackageRow,
  viewerRole?: "buyer" | "supplier" | "ops",
  projection?: { review?: DeliveryReviewRow | null; claim?: DeliveryClaimRow | null; latestConnectionCheck?: ConnectionCheckRow | null },
): DeliveryPackage {
  const effectiveStatus = row.credential_expires_at <= new Date().toISOString()
    && ["SUBMITTED", "VERIFIED", "CLAIMED"].includes(row.status)
    ? "EXPIRED"
    : row.status;
  const review = projection?.review ? mapDeliveryReview(projection.review) : null;
  const claim = projection?.claim ? mapDeliveryClaim(projection.claim) : null;
  const latestConnectionCheck = projection?.latestConnectionCheck ? mapConnectionCheck(projection.latestConnectionCheck) : null;
  const allowedActions = viewerRole === "ops" && effectiveStatus === "SUBMITTED"
    ? ["REVIEW_DELIVERY_PACKAGE"]
    : viewerRole === "buyer" && effectiveStatus === "VERIFIED"
      ? ["CLAIM_DELIVERY_PACKAGE"]
      : viewerRole === "buyer" && effectiveStatus === "CLAIMED" && latestConnectionCheck?.status !== "PASSED"
        ? ["TEST_CONNECTION"]
        : [];
  return {
    id: row.id,
    deliveryTaskId: row.delivery_task_id,
    orderId: row.order_id,
    supplierActorId: row.supplier_actor_id,
    revision: row.revision,
    environment: row.environment,
    status: effectiveStatus,
    publicProfile: JSON.parse(row.public_profile_json) as DeliveryPackage["publicProfile"],
    submissionEvidenceDigest: row.submission_evidence_digest,
    review,
    claim,
    latestConnectionCheck,
    allowedActions,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapDeliveryTask(row: DeliveryTaskRow, deliveryPackage: DeliveryPackage | null = null): DeliveryTask {
  return {
    id: row.id,
    orderId: row.order_id,
    method: row.method,
    status: row.status,
    package: deliveryPackage,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapOrder(
  row: OrderRow,
  reservationRow: ReservationRow,
  viewerRole?: "buyer" | "supplier" | "ops",
  projection?: {
    lifecycle?: OrderLifecycleRow | null;
    payment?: PaymentIntentRow | null;
    delivery?: DeliveryTaskRow | null;
    deliveryPackage?: DeliveryPackage | null;
    metering?: MeteringSessionRow | null;
    acceptance?: AcceptanceRow | null;
    settlement?: SettlementRow | null;
    commission?: CommissionAccrualRow | null;
    referralDecision?: ReferralDecisionRow | null;
    referralAttribution?: ReferralAttributionRow | null;
  },
): ExchangeOrder {
  if (row.accounting_schema_version >= 2 && !row.snapshot_id) {
    throw new Error("EXCHANGE_INVARIANT_CORRUPTION:ORDER_CONTRACT_SNAPSHOT_MISSING");
  }
  if (!projection?.referralDecision) {
    throw new Error("EXCHANGE_INVARIANT_CORRUPTION:REFERRAL_DECISION_MISSING");
  }
  const referralApplied = projection.referralDecision.outcome === "APPLIED";
  if (referralApplied !== Boolean(projection.referralAttribution)) {
    throw new Error("EXCHANGE_INVARIANT_CORRUPTION:REFERRAL_ATTRIBUTION_CARDINALITY_INVALID");
  }
  if (projection.referralAttribution && (
    projection.referralAttribution.order_id !== row.id
    || projection.referralAttribution.decision_id !== projection.referralDecision.id
    || projection.referralAttribution.referral_code_id !== projection.referralDecision.resolved_code_id
    || projection.referralAttribution.buyer_actor_id !== row.buyer_actor_id
    || projection.referralAttribution.supplier_actor_id !== row.supplier_actor_id
    || projection.referralAttribution.agent_actor_id === row.buyer_actor_id
    || projection.referralAttribution.agent_actor_id === row.supplier_actor_id
  )) {
    throw new Error("EXCHANGE_INVARIANT_CORRUPTION:REFERRAL_ATTRIBUTION_FACTS_INVALID");
  }
  const descriptor = capacityDescriptor(row.snapshot_rate_unit_code ?? row.rate_unit_code);
  if (row.snapshot_rate_unit_code && row.snapshot_rate_unit_code !== row.rate_unit_code) {
    throw new Error("EXCHANGE_INVARIANT_CORRUPTION:ORDER_CONTRACT_UNIT_MISMATCH");
  }
  const lifecycleStatus: ExchangeOrder["status"] = row.status === "CANCELLED" || row.status === "EXPIRED"
    ? row.status
    : projection?.lifecycle?.phase === "FULFILLING"
      ? "FULFILLING"
      : projection?.lifecycle?.phase === "AWAITING_ACCEPTANCE"
        ? "AWAITING_ACCEPTANCE"
        : projection?.lifecycle?.phase === "COMPLETED"
          ? "COMPLETED"
          : projection?.lifecycle?.phase === "EXCEPTION"
            ? "EXCEPTION"
          : row.status;
  const payment = projection?.payment ? mapPaymentIntent(projection.payment) : null;
  const deliveryPackage = projection?.deliveryPackage ?? null;
  const delivery = projection?.delivery ? mapDeliveryTask(projection.delivery, deliveryPackage) : null;
  const metering = projection?.metering ? mapMeteringSession(projection.metering) : null;
  const acceptance = projection?.acceptance ? mapAcceptance(projection.acceptance) : null;
  const settlement = projection?.settlement ? mapSettlement(projection.settlement, projection.commission) : null;
  const referralDecision = mapReferralDecision(projection.referralDecision);
  const referralAttribution = projection.referralAttribution ? mapReferralAttribution(projection.referralAttribution) : null;
  const allowedActions = viewerRole === "supplier" && lifecycleStatus === "PENDING_SUPPLIER_CONFIRMATION"
    ? ["SUPPLIER_CONFIRM", "SUPPLIER_REJECT"]
    : viewerRole === "buyer" && lifecycleStatus === "AWAITING_PAYMENT" && payment?.status === "PENDING"
      ? ["SIMULATE_PAYMENT"]
      : viewerRole === "supplier" && lifecycleStatus === "FULFILLING" && delivery?.status === "PENDING"
        ? ["START_PROVISIONING"]
        : viewerRole === "supplier" && lifecycleStatus === "FULFILLING" && delivery?.status === "PROVISIONING"
          && (!delivery.package || ["REJECTED", "EXPIRED", "REVOKED"].includes(delivery.package.status))
          ? ["SUBMIT_DELIVERY_PACKAGE"]
          : viewerRole === "buyer" && lifecycleStatus === "FULFILLING" && delivery?.package?.status === "VERIFIED"
            ? ["CLAIM_DELIVERY_PACKAGE"]
            : viewerRole === "buyer" && lifecycleStatus === "FULFILLING" && delivery?.package?.status === "CLAIMED"
              && delivery.package.latestConnectionCheck?.status !== "PASSED"
              ? ["TEST_CONNECTION"]
              : viewerRole === "ops" && lifecycleStatus === "FULFILLING"
                && metering?.status === "SCHEDULED" && payment?.status === "CAPTURED"
                && payment.environment === "TEST" && delivery?.status === "DELIVERED"
                && reservationRow.state === "COMMITTED"
                && deliveryPackage?.status === "CLAIMED"
                && deliveryPackage.latestConnectionCheck?.status === "PASSED"
                ? ["TEST_START_SERVICE"]
                : viewerRole === "ops" && lifecycleStatus === "FULFILLING"
                  && metering?.status === "ACTIVE" && delivery?.status === "IN_SERVICE"
                  && reservationRow.state === "IN_SERVICE"
                  ? ["TEST_COMPLETE_METERING"]
                  : viewerRole === "buyer" && lifecycleStatus === "AWAITING_ACCEPTANCE" && acceptance?.status === "PENDING"
                    ? ["ACCEPT_ORDER", "DISPUTE_ORDER"]
                    : viewerRole === "ops" && lifecycleStatus === "COMPLETED"
                      && acceptance?.status === "ACCEPTED" && settlement?.status === "ELIGIBLE"
                      ? ["TEST_RECORD_SETTLEMENT"]
        : [];
  const durationSeconds = (Date.parse(row.end_at) - Date.parse(row.start_at)) / 1_000;
  const common = {
    id: row.id,
    buyerActorId: row.buyer_actor_id,
    supplierActorId: row.supplier_actor_id,
    listingVersionId: row.listing_version_id,
    ...descriptor,
    productCode: row.snapshot_product_code ?? descriptor.productCode,
    fulfillmentModel: row.snapshot_fulfillment_model ?? descriptor.fulfillmentModel,
    pricingUnitCode: row.snapshot_pricing_unit_code ?? descriptor.pricingUnitCode,
    priceBasisBaseUnits: row.snapshot_price_basis_base_units ?? descriptor.priceBasisBaseUnits,
    rateUnits: row.rate_units,
    startAt: row.start_at,
    endAt: row.end_at,
    durationSeconds,
    capacityBaseUnits: row.capacity_base_units,
    unitPriceMicros: row.unit_price_micros,
    totalAmountCents: row.total_amount_cents,
    currency: row.currency,
    status: lifecycleStatus,
    userPhase: orderPhase(lifecycleStatus),
    holdExpiresAt: row.hold_expires_at,
    version: row.version,
    allowedActions,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    reservation: mapReservation(reservationRow),
    payment,
    delivery,
    metering,
    acceptance,
    settlement,
    referralDecision,
    referralAttribution,
  };
  return (descriptor.rateUnitCode === "GPU"
    ? {
      ...common,
      productCode: "GPU_COMPUTE",
      rateUnitCode: "GPU",
      pricingUnitCode: "GPU_HOUR",
      parallelUnits: row.parallel_units as number,
      capacityGpuSeconds: row.capacity_gpu_seconds as number,
      capacityGpuHours: gpuHoursFromSeconds(row.capacity_gpu_seconds as number),
      unitPriceCents: row.unit_price_cents as number,
      reservation: mapReservation(reservationRow) as Extract<Reservation, { productCode: "GPU_COMPUTE" }>,
    }
    : common) as ExchangeOrder;
}

export function newResource(
  actorId: string,
  input: CreateResourceAsset,
  descriptor: EnabledCapacityDescriptor,
): ResourceAsset {
  const now = new Date().toISOString();
  const base = {
    id: createExchangeId("RA"),
    supplierActorId: actorId,
    productVersionId: input.productVersionId,
    ...descriptor,
    title: input.title,
    region: input.region,
    deliveryForm: input.deliveryForm,
    totalRateUnits: input.totalRateUnits,
    interruptibility: input.interruptibility,
    networkScope: input.networkScope,
    status: "DECLARED" as const,
    version: 1,
    createdAt: now,
    updatedAt: now,
  };
  return (descriptor.rateUnitCode === "GPU"
    ? { ...base, productCode: "GPU_COMPUTE", rateUnitCode: "GPU", totalParallelUnits: input.totalRateUnits }
    : base) as ResourceAsset;
}

export function newVerification(actorId: string, resourceId: string, input: CreateVerificationRun): VerificationRun {
  return {
    id: createExchangeId("VR"),
    resourceAssetId: resourceId,
    operatorActorId: actorId,
    ...input,
    createdAt: new Date().toISOString(),
  };
}

export function newCapacityLot(
  actorId: string,
  input: CreateCapacityLot & { verificationRunId: string },
  descriptor: EnabledCapacityDescriptor,
): CapacityLot {
  const now = new Date().toISOString();
  const durationSeconds = (Date.parse(input.endAt) - Date.parse(input.startAt)) / 1_000;
  const capacityBaseUnits = Number(BigInt(input.rateUnits) * BigInt(durationSeconds));
  const base = {
    id: createExchangeId("LOT"),
    supplierActorId: actorId,
    ...input,
    ...descriptor,
    durationSeconds,
    capacityBaseUnits,
    status: "READY" as const,
    allowedActions: ["CREATE_LISTING", "WITHDRAW"] as const,
    withdrawalEligibility: { eligible: true, reasonCode: "ELIGIBLE" } as const,
    version: 1,
    createdAt: now,
    updatedAt: now,
  };
  return (descriptor.rateUnitCode === "GPU"
    ? {
      ...base,
      productCode: "GPU_COMPUTE",
      rateUnitCode: "GPU",
      parallelUnits: input.rateUnits,
      capacityGpuSeconds: capacityBaseUnits,
      capacityGpuHours: gpuHoursFromSeconds(capacityBaseUnits),
    }
    : base) as CapacityLot;
}

export function newListing(
  actorId: string,
  input: CreateListingVersion,
  descriptor: EnabledCapacityDescriptor,
): ListingVersion {
  const listingId = createExchangeId("L");
  const { expectedLotVersion, ...publicInput } = input;
  void expectedLotVersion;
  const base = {
    id: createExchangeId("LV"),
    listingId,
    versionNumber: 1,
    supplierActorId: actorId,
    ...publicInput,
    ...descriptor,
    currency: "CNY" as const,
    status: "ACTIVE" as const,
    createdAt: new Date().toISOString(),
  };
  return (descriptor.rateUnitCode === "GPU"
    ? {
      ...base,
      productCode: "GPU_COMPUTE",
      rateUnitCode: "GPU",
      pricingUnitCode: "GPU_HOUR",
      unitPriceCents: input.unitPriceMicros / 10_000,
      minParallelUnits: input.minRateUnits,
      maxParallelUnits: input.maxRateUnits,
    }
    : base) as ListingVersion;
}

export type CheckoutCapacityTerms = {
  capacityLotId: string;
  listingValidUntil: string;
  descriptor: EnabledCapacityDescriptor;
  unitPriceMicros: number;
};

export function newCheckoutRecords(
  buyerActorId: string,
  supplierActorId: string,
  terms: CheckoutCapacityTerms,
  input: CreateCheckout,
) {
  const durationSeconds = (Date.parse(input.endAt) - Date.parse(input.startAt)) / 1_000;
  const capacityBaseUnits = BigInt(input.rateUnits) * BigInt(durationSeconds);
  const totalAmountCents = deriveCapacityAmountCents({
    unitPriceMicros: BigInt(terms.unitPriceMicros),
    capacityBaseUnits,
    priceBasisBaseUnits: BigInt(terms.descriptor.priceBasisBaseUnits),
  });
  if (totalAmountCents > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new ExchangeDomainError(
      "EXCHANGE_AMOUNT_TOO_LARGE",
      422,
      "订单金额超过平台可安全处理的上限，请缩短时间窗或减少并行卡数。",
    );
  }
  const now = new Date();
  const holdCeiling = Math.min(
    now.getTime() + 30 * 60 * 1_000,
    Date.parse(terms.listingValidUntil),
    Date.parse(input.startAt),
  );
  const holdExpiresAt = new Date(holdCeiling).toISOString();
  const createdAt = now.toISOString();
  const orderId = createExchangeId("ORD");
  const reservationBase = {
    id: createExchangeId("RSV"),
    orderId,
    capacityLotId: terms.capacityLotId,
    ...terms.descriptor,
    rateUnits: input.rateUnits,
    startAt: input.startAt,
    endAt: input.endAt,
    durationSeconds,
    capacityBaseUnits: Number(capacityBaseUnits),
    state: "HELD",
    holdExpiresAt,
    version: 1,
    createdAt,
    updatedAt: createdAt,
  };
  const reservation = (terms.descriptor.rateUnitCode === "GPU"
    ? {
      ...reservationBase,
      productCode: "GPU_COMPUTE", rateUnitCode: "GPU",
      parallelUnits: input.rateUnits,
      capacityGpuSeconds: Number(capacityBaseUnits),
      capacityGpuHours: gpuHoursFromSeconds(Number(capacityBaseUnits)),
    }
    : terms.descriptor.rateUnitCode === "MODEL_INSTANCE"
      ? { ...reservationBase, productCode: "MODEL_INSTANCE", rateUnitCode: "MODEL_INSTANCE" }
      : { ...reservationBase, productCode: "TOKEN_THROUGHPUT", rateUnitCode: "MILLI_M_TOKEN_PER_HOUR" }) as Reservation;
  const orderRow: OrderRow = {
    id: orderId,
    buyer_actor_id: buyerActorId,
    supplier_actor_id: supplierActorId,
    payload_hash: "",
    listing_version_id: input.listingVersionId,
    rate_unit_code: terms.descriptor.rateUnitCode,
    rate_units: input.rateUnits,
    parallel_units: terms.descriptor.rateUnitCode === "GPU" ? input.rateUnits : null,
    start_at: input.startAt,
    end_at: input.endAt,
    capacity_base_units: Number(capacityBaseUnits),
    capacity_gpu_seconds: terms.descriptor.rateUnitCode === "GPU" ? Number(capacityBaseUnits) : null,
    unit_price_micros: terms.unitPriceMicros,
    unit_price_cents: terms.descriptor.rateUnitCode === "GPU" ? terms.unitPriceMicros / 10_000 : null,
    total_amount_cents: Number(totalAmountCents),
    currency: "CNY",
    status: "PENDING_SUPPLIER_CONFIRMATION",
    hold_expires_at: holdExpiresAt,
    accounting_schema_version: 4,
    version: 1,
    created_at: createdAt,
    updated_at: createdAt,
  };
  const reservationRow: ReservationRow = {
    id: reservation.id,
    order_id: reservation.orderId,
    capacity_lot_id: reservation.capacityLotId,
    rate_unit_code: terms.descriptor.rateUnitCode,
    rate_units: reservation.rateUnits,
    parallel_units: terms.descriptor.rateUnitCode === "GPU" ? input.rateUnits : null,
    start_at: reservation.startAt,
    end_at: reservation.endAt,
    capacity_base_units: reservation.capacityBaseUnits,
    capacity_gpu_seconds: terms.descriptor.rateUnitCode === "GPU" ? reservation.capacityBaseUnits : null,
    state: reservation.state,
    hold_expires_at: reservation.holdExpiresAt,
    version: reservation.version,
    created_at: reservation.createdAt,
    updated_at: reservation.updatedAt,
  };
  return { orderRow, reservationRow };
}

export function eventId() {
  return createExchangeId("EV");
}
