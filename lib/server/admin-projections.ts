import type {
  AdminEntityOwnership,
  AdminListQuery,
  AdminProjectionItem,
  AdminProjectionName,
  AdminSourceSystem,
} from "./admin-store.ts";

type Row = Record<string, unknown>;

export interface AdminProjectionAdapter {
  all<T>(sql: string, values?: readonly unknown[]): Promise<T[]>;
}

const anonymousOwnership = {
  organizationId: null,
  accountId: null,
  legacyActorId: null,
  classification: "LEGACY_ANON" as const,
};

async function safeAll(
  db: AdminProjectionAdapter,
  sql: string,
  values: readonly unknown[] = [],
) {
  return db.all<Row>(sql, values);
}

function safeJson(value: unknown) {
  if (typeof value !== "string") return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function ownership(row: Row): AdminEntityOwnership | typeof anonymousOwnership {
  if (row.organization_id == null) return anonymousOwnership;
  return {
    sourceSystem: row.ownership_source_system as AdminSourceSystem,
    entityType: String(row.ownership_entity_type),
    entityId: String(row.id),
    organizationId: String(row.organization_id),
    accountId: String(row.account_id),
    legacyActorId: row.legacy_actor_id == null ? null : String(row.legacy_actor_id),
    boundByPrincipalId: String(row.bound_by_principal_id),
    createdAt: String(row.ownership_created_at),
    updatedAt: String(row.ownership_updated_at),
    version: Number(row.ownership_version),
    classification: "BOUND",
  };
}

const ownershipColumns = `own.source_system ownership_source_system,
  own.entity_type ownership_entity_type, own.organization_id, own.account_id,
  own.legacy_actor_id, own.bound_by_principal_id,
  own.created_at ownership_created_at, own.updated_at ownership_updated_at,
  own.version ownership_version`;

function ownershipJoin(
  sourceSystem: AdminSourceSystem,
  entityType: string,
  alias = "x",
  entityId = `${alias}.id`,
) {
  return `LEFT JOIN admin_entity_ownership own
    ON own.source_system='${sourceSystem}'
    AND own.entity_type='${entityType}'
    AND own.entity_id=${entityId}`;
}

function item(
  row: Row,
  sourceSystem: AdminSourceSystem,
  entityType: string,
  options: {
    title: string;
    subtitle?: string | null;
    actors?: unknown[];
    amount?: unknown;
    currency?: unknown;
    facts?: Record<string, unknown>;
  },
): AdminProjectionItem {
  return {
    sourceSystem,
    entityType,
    id: String(row.id),
    status: String(row.status),
    title: options.title,
    subtitle: options.subtitle ?? null,
    actorIds: (options.actors ?? []).filter((value) => value != null).map(String),
    amountCents: options.amount == null ? null : Number(options.amount),
    currency: options.currency == null ? null : String(options.currency),
    createdAt: row.created_at == null ? null : String(row.created_at),
    updatedAt: row.updated_at == null ? null : String(row.updated_at),
    facts: options.facts ?? {},
    ownership: ownership(row),
  };
}

async function supplyOffers(db: AdminProjectionAdapter) {
  const rows = await safeAll(db, `SELECT x.*,${ownershipColumns}
    FROM supply_offers x ${ownershipJoin("SUPPLY_PILOT", "SUPPLY_OFFER")}
    ORDER BY x.created_at DESC LIMIT 250`);
  return rows.map((row) => item(row, "SUPPLY_PILOT", "SUPPLY_OFFER", {
    title: String(row.product_name),
    subtitle: `${row.quantity} ${row.quantity_unit} · ${row.region}`,
    actors: [row.supplier_actor_id],
    facts: {
      resourceType: row.resource_type,
      supplierType: row.supplier_type,
      specification: row.specification,
      pricingUnit: row.pricing_unit,
      deliveryForm: row.delivery_form,
      version: Number(row.version),
    },
  }));
}

async function demands(db: AdminProjectionAdapter) {
  const rows = await safeAll(db, `SELECT x.*,${ownershipColumns}
    FROM marketplace_requests_v2 x ${ownershipJoin("MARKETPLACE", "DEMAND")}
    ORDER BY x.created_at DESC LIMIT 250`);
  return rows.map((row) => item(row, "MARKETPLACE", "DEMAND", {
    title: String(row.title),
    subtitle: `${row.quantity} ${row.pricing_unit} · ${row.region}`,
    actors: [row.owner_actor_id],
    amount: row.cash_amount == null ? null : Math.round(Number(row.cash_amount) * 100),
    currency: row.cash_amount == null ? null : "CNY",
    facts: {
      requestType: row.request_type,
      kind: row.kind,
      category: row.category,
      cashDirection: row.cash_direction,
      version: Number(row.version),
    },
  }));
}

async function matches(db: AdminProjectionAdapter) {
  const rows = await safeAll(db, `SELECT x.*,${ownershipColumns}
    FROM admin_work_items x ${ownershipJoin("ADMIN", "MATCH")}
    WHERE x.work_type='DEMAND_MATCH'
    ORDER BY x.created_at DESC LIMIT 250`);
  return rows.map((row) => item(row, "ADMIN", "MATCH", {
    title: String(row.title),
    subtitle: String(row.summary),
    actors: [row.created_by, row.assignee_principal_id],
    facts: {
      priority: row.priority,
      metadata: safeJson(row.metadata_json),
      version: Number(row.version),
    },
  }));
}

async function pools(db: AdminProjectionAdapter) {
  const rows = await safeAll(db, `SELECT x.*,
      (SELECT COUNT(*) FROM supply_asset_members m WHERE m.pool_id=x.id) member_count,
      (SELECT COUNT(*) FROM supply_asset_members m WHERE m.pool_id=x.id AND m.status='VERIFIED') verified_count,
      ${ownershipColumns}
    FROM supply_asset_pools x ${ownershipJoin("SUPPLY_PILOT", "ASSET_POOL")}
    ORDER BY x.created_at DESC LIMIT 250`);
  return rows.map((row) => item(row, "SUPPLY_PILOT", "ASSET_POOL", {
    title: String(row.name),
    subtitle: `${row.asset_kind} · ${row.region}`,
    actors: [row.supplier_actor_id],
    facts: {
      deliveryForm: row.delivery_form,
      specDigest: row.spec_digest,
      memberCount: Number(row.member_count),
      verifiedCount: Number(row.verified_count),
    },
  }));
}

async function verifications(db: AdminProjectionAdapter) {
  const [exchange, supply] = await Promise.all([
    safeAll(db, `SELECT x.*,x.result status,${ownershipColumns}
      FROM exchange_verification_runs x ${ownershipJoin("EXCHANGE", "VERIFICATION_RUN")}
      ORDER BY x.created_at DESC LIMIT 150`),
    safeAll(db, `SELECT x.*,${ownershipColumns}
      FROM supply_verification_jobs x ${ownershipJoin("SUPPLY_PILOT", "VERIFICATION_JOB")}
      ORDER BY x.created_at DESC LIMIT 150`),
  ]);
  return [
    ...exchange.map((row) => item(row, "EXCHANGE", "VERIFICATION_RUN", {
      title: `验真 ${row.id}`,
      subtitle: String(row.evidence_summary),
      actors: [row.operator_actor_id],
      facts: {
        resourceAssetId: row.resource_asset_id,
        method: row.method,
        validUntil: row.valid_until,
      },
    })),
    ...supply.map((row) => item(row, "SUPPLY_PILOT", "VERIFICATION_JOB", {
      title: `验真 ${row.id}`,
      subtitle: `资源池 ${row.pool_id}`,
      actors: [row.requested_by, row.reviewed_by],
      facts: {
        poolId: row.pool_id,
        memberId: row.member_id,
        validUntil: row.valid_until,
        completedAt: row.completed_at,
      },
    })),
  ];
}

async function capacityLots(db: AdminProjectionAdapter) {
  const rows = await safeAll(db, `SELECT x.*,asset.title asset_title,asset.region,
      product.display_name product_name,product.product_code,${ownershipColumns}
    FROM exchange_capacity_lots x
    JOIN exchange_resource_assets asset ON asset.id=x.resource_asset_id
    JOIN exchange_product_versions product ON product.id=asset.product_version_id
    ${ownershipJoin("EXCHANGE", "CAPACITY_LOT")}
    ORDER BY x.created_at DESC LIMIT 250`);
  return rows.map((row) => item(row, "EXCHANGE", "CAPACITY_LOT", {
    title: String(row.product_name ?? row.asset_title),
    subtitle: `${row.rate_units} ${row.rate_unit_code} · ${row.region}`,
    actors: [row.supplier_actor_id],
    facts: {
      assetTitle: row.asset_title,
      productCode: row.product_code,
      resourceAssetId: row.resource_asset_id,
      verificationRunId: row.verification_run_id,
      startAt: row.start_at,
      endAt: row.end_at,
      capacityBaseUnits: Number(row.capacity_base_units),
      interruptibility: row.interruptibility,
      accountingSchemaVersion: Number(row.accounting_schema_version),
      version: Number(row.version),
    },
  }));
}

async function listings(db: AdminProjectionAdapter) {
  const rows = await safeAll(db, `SELECT x.*,asset.title asset_title,asset.region,
      product.display_name product_name,product.product_code,${ownershipColumns}
    FROM exchange_listing_versions x
    JOIN exchange_capacity_lots lot ON lot.id=x.capacity_lot_id
    JOIN exchange_resource_assets asset ON asset.id=lot.resource_asset_id
    JOIN exchange_product_versions product ON product.id=asset.product_version_id
    ${ownershipJoin("EXCHANGE", "LISTING_VERSION")}
    ORDER BY x.created_at DESC LIMIT 250`);
  return rows.map((row) => item(row, "EXCHANGE", "LISTING_VERSION", {
    title: String(row.product_name ?? row.listing_id),
    subtitle: `${row.pricing_unit_code} · ${row.region}`,
    actors: [row.supplier_actor_id],
    amount: Math.round(Number(row.unit_price_micros) / 10_000),
    currency: row.currency,
    facts: {
      listingId: row.listing_id,
      versionNumber: Number(row.version_number),
      productCode: row.product_code,
      capacityLotId: row.capacity_lot_id,
      rateUnitCode: row.rate_unit_code,
      unitPriceMicros: String(row.unit_price_micros),
      minRateUnits: Number(row.min_rate_units),
      maxRateUnits: Number(row.max_rate_units),
      minDurationMinutes: Number(row.min_duration_minutes),
      deliveryForm: row.delivery_form,
      validFrom: row.valid_from,
      validUntil: row.valid_until,
    },
  }));
}

async function withdrawals(db: AdminProjectionAdapter) {
  const rows = await safeAll(db, `SELECT x.*,'COMPLETED' status,
      x.occurred_at created_at,x.occurred_at updated_at,${ownershipColumns}
    FROM exchange_capacity_withdrawals x ${ownershipJoin("EXCHANGE", "CAPACITY_WITHDRAWAL")}
    ORDER BY x.occurred_at DESC LIMIT 250`);
  return rows.map((row) => item(row, "EXCHANGE", "CAPACITY_WITHDRAWAL", {
    title: `容量取回 ${row.capacity_lot_id}`,
    subtitle: `${row.capacity_base_units} ${row.rate_unit_code}`,
    actors: [row.supplier_actor_id],
    facts: {
      capacityLotId: row.capacity_lot_id,
      transferId: row.transfer_id,
      expectedLotVersion: Number(row.expected_lot_version),
      reason: row.reason,
      accountingSchemaVersion: Number(row.accounting_schema_version),
    },
  }));
}

async function swaps(db: AdminProjectionAdapter) {
  const rows = await safeAll(db, `SELECT x.*,
      COALESCE((SELECT event.status FROM exchange_swap_quote_status_events event
        WHERE event.quote_id=x.id ORDER BY event.version DESC LIMIT 1),'QUOTED') status,
      x.generated_at created_at,
      COALESCE((SELECT event.occurred_at FROM exchange_swap_quote_status_events event
        WHERE event.quote_id=x.id ORDER BY event.version DESC LIMIT 1),x.generated_at) updated_at,
      ${ownershipColumns}
    FROM exchange_swap_quotes x ${ownershipJoin("EXCHANGE", "SWAP_QUOTE")}
    ORDER BY x.generated_at DESC LIMIT 250`);
  return rows.map((row) => item(row, "EXCHANGE", "SWAP_QUOTE", {
    title: `置换报价 ${row.id}`,
    subtitle: `${row.initiator_actor_id} ⇄ ${row.counterparty_actor_id}`,
    actors: [row.initiator_actor_id, row.counterparty_actor_id],
    amount: row.cash_adjustment_amount_cents,
    currency: "CNY",
    facts: {
      offeredValueCents: Number(row.offered_value_cents),
      wantedValueCents: Number(row.wanted_value_cents),
      cashAdjustmentSignedCents: Number(row.cash_adjustment_signed_cents),
      payerActorId: row.cash_adjustment_payer_actor_id,
      payeeActorId: row.cash_adjustment_payee_actor_id,
      expiresAt: row.expires_at,
      quoteDigest: row.quote_digest,
    },
  }));
}

async function orders(db: AdminProjectionAdapter) {
  const [exchange, supply, lifecycleRows] = await Promise.all([
    safeAll(db, `SELECT x.*,${ownershipColumns}
      FROM exchange_orders x ${ownershipJoin("EXCHANGE", "ORDER")}
      ORDER BY x.created_at DESC LIMIT 150`),
    safeAll(db, `SELECT x.*,${ownershipColumns}
      FROM supply_trial_orders x ${ownershipJoin("SUPPLY_PILOT", "ORDER")}
      ORDER BY x.created_at DESC LIMIT 150`),
    safeAll(db, "SELECT order_id,phase,state_reason,version lifecycle_version,updated_at lifecycle_updated_at FROM exchange_order_lifecycle"),
  ]);
  const lifecycle = new Map(lifecycleRows.map((row) => [String(row.order_id), row]));
  return [
    ...exchange.map((row) => {
      const life = lifecycle.get(String(row.id));
      return item(row, "EXCHANGE", "ORDER", {
        title: `订单 ${row.id}`,
        subtitle: `${row.rate_units} ${row.rate_unit_code}`,
        actors: [row.buyer_actor_id, row.supplier_actor_id],
        amount: row.total_amount_cents,
        currency: row.currency,
        facts: {
          startAt: row.start_at,
          endAt: row.end_at,
          listingVersionId: row.listing_version_id,
          version: Number(row.version),
          lifecyclePhase: life?.phase ?? null,
          lifecycleReason: life?.state_reason ?? null,
          lifecycleVersion: life == null ? null : Number(life.lifecycle_version),
        },
      });
    }),
    ...supply.map((row) => item(row, "SUPPLY_PILOT", "ORDER", {
      title: `试点订单 ${row.id}`,
      subtitle: `${row.gpu_count} GPU × ${row.duration_hours}h`,
      actors: [row.buyer_actor_id, row.supplier_actor_id],
      amount: row.amount_cents,
      currency: row.currency,
      facts: {
        promotionId: row.promotion_id,
        startAt: row.start_at,
        endAt: row.end_at,
        version: Number(row.version),
      },
    })),
  ];
}

async function delivery(db: AdminProjectionAdapter) {
  const rows = await safeAll(db, `SELECT x.*,asset.title asset_title,
      (SELECT package.id FROM exchange_delivery_packages package
        WHERE package.delivery_task_id=x.id ORDER BY package.revision DESC LIMIT 1) package_id,
      (SELECT package.status FROM exchange_delivery_packages package
        WHERE package.delivery_task_id=x.id ORDER BY package.revision DESC LIMIT 1) package_status,
      (SELECT package.credential_expires_at FROM exchange_delivery_packages package
        WHERE package.delivery_task_id=x.id ORDER BY package.revision DESC LIMIT 1) credential_expires_at,
      (SELECT check_record.status FROM exchange_connection_checks check_record
        WHERE check_record.delivery_task_id=x.id ORDER BY check_record.attempt DESC LIMIT 1) connection_status,
      ${ownershipColumns}
    FROM exchange_delivery_tasks x
    LEFT JOIN exchange_resource_assets asset ON asset.id=x.resource_asset_id
    ${ownershipJoin("EXCHANGE", "DELIVERY_TASK")}
    ORDER BY x.updated_at DESC LIMIT 250`);
  return rows.map((row) => item(row, "EXCHANGE", "DELIVERY_TASK", {
    title: String(row.asset_title ?? `交付 ${row.order_id}`),
    subtitle: `${row.delivery_form} · ${row.method}`,
    facts: {
      orderId: row.order_id,
      packageId: row.package_id,
      packageStatus: row.package_status,
      credentialExpiresAt: row.credential_expires_at,
      connectionStatus: row.connection_status,
      provisioningDueAt: row.provisioning_due_at,
      attempt: Number(row.attempt),
      version: Number(row.version),
      environment: "TEST",
    },
  }));
}

async function metering(db: AdminProjectionAdapter) {
  const rows = await safeAll(db, `SELECT x.*,
      (SELECT final.availability_ppm FROM exchange_metering_finals final
        WHERE final.metering_session_id=x.id) final_availability_ppm,
      (SELECT final.delivered_amount_cents FROM exchange_metering_finals final
        WHERE final.metering_session_id=x.id) delivered_amount_cents,
      (SELECT acceptance.status FROM exchange_acceptances acceptance
        WHERE acceptance.order_id=x.order_id) acceptance_status,
      ${ownershipColumns}
    FROM exchange_metering_sessions x ${ownershipJoin("EXCHANGE", "METERING_SESSION")}
    ORDER BY x.updated_at DESC LIMIT 250`);
  return rows.map((row) => item(row, "EXCHANGE", "METERING_SESSION", {
    title: `计量 ${row.order_id}`,
    subtitle: `${row.reserved_rate_units} ${row.rate_unit_code}`,
    amount: row.delivered_amount_cents,
    currency: row.delivered_amount_cents == null ? null : "CNY",
    facts: {
      orderId: row.order_id,
      environment: row.environment,
      scheduledStartAt: row.scheduled_start_at,
      scheduledEndAt: row.scheduled_end_at,
      actualStartAt: row.actual_start_at,
      finalizedAt: row.finalized_at,
      scheduledCapacityBaseUnits: Number(row.scheduled_capacity_base_units),
      availableCapacityBaseUnits: Number(row.available_capacity_base_units),
      unavailableCapacityBaseUnits: Number(row.unavailable_capacity_base_units),
      availabilityPpm: row.final_availability_ppm ?? row.availability_ppm,
      acceptanceStatus: row.acceptance_status,
      version: Number(row.version),
    },
  }));
}

async function payments(db: AdminProjectionAdapter) {
  const [exchange, supply, settlements] = await Promise.all([
    safeAll(db, `SELECT x.*,${ownershipColumns}
      FROM exchange_payment_intents x ${ownershipJoin("EXCHANGE", "PAYMENT_INTENT")}
      ORDER BY x.created_at DESC LIMIT 150`),
    safeAll(db, `SELECT x.order_id id,x.*,orders.amount_cents,orders.currency,
        orders.buyer_actor_id,orders.supplier_actor_id,${ownershipColumns}
      FROM supply_trial_payments x
      JOIN supply_trial_orders orders ON orders.id=x.order_id
      ${ownershipJoin("SUPPLY_PILOT", "PAYMENT", "x", "x.order_id")}
      ORDER BY x.created_at DESC LIMIT 150`),
    safeAll(db, "SELECT id,order_id,status,gross_amount_cents,net_supplier_payable_cents,funds_moved,version FROM exchange_settlements"),
  ]);
  const settlementByOrder = new Map(settlements.map((row) => [String(row.order_id), row]));
  return [
    ...exchange.map((row) => {
      const settlement = settlementByOrder.get(String(row.order_id));
      return item(row, "EXCHANGE", "PAYMENT_INTENT", {
        title: `支付 ${row.id}`,
        subtitle: `订单 ${row.order_id}`,
        amount: row.amount_cents,
        currency: row.currency,
        facts: {
          orderId: row.order_id,
          provider: row.provider,
          environment: row.environment,
          providerPaymentId: row.provider_payment_id,
          version: Number(row.version),
          settlement: settlement == null ? null : {
            id: settlement.id,
            status: settlement.status,
            grossAmountCents: Number(settlement.gross_amount_cents),
            netSupplierPayableCents: Number(settlement.net_supplier_payable_cents),
            fundsMoved: Boolean(settlement.funds_moved),
            version: Number(settlement.version),
          },
        },
      });
    }),
    ...supply.map((row) => item(row, "SUPPLY_PILOT", "PAYMENT", {
      title: `订单 ${row.order_id} 的支付`,
      subtitle: String(row.provider),
      actors: [row.buyer_actor_id, row.supplier_actor_id],
      amount: row.amount_cents,
      currency: row.currency,
      facts: {
        orderId: row.order_id,
        providerOrderRef: row.provider_order_ref,
        providerTransactionRef: row.provider_transaction_ref,
        version: Number(row.version),
      },
    })),
  ];
}

async function settlements(db: AdminProjectionAdapter) {
  const rows = await safeAll(db, `SELECT x.*,orders.buyer_actor_id,orders.supplier_actor_id,
      acceptance.status acceptance_status,
      (SELECT COUNT(*) FROM exchange_ledger_entries entry WHERE entry.settlement_id=x.id) ledger_entry_count,
      ${ownershipColumns}
    FROM exchange_settlements x
    JOIN exchange_orders orders ON orders.id=x.order_id
    JOIN exchange_acceptances acceptance ON acceptance.id=x.acceptance_id
    ${ownershipJoin("EXCHANGE", "SETTLEMENT")}
    ORDER BY x.updated_at DESC LIMIT 250`);
  return rows.map((row) => item(row, "EXCHANGE", "SETTLEMENT", {
    title: `结算 ${row.order_id}`,
    subtitle: `${row.environment} · ${row.acceptance_status}`,
    actors: [row.buyer_actor_id, row.supplier_actor_id],
    amount: row.net_supplier_payable_cents,
    currency: "CNY",
    facts: {
      orderId: row.order_id,
      grossAmountCents: Number(row.gross_amount_cents),
      baseCreditCents: Number(row.base_credit_cents),
      disputeCreditCents: Number(row.dispute_credit_cents),
      fundsMoved: Boolean(row.funds_moved),
      ledgerBatchId: row.ledger_batch_id,
      ledgerEntryCount: Number(row.ledger_entry_count),
      version: Number(row.version),
    },
  }));
}

async function commissions(db: AdminProjectionAdapter) {
  const rows = await safeAll(db, `SELECT x.*,x.record_kind status,x.created_at updated_at,
      ${ownershipColumns}
    FROM exchange_commission_accruals x ${ownershipJoin("EXCHANGE", "COMMISSION_ACCRUAL")}
    ORDER BY x.created_at DESC LIMIT 250`);
  return rows.map((row) => item(row, "EXCHANGE", "COMMISSION_ACCRUAL", {
    title: `代理佣金估算 ${row.order_id}`,
    subtitle: String(row.agent_actor_id),
    actors: [row.agent_actor_id],
    amount: row.commission_estimate_cents,
    currency: "CNY",
    facts: {
      orderId: row.order_id,
      settlementId: row.settlement_id,
      attributionId: row.attribution_id,
      environment: row.environment,
      commissionBaseCents: Number(row.commission_base_cents),
      commissionRateBasisPoints: Number(row.commission_rate_basis_points),
      fundsMoved: Boolean(row.funds_moved),
    },
  }));
}

async function standardization(db: AdminProjectionAdapter) {
  const rows = await safeAll(db, `SELECT x.*,'PUBLISHED' status,
      x.created_at updated_at,
      (SELECT COUNT(*) FROM standardization_quote_snapshots quote WHERE quote.batch_id=x.id) quote_count,
      ${ownershipColumns}
    FROM standardization_snapshot_batches x ${ownershipJoin("ADMIN", "STANDARDIZATION_BATCH")}
    ORDER BY x.as_of DESC LIMIT 250`);
  return rows.map((row) => item(row, "ADMIN", "STANDARDIZATION_BATCH", {
    title: `${row.policy_version} 行情快照`,
    subtitle: `基准样本 ${row.benchmark_sample_count} · 报价 ${row.quote_count}`,
    actors: [row.actor_id],
    facts: {
      asOf: row.as_of,
      expiresAt: row.expires_at,
      publishReason: row.publish_reason,
      benchmarkP25CnyMicros: row.benchmark_p25_cny_micros,
      benchmarkP50CnyMicros: row.benchmark_p50_cny_micros,
      benchmarkP75CnyMicros: row.benchmark_p75_cny_micros,
      benchmarkSampleCount: Number(row.benchmark_sample_count),
      sourceSampleCount: Number(row.source_sample_count),
      promotionalExcludedCount: Number(row.promotional_excluded_count),
      quoteCount: Number(row.quote_count),
      snapshotDigest: row.snapshot_digest,
    },
  }));
}

async function exceptions(db: AdminProjectionAdapter) {
  const [workItems, paymentFailures, deliveryFailures, refundFailures] = await Promise.all([
    safeAll(db, `SELECT id,source_system,entity_type,entity_id,title,summary,status,priority,
        due_at,created_at,updated_at
      FROM admin_work_items
      WHERE status IN ('OPEN','CLAIMED','WAITING') AND priority IN ('HIGH','CRITICAL')
      ORDER BY CASE priority WHEN 'CRITICAL' THEN 0 ELSE 1 END,due_at,created_at DESC LIMIT 100`),
    safeAll(db, `SELECT id,order_id,provider,status,created_at,updated_at
      FROM exchange_payment_intents WHERE status='FAILED' ORDER BY updated_at DESC LIMIT 100`),
    safeAll(db, `SELECT id,order_id,status,attempt,provisioning_due_at,created_at,updated_at
      FROM exchange_delivery_tasks WHERE status='FAILED' ORDER BY updated_at DESC LIMIT 100`),
    safeAll(db, `SELECT refund_case_id id,order_id,status,last_error_code,last_error_message,
        created_at,updated_at FROM admin_refund_executions
      WHERE status='FAILED' ORDER BY updated_at DESC LIMIT 100`),
  ]);
  return [
    ...workItems.map((row) => item(row, row.source_system as AdminSourceSystem, "OPERATION_EXCEPTION", {
      title: String(row.title),
      subtitle: String(row.summary),
      facts: {
        severity: row.priority,
        sourceEntityType: row.entity_type,
        sourceEntityId: row.entity_id,
        dueAt: row.due_at,
      },
    })),
    ...paymentFailures.map((row) => item(row, "EXCHANGE", "PAYMENT_EXCEPTION", {
      title: `支付失败 ${row.id}`,
      subtitle: `订单 ${row.order_id}`,
      facts: { severity: "HIGH", provider: row.provider, orderId: row.order_id },
    })),
    ...deliveryFailures.map((row) => item(row, "EXCHANGE", "DELIVERY_EXCEPTION", {
      title: `交付失败 ${row.order_id}`,
      subtitle: `尝试次数 ${row.attempt}`,
      facts: { severity: "CRITICAL", orderId: row.order_id, provisioningDueAt: row.provisioning_due_at },
    })),
    ...refundFailures.map((row) => item(row, "ADMIN", "REFUND_EXCEPTION", {
      title: `退款执行失败 ${row.id}`,
      subtitle: String(row.last_error_message ?? row.last_error_code ?? "未知错误"),
      facts: { severity: "CRITICAL", orderId: row.order_id, errorCode: row.last_error_code },
    })),
  ];
}

async function rawProjection(db: AdminProjectionAdapter, name: AdminProjectionName) {
  switch (name) {
    case "supply-offers": return supplyOffers(db);
    case "demands": return demands(db);
    case "matches": return matches(db);
    case "pools": return pools(db);
    case "verifications": return verifications(db);
    case "capacity-lots": return capacityLots(db);
    case "listings": return listings(db);
    case "withdrawals": return withdrawals(db);
    case "swaps": return swaps(db);
    case "orders": return orders(db);
    case "delivery": return delivery(db);
    case "metering": return metering(db);
    case "payments": return payments(db);
    case "settlements": return settlements(db);
    case "commissions": return commissions(db);
    case "standardization": return standardization(db);
    case "exceptions": return exceptions(db);
  }
}

const projectionCountQueries: Readonly<Record<AdminProjectionName, readonly string[]>> = {
  "supply-offers": ["SELECT COUNT(*) count FROM supply_offers"],
  demands: ["SELECT COUNT(*) count FROM marketplace_requests_v2"],
  matches: ["SELECT COUNT(*) count FROM admin_work_items WHERE work_type='DEMAND_MATCH'"],
  pools: ["SELECT COUNT(*) count FROM supply_asset_pools"],
  verifications: [
    "SELECT COUNT(*) count FROM exchange_verification_runs",
    "SELECT COUNT(*) count FROM supply_verification_jobs",
  ],
  "capacity-lots": ["SELECT COUNT(*) count FROM exchange_capacity_lots"],
  listings: ["SELECT COUNT(*) count FROM exchange_listing_versions"],
  withdrawals: ["SELECT COUNT(*) count FROM exchange_capacity_withdrawals"],
  swaps: ["SELECT COUNT(*) count FROM exchange_swap_quotes"],
  orders: [
    "SELECT COUNT(*) count FROM exchange_orders",
    "SELECT COUNT(*) count FROM supply_trial_orders",
  ],
  delivery: ["SELECT COUNT(*) count FROM exchange_delivery_tasks"],
  metering: ["SELECT COUNT(*) count FROM exchange_metering_sessions"],
  payments: [
    "SELECT COUNT(*) count FROM exchange_payment_intents",
    "SELECT COUNT(*) count FROM supply_trial_payments",
  ],
  settlements: ["SELECT COUNT(*) count FROM exchange_settlements"],
  commissions: ["SELECT COUNT(*) count FROM exchange_commission_accruals"],
  standardization: ["SELECT COUNT(*) count FROM standardization_snapshot_batches"],
  exceptions: [
    "SELECT COUNT(*) count FROM admin_work_items WHERE status IN ('OPEN','CLAIMED','WAITING') AND priority IN ('HIGH','CRITICAL')",
    "SELECT COUNT(*) count FROM exchange_payment_intents WHERE status='FAILED'",
    "SELECT COUNT(*) count FROM exchange_delivery_tasks WHERE status='FAILED'",
    "SELECT COUNT(*) count FROM admin_refund_executions WHERE status='FAILED'",
  ],
};

export async function countAdminProjection(
  db: AdminProjectionAdapter,
  name: AdminProjectionName,
): Promise<number> {
  const results = await Promise.all(projectionCountQueries[name].map((sql) => safeAll(db, sql)));
  const count = results.reduce((total, rows) => total + Number(rows[0]?.count ?? 0), 0);
  if (!Number.isSafeInteger(count) || count < 0) throw new Error("ADMIN_PROJECTION_COUNT_INVALID");
  return count;
}

export async function readAdminProjection(
  db: AdminProjectionAdapter,
  name: AdminProjectionName,
  query: AdminListQuery = {},
): Promise<AdminProjectionItem[]> {
  const normalizedQuery = query.q?.trim().toLowerCase();
  return (await rawProjection(db, name))
    .filter((value) => (!query.status || value.status === query.status)
      && (!query.sourceSystem || value.sourceSystem === query.sourceSystem)
      && (!normalizedQuery || `${value.id} ${value.title} ${value.subtitle ?? ""} ${value.actorIds.join(" ")} ${JSON.stringify(value.facts)}`
        .toLowerCase().includes(normalizedQuery)))
    .sort((left, right) => String(right.updatedAt ?? right.createdAt ?? "")
      .localeCompare(String(left.updatedAt ?? left.createdAt ?? "")))
    .slice(0, Math.min(100, Math.max(1, Number(query.limit ?? 50) || 50)));
}
