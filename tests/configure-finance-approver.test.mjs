import assert from "node:assert/strict";
import { pbkdf2Sync } from "node:crypto";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { configureFinanceApprover, createFinanceApproverCredential } from "../scripts/ops/configure-finance-approver.mjs";

test("finance approver credentials use the production PBKDF2 format", () => {
  const chunks = [Buffer.alloc(24, 7), Buffer.alloc(16, 9)];
  const credential = createFinanceApproverCredential("kai-finance-approver", "KAI Finance", { random: () => chunks.shift() });
  const [algorithm, iterations, salt, digest] = credential.passwordHash.split(":");
  assert.equal(algorithm, "pbkdf2-sha256");
  assert.equal(iterations, "310000");
  assert.equal(Buffer.from(digest, "base64").length, 32);
  assert.deepEqual(pbkdf2Sync(credential.password, Buffer.from(salt, "base64"), Number(iterations), 32, "sha256"), Buffer.from(digest, "base64"));
});

test("finance approver configuration preserves the app environment and never overwrites credentials", async () => {
  const directory = await mkdtemp(join(tmpdir(), "kai-finance-approver-"));
  const envFile = join(directory, "app.env");
  const credentialFile = join(directory, "credential.txt");
  try {
    await writeFile(envFile, "KAI_ADMIN_USERNAME=kai-root\nKAI_HOSTING_V2=0\n", { mode: 0o640 });
    const result = await configureFinanceApprover({ envFile, credentialFile, username: "kai-finance-approver", displayName: "KAI Cloud Finance Approver" });
    assert.equal(result.status, "configured");
    const environment = await readFile(envFile, "utf8");
    assert.match(environment, /KAI_ADMIN_USERNAME=kai-root/u);
    assert.match(environment, /KAI_HOSTING_V2=0/u);
    assert.match(environment, /KAI_ADMIN_APPROVER_USERNAME=kai-finance-approver/u);
    assert.match(environment, /KAI_ADMIN_APPROVER_PASSWORD_HASH=pbkdf2-sha256:310000:/u);
    const credential = await readFile(credentialFile, "utf8");
    assert.match(credential, /账号：kai-finance-approver/u);
    assert.match(credential, /密码：[A-Za-z0-9_-]{32}/u);
    assert.equal((await stat(credentialFile)).mode & 0o777, 0o600);
    await assert.rejects(configureFinanceApprover({ envFile, credentialFile: join(directory, "second.txt"), username: "another-approver", displayName: "Another Approver" }), /already configured/u);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
