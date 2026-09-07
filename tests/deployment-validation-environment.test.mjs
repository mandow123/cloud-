import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { devNull } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");
const cleanEnvironment = () => Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith("KAI_")));

async function withComposeProbe(run) {
  const directory = await mkdtemp(join(root, ".deployment-validation-regression-"));
  const checker = join(directory, "compose-probe.mjs");
  try {
    await writeFile(checker, `#!${process.execPath}
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { devNull } from "node:os";
const args = process.argv.slice(2);
assert.equal(args[args.indexOf("--env-file") + 1], devNull);
assert.deepEqual(args.slice(-3), ["config", "--format", "json"]);
const compose = readFileSync(args[args.indexOf("-f") + 1], "utf8");
const required = [...compose.matchAll(/\\$\\{([A-Z_][A-Z_0-9]*):\\?/g)].map(match => match[1]);
assert.ok(required.includes("KAI_ADMIN_PASSWORD_HASH"));
for (const key of required) assert.ok(process.env[key], "MISSING_COMPOSE_INPUT:" + key);
assert.equal(process.env.KAI_ADMIN_USERNAME, "kai-compose-validation-only");
assert.match(process.env.KAI_ADMIN_PASSWORD_HASH, /^pbkdf2-sha256:310000:/);
assert.equal(process.env.KAI_QIXIANG_PAY_ENABLED, "0");
for (const key of ["KAI_ALIPAY_PRIVATE_KEY", "KAI_SUPPLY_OPS_TOKEN", "KAI_SSH_PROVISIONER_TOKEN", "KAI_MANUAL_DELIVERY_INTAKE", "KAI_ADMIN_APPROVER_DISPLAY_NAME"]) assert.equal(process.env[key], undefined, "INHERITED_OPERATOR_INPUT:" + key);
// Stop at the subprocess boundary: this probe does not claim Compose rendered.
process.stderr.write("COMPOSE_INPUT_CONTRACT_VERIFIED " + process.env.KAI_ADMIN_PASSWORD_HASH);
process.exitCode = 42;
`, { mode: 0o755 });
    await run(checker);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("offline deployment CLI supplies every required Compose input without operator credentials", async () => {
  await withComposeProbe(async checker => {
    for (const inherited of [{}, {
      KAI_ADMIN_USERNAME: "operator-must-not-be-used",
      KAI_ADMIN_PASSWORD_HASH: "operator-hash-must-not-be-used",
      KAI_ALIPAY_PRIVATE_KEY: "synthetic-private-key-must-not-be-used",
      KAI_SUPPLY_OPS_TOKEN: "synthetic-token-must-not-be-used",
      KAI_SSH_PROVISIONER_TOKEN: "synthetic-provisioner-must-not-be-used",
      KAI_MANUAL_DELIVERY_INTAKE: "1",
      KAI_ADMIN_APPROVER_DISPLAY_NAME: "operator-display-must-not-be-used",
    }]) {
      const result = spawnSync(process.execPath, ["scripts/ops/validate-deployment.mjs"], {
        cwd: root, encoding: "utf8", env: { ...cleanEnvironment(), ...inherited, KAI_COMPOSE_BIN: checker },
      });
      assert.equal(result.status, 1);
      assert.match(result.stderr, /COMPOSE_INPUT_CONTRACT_VERIFIED \[REDACTED\]/);
      assert.doesNotMatch(result.stderr, /MISSING_COMPOSE_INPUT|INHERITED_OPERATOR_INPUT|pbkdf2-sha256|must-not-be-used/);
      assert.equal(result.stdout, "");
    }
  });
});

test("current-environment deployment validation never borrows the offline administrator fixture", () => {
  const result = spawnSync(process.execPath, ["scripts/ops/validate-deployment.mjs", "--current-env"], {
    cwd: root, encoding: "utf8", env: {
      ...cleanEnvironment(),
      KAI_COMPOSE_BIN: devNull,
      KAI_CURSOR_SECRET: "synthetic-current-validation-secret-2026",
      KAI_PUBLIC_ORIGIN: "https://cloud.kai.com",
      KAI_RELEASE_SHA: "0123456789abcdef0123456789abcdef01234567",
      KAI_IMAGE: `registry.example.test/kai-cloud-market@sha256:${"a".repeat(64)}`,
      KAI_TRUST_PROXY: "1", KAI_REQUIRE_HTTPS_WRITES: "1",
      KAI_HOSTING_V2_SETUP: "1",
      KAI_HOSTING_APPROVED_IMAGES: `registry.example.test/workload@sha256:${"b".repeat(64)}`,
      KAI_HOSTING_TERMS_VERSION: "KAI_HOSTING_TERMS_2026_08",
    },
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /KAI_ADMIN_USERNAME/);
  assert.match(result.stderr, /KAI_ADMIN_PASSWORD_HASH/);
  assert.doesNotMatch(result.stderr, /docker compose config|kai-compose-validation-only/);
});
