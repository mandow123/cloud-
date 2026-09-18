import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync,readFileSync,rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { paymentFixture } from "./helpers/payment-fixture.mjs";

test("recovery CLI scans source read-only and writes only a newly created rehearsal copy",async()=>{
  const directory=mkdtempSync(join(tmpdir(),"kai-payment-recovery-"));
  const source=join(directory,"source.sqlite");
  const copyDirectory=join(directory,"new-drill");
  const f=await paymentFixture();
  try {
    await f.legacyDebit();
    f.db.exec("UPDATE supply_trial_orders SET expires_at='2020-01-01T00:00:00.000Z'");
    f.db.prepare("VACUUM INTO ?").run(source);
    const digest=()=>createHash("sha256").update(readFileSync(source)).digest("hex");
    const before=digest();
    const args=["--experimental-transform-types","scripts/ops/supply-payment-recovery.mjs","--source",source];
    const scan=JSON.parse(execFileSync(process.execPath,args,{encoding:"utf8"}));
    assert.equal(scan.mode,"READ_ONLY_SCAN");assert.equal(scan.records[0].decision,"REVERSE_UNDELIVERED");
    assert.equal(digest(),before);
    const repair=[...args,"--copy-directory",copyDirectory,"--order-id",f.order.id,"--fingerprint",scan.records[0].fingerprint,"--operator","fixture-operator"];
    const evidence=JSON.parse(execFileSync(process.execPath,repair,{encoding:"utf8"}));
    assert.equal(evidence.mode,"COPY_REHEARSAL_ONLY");assert.equal(evidence.integrity,"ok");assert.equal(evidence.applied,true);
    assert.equal(digest(),before,"source SQLite bytes are unchanged");
    const db=new DatabaseSync(join(copyDirectory,"recovery-copy.sqlite"),{readOnly:true});
    assert.equal(db.prepare("SELECT status FROM card_hour_order_payments").get().status,"REFUNDED");db.close();
    assert.throws(()=>execFileSync(process.execPath,repair,{stdio:"pipe"}),/COPY_DIRECTORY_MUST_BE_NEW/);
  } finally {f.db.close();rmSync(directory,{recursive:true,force:true});}
});
