import assert from "node:assert/strict";
import { pbkdf2Sync } from "node:crypto";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { rotateAdminPasswords } from "../scripts/ops/rotate-admin-passwords.mjs";

const OLD_HASH = `pbkdf2-sha256:310000:${Buffer.alloc(16, 1).toString("base64")}:${Buffer.alloc(32, 2).toString("base64")}`;

function verify(password, encoded) {
  const [algorithm, iterations, salt, digest] = encoded.split(":");
  return algorithm === "pbkdf2-sha256"
    && pbkdf2Sync(password, Buffer.from(salt, "base64"), Number(iterations), 32, "sha256").equals(Buffer.from(digest, "base64"));
}

test("dual-control password rotation updates only hashes and writes a private handoff file", async () => {
  const directory = await mkdtemp(join(tmpdir(), "kai-admin-rotation-"));
  const envFile = join(directory, "kai-cloud-app.env");
  const credentialFile = join(directory, "credentials.txt");
  await writeFile(envFile, [
    "KAI_ADMIN_USERNAME=kai-root",
    `KAI_ADMIN_PASSWORD_HASH=${OLD_HASH}`,
    "KAI_ADMIN_DISPLAY_NAME='KAI Cloud Root'",
    "KAI_ADMIN_APPROVER_USERNAME=kai-finance-approver",
    `KAI_ADMIN_APPROVER_PASSWORD_HASH=${OLD_HASH}`,
    "KAI_ADMIN_APPROVER_DISPLAY_NAME='KAI Cloud Finance Approver'",
    "KAI_HOSTING_V2=0",
    "",
  ].join("\n"), { mode: 0o640 });
  const chunks = [Buffer.alloc(24, 3), Buffer.alloc(16, 4), Buffer.alloc(24, 5), Buffer.alloc(16, 6)];
  const result = await rotateAdminPasswords({ envFile, credentialFile, random: () => chunks.shift() });
  assert.deepEqual(result, { status: "rotated", rootUsername: "kai-root", approverUsername: "kai-finance-approver", credentialFile });
  const environment = await readFile(envFile, "utf8");
  const credentials = await readFile(credentialFile, "utf8");
  const rootPassword = credentials.match(/Root 密码：(\S+)/u)?.[1];
  const approverPassword = credentials.match(/财务审批密码：(\S+)/u)?.[1];
  const rootHash = environment.match(/^KAI_ADMIN_PASSWORD_HASH=(.+)$/mu)?.[1];
  const approverHash = environment.match(/^KAI_ADMIN_APPROVER_PASSWORD_HASH=(.+)$/mu)?.[1];
  assert.ok(rootPassword && approverPassword && rootHash && approverHash);
  assert.notEqual(rootPassword, approverPassword);
  assert.ok(verify(rootPassword, rootHash));
  assert.ok(verify(approverPassword, approverHash));
  assert.match(environment, /^KAI_HOSTING_V2=0$/mu);
  assert.equal((await stat(envFile)).mode & 0o777, 0o640);
  assert.equal((await stat(credentialFile)).mode & 0o777, 0o600);
});

test("rotation refuses to overwrite an existing credential handoff", async () => {
  const directory = await mkdtemp(join(tmpdir(), "kai-admin-rotation-refusal-"));
  const envFile = join(directory, "kai-cloud-app.env");
  const credentialFile = join(directory, "credentials.txt");
  await writeFile(envFile, [
    "KAI_ADMIN_USERNAME=kai-root",
    `KAI_ADMIN_PASSWORD_HASH=${OLD_HASH}`,
    "KAI_ADMIN_APPROVER_USERNAME=kai-finance-approver",
    `KAI_ADMIN_APPROVER_PASSWORD_HASH=${OLD_HASH}`,
    "",
  ].join("\n"), { mode: 0o640 });
  await writeFile(credentialFile, "do-not-replace", { mode: 0o600 });
  await assert.rejects(rotateAdminPasswords({ envFile, credentialFile }), /already exists/u);
  assert.equal(await readFile(credentialFile, "utf8"), "do-not-replace");
  assert.match(await readFile(envFile, "utf8"), new RegExp(OLD_HASH.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
});
