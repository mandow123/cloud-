import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  MARKETPLACE_MIGRATION_CHECKSUM,
  MARKETPLACE_MIGRATION_VERSION,
  marketplaceRegionExpansionStatements,
  marketplaceSchemaStatements,
} from "../db/schema.ts";

const OLD_CHECKSUM = "758924113b3f07d65f1db51bc7007e30d503a40dac720475dce19df6403bc2a6";

test("marketplace v4 adds 全国 without rewriting existing requests or breaking quote foreign keys", () => {
  const db = new DatabaseSync(":memory:", { enableForeignKeyConstraints: true });
  const oldSchema = marketplaceSchemaStatements.map((statement) => (
    statement.replace(", '全国'", "")
  ));
  try {
    for (const statement of oldSchema) db.exec(statement);
    db.prepare("INSERT INTO marketplace_schema_migrations(version,checksum,applied_at) VALUES(3,?,?)")
      .run(OLD_CHECKSUM, "2026-08-19T00:00:00.000Z");
    db.prepare(`INSERT INTO marketplace_requests_v2(
      id,owner_actor_id,idempotency_key,payload_hash,visibility,request_type,
      kind,title,category,region,pricing_unit,quantity,duration_hours,
      delivery_date,summary,offered_json,wanted_json,cash_direction,
      cash_amount,status,created_at,updated_at,version
    ) VALUES(?,?,?,?,? ,?,?,?,?,? ,?,?,?,?,? ,?,?,?,?,? ,?,?,?)`).run(
      "KAI-R-MIGRATION-EXISTING", "buyer-existing", "existing-idempotency", "existing-hash", "market",
      "procurement", "rental", "既有 H100 需求", "gpu", "北京", "卡时", 1, 24,
      "2026-09-01", "既有记录必须逐字段保留。", null, null, "none", null, "已记录",
      "2026-08-19T00:00:00.000Z", "2026-08-19T00:00:00.000Z", 3,
    );
    db.prepare(`INSERT INTO marketplace_quotes_v2(
      id,supplier_actor_id,request_owner_actor_id,idempotency_key,payload_hash,
      demand_id,demand_title,raw_unit_price,standardized_unit_price,pricing_unit,
      currency,lead_time,valid_days,valid_until,raw_scope_note,
      standardized_scope_note,standardization_version,standardization_note,
      supplier_status,normalized_status,created_at
    ) VALUES(?,?,?,?,? ,?,?,?,?,? ,?,?,?,?,? ,?,?,?,?,?,?)`).run(
      "KAI-Q-MIGRATION-EXISTING", "supplier-existing", "buyer-existing", "quote-idempotency", "quote-hash",
      "KAI-R-MIGRATION-EXISTING", "既有 H100 需求", 10, 10, "卡时", "CNY", "48 小时内", 7,
      "2026-09-01T00:00:00.000Z", "既有原始范围", "既有标准范围", "kai-standard-v1", "既有标准化说明",
      "已提交", "已标准化", "2026-08-19T00:00:00.000Z",
    );

    db.exec("BEGIN IMMEDIATE");
    for (const statement of marketplaceRegionExpansionStatements) db.exec(statement);
    db.prepare("INSERT INTO marketplace_schema_migrations(version,checksum,applied_at) VALUES(?,?,?)")
      .run(MARKETPLACE_MIGRATION_VERSION, MARKETPLACE_MIGRATION_CHECKSUM, "2026-08-20T00:00:00.000Z");
    db.exec("COMMIT");

    const existing = db.prepare("SELECT id,region,summary,version FROM marketplace_requests_v2 WHERE id=?")
      .get("KAI-R-MIGRATION-EXISTING");
    assert.deepEqual({ ...existing }, {
      id: "KAI-R-MIGRATION-EXISTING",
      region: "北京",
      summary: "既有记录必须逐字段保留。",
      version: 3,
    });
    assert.equal(db.prepare("SELECT demand_id FROM marketplace_quotes_v2 WHERE id=?").get("KAI-Q-MIGRATION-EXISTING").demand_id, "KAI-R-MIGRATION-EXISTING");
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);

    db.prepare(`INSERT INTO marketplace_requests_v2(
      id,owner_actor_id,idempotency_key,payload_hash,visibility,request_type,
      kind,title,category,region,pricing_unit,quantity,duration_hours,
      delivery_date,summary,offered_json,wanted_json,cash_direction,
      cash_amount,status,created_at,updated_at,version
    ) VALUES(?,?,?,?,? ,?,?,?,?,? ,?,?,?,?,? ,?,?,?,?,? ,?,?,?)`).run(
      "KAI-R-MIGRATION-NATIONWIDE", "buyer-new", "nationwide-idempotency", "nationwide-hash", "market",
      "procurement", "rental", "全国人工交付询价", "gpu", "全国", "卡时", 1, 3,
      "2026-09-02", "实际机房地域在询价时确认。", null, null, "none", null, "已记录",
      "2026-08-20T00:00:00.000Z", "2026-08-20T00:00:00.000Z", 1,
    );
    assert.equal(db.prepare("SELECT region FROM marketplace_requests_v2 WHERE id=?").get("KAI-R-MIGRATION-NATIONWIDE").region, "全国");
  } finally {
    db.close();
  }
});
