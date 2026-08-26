export type PaidEntitlementSql = Readonly<{ sql: string; values?: readonly unknown[] }>;

type PaidEntitlementDatabase = Readonly<{
  all<T>(sql: string, values?: readonly unknown[]): Promise<T[]>;
  batch(statements: readonly PaidEntitlementSql[]): Promise<readonly { changes: number }[]>;
}>;

type LotRow = Readonly<{ id: string; available_micros: number; held_micros: number; expires_at: string }>;
type AllocationRow = Readonly<{ lot_id: string; held_micros: number; expires_at: string }>;

function positiveInteger(value: number, name: string) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${name}_INVALID`);
}

export async function expirePaidEntitlements(db: PaidEntitlementDatabase, now: string, limit = 200) {
  if (!Number.isFinite(Date.parse(now))) throw new Error("PAID_ENTITLEMENT_EXPIRY_TIME_INVALID");
  const boundedLimit = Math.min(500, Math.max(1, Math.trunc(limit)));
  const rows = await db.all<LotRow>(`SELECT id,available_micros,held_micros,expires_at FROM card_hour_paid_entitlement_lots
    WHERE available_micros>0 AND expires_at<=? ORDER BY expires_at,id LIMIT ?`, [now, boundedLimit]);
  if (!rows.length) return { expiredLots: 0, expiredMicros: 0 } as const;
  const statements: PaidEntitlementSql[] = [];
  let expiredMicros = 0;
  for (const row of rows) {
    const amount = Number(row.available_micros);
    positiveInteger(amount, "PAID_ENTITLEMENT_EXPIRY_AMOUNT");
    if (amount === 0) continue;
    expiredMicros += amount;
    const eventId = `chpe_${crypto.randomUUID()}`;
    statements.push(
      { sql: `INSERT INTO card_hour_paid_entitlement_events(id,lot_id,organization_id,event_type,amount_micros,occurred_at)
        SELECT ?,id,organization_id,'EXPIRED',available_micros,? FROM card_hour_paid_entitlement_lots
        WHERE id=? AND available_micros=? AND expires_at<=?`, values: [eventId, now, row.id, amount, now] },
      { sql: "SELECT CASE WHEN changes()=1 THEN 1 ELSE abs(-9223372036854775808) END" },
      { sql: `UPDATE card_hour_paid_entitlement_lots SET expired_micros=expired_micros+?,available_micros=0,updated_at=?
        WHERE id=? AND available_micros=? AND EXISTS(SELECT 1 FROM card_hour_paid_entitlement_events WHERE id=?)`, values: [amount, now, row.id, amount, eventId] },
      { sql: "SELECT CASE WHEN changes()=1 THEN 1 ELSE abs(-9223372036854775808) END" },
      { sql: `UPDATE card_hour_wallets SET available_micros=available_micros-?,version=version+1,updated_at=?
        WHERE organization_id=(SELECT organization_id FROM card_hour_paid_entitlement_events WHERE id=?) AND available_micros>=?`, values: [amount, now, eventId, amount] },
      { sql: "SELECT CASE WHEN changes()=1 THEN 1 ELSE abs(-9223372036854775808) END" },
    );
  }
  await db.batch(statements);
  return { expiredLots: rows.length, expiredMicros } as const;
}

export async function paidAvailableAllocationStatements(
  db: Pick<PaidEntitlementDatabase, "all">,
  input: Readonly<{ organizationId: string; amountMicros: number; now: string; destination: "SPENT" | "HELD"; holdType?: "HOSTING_V2" | "MANUAL_ORDER_V1"; holdId?: string }>,
) {
  positiveInteger(input.amountMicros, "PAID_ENTITLEMENT_ALLOCATION_AMOUNT");
  if (input.destination === "HELD" && (!input.holdType || !input.holdId)) throw new Error("PAID_ENTITLEMENT_HOLD_REFERENCE_REQUIRED");
  const rows = await db.all<LotRow>(`SELECT id,available_micros,held_micros,expires_at FROM card_hour_paid_entitlement_lots
    WHERE organization_id=? AND available_micros>0 AND expires_at>? ORDER BY expires_at,id`, [input.organizationId, input.now]);
  let remaining = input.amountMicros;
  const statements: PaidEntitlementSql[] = [];
  for (const row of rows) {
    if (remaining === 0) break;
    const amount = Math.min(remaining, Number(row.available_micros));
    remaining -= amount;
    if (input.destination === "SPENT") {
      statements.push(
        { sql: `UPDATE card_hour_paid_entitlement_lots SET available_micros=available_micros-?,spent_micros=spent_micros+?,updated_at=?
          WHERE id=? AND available_micros>=? AND expires_at>?`, values: [amount, amount, input.now, row.id, amount, input.now] },
        { sql: "SELECT CASE WHEN changes()=1 THEN 1 ELSE abs(-9223372036854775808) END" },
      );
    } else {
      statements.push(
        { sql: `UPDATE card_hour_paid_entitlement_lots SET available_micros=available_micros-?,held_micros=held_micros+?,updated_at=?
          WHERE id=? AND available_micros>=? AND expires_at>?`, values: [amount, amount, input.now, row.id, amount, input.now] },
        { sql: "SELECT CASE WHEN changes()=1 THEN 1 ELSE abs(-9223372036854775808) END" },
        { sql: `INSERT INTO card_hour_paid_entitlement_hold_allocations(hold_type,hold_id,lot_id,allocated_micros,held_micros,spent_micros,released_micros,expired_micros,created_at,updated_at)
          VALUES(?,?,?,?,?,0,0,0,?,?)`, values: [input.holdType!, input.holdId!, row.id, amount, amount, input.now, input.now] },
      );
    }
  }
  return statements;
}

export async function paidHeldResolutionStatements(
  db: Pick<PaidEntitlementDatabase, "all">,
  input: Readonly<{ holdType: "HOSTING_V2" | "MANUAL_ORDER_V1"; holdId: string; spentMicros: number; now: string }>,
) {
  positiveInteger(input.spentMicros, "PAID_ENTITLEMENT_SETTLEMENT_AMOUNT");
  const rows = await db.all<AllocationRow>(`SELECT a.lot_id,a.held_micros,l.expires_at
    FROM card_hour_paid_entitlement_hold_allocations a JOIN card_hour_paid_entitlement_lots l ON l.id=a.lot_id
    WHERE a.hold_type=? AND a.hold_id=? AND a.held_micros>0 ORDER BY l.expires_at,a.lot_id`, [input.holdType, input.holdId]);
  let remainingSpend = input.spentMicros;
  let expiredOnReleaseMicros = 0;
  const statements: PaidEntitlementSql[] = [];
  for (const row of rows) {
    const held = Number(row.held_micros);
    const spent = Math.min(remainingSpend, held);
    remainingSpend -= spent;
    const released = held - spent;
    const expired = released > 0 && row.expires_at <= input.now ? released : 0;
    expiredOnReleaseMicros += expired;
    const available = released - expired;
    statements.push(
      { sql: `UPDATE card_hour_paid_entitlement_lots SET held_micros=held_micros-?,spent_micros=spent_micros+?,available_micros=available_micros+?,expired_micros=expired_micros+?,updated_at=?
        WHERE id=? AND held_micros>=?`, values: [held, spent, available, expired, input.now, row.lot_id, held] },
      { sql: "SELECT CASE WHEN changes()=1 THEN 1 ELSE abs(-9223372036854775808) END" },
      { sql: `UPDATE card_hour_paid_entitlement_hold_allocations SET held_micros=0,spent_micros=spent_micros+?,released_micros=released_micros+?,expired_micros=expired_micros+?,updated_at=?
        WHERE hold_type=? AND hold_id=? AND lot_id=? AND held_micros=?`, values: [spent, available, expired, input.now, input.holdType, input.holdId, row.lot_id, held] },
      { sql: "SELECT CASE WHEN changes()=1 THEN 1 ELSE abs(-9223372036854775808) END" },
    );
  }
  return { statements, expiredOnReleaseMicros };
}
