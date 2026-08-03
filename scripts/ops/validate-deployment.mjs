#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

import {
  ProductionEnvironmentError,
  validateProductionEnvironment,
  validateStateRoot,
} from "./validate-production-env.mjs";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function redact(value, secrets) {
  let redacted = String(value ?? "");
  for (const secret of secrets) {
    if (secret) redacted = redacted.replaceAll(secret, "[REDACTED]");
  }
  return redacted;
}

function volumeByTarget(service, target) {
  return service.volumes?.find((volume) => volume.target === target);
}

const VALID_IMAGE_REFERENCE = `registry.example.test/kai-cloud-market@sha256:${"1a2b".repeat(16)}`;
const VALID_RELEASE_SHA = "0123456789abcdef0123456789abcdef01234567";
const VALID_CURSOR_SECRET = "6f0d91c82243a7e5b314cd86f05129ea7b8c42d366a9e501fc83bd0471a259de";

function productionEnvironment(overrides = {}) {
  return {
    KAI_CURSOR_SECRET: VALID_CURSOR_SECRET,
    KAI_PUBLIC_ORIGIN: "https://cloud.kai.com",
    KAI_RELEASE_SHA: VALID_RELEASE_SHA,
    KAI_IMAGE_REFERENCE: VALID_IMAGE_REFERENCE,
    KAI_TRUST_PROXY: "1",
    KAI_REQUIRE_HTTPS_WRITES: "1",
    KAI_DB_DIR: "/app/db",
    KAI_MARKET_DATA_DIR: "/app/market",
    ...overrides,
  };
}

function assertEnvironmentRejected(overrides, expectedMessage) {
  let rejection;
  try {
    validateProductionEnvironment(productionEnvironment(overrides));
  } catch (error) {
    rejection = error;
  }
  assert(rejection instanceof ProductionEnvironmentError, `invalid environment was accepted: ${JSON.stringify(Object.keys(overrides))}`);
  assert(rejection.message.includes(expectedMessage), `environment rejection did not identify ${expectedMessage}`);
}

function assertStateRootRejected(value) {
  let rejection;
  try {
    validateStateRoot(value);
  } catch (error) {
    rejection = error;
  }
  assert(rejection instanceof ProductionEnvironmentError, "unsafe KAI_STATE_ROOT was accepted");
  assert(rejection.message.includes("KAI_STATE_ROOT"), "state-root rejection did not identify KAI_STATE_ROOT");
}

function validateNegativeEnvironmentCases() {
  assertEnvironmentRejected({ KAI_CURSOR_SECRET: "weak" }, "KAI_CURSOR_SECRET");
  assertEnvironmentRejected({ KAI_CURSOR_SECRET: "replace-with-at-least-32-random-characters" }, "KAI_CURSOR_SECRET");
  assertEnvironmentRejected({ KAI_IMAGE_REFERENCE: "registry.example.test/kai-cloud-market:latest" }, "KAI_IMAGE_REFERENCE");
  assertEnvironmentRejected({ KAI_IMAGE_REFERENCE: `registry.example.test/kai-cloud-market@sha256:${"0".repeat(64)}` }, "KAI_IMAGE_REFERENCE");
  assertEnvironmentRejected({ KAI_RELEASE_SHA: "not-a-full-git-sha" }, "KAI_RELEASE_SHA");
  assertEnvironmentRejected({ KAI_RELEASE_SHA: "0".repeat(40) }, "KAI_RELEASE_SHA");
  assertEnvironmentRejected({ KAI_PUBLIC_ORIGIN: "http://cloud.kai.com" }, "KAI_PUBLIC_ORIGIN");
  assertEnvironmentRejected({ KAI_PUBLIC_ORIGIN: "https://cloud.kai.com/market" }, "KAI_PUBLIC_ORIGIN");
  assertEnvironmentRejected({ KAI_PUBLIC_ORIGIN: "https://cloud.kai.com/" }, "KAI_PUBLIC_ORIGIN");
  assertEnvironmentRejected({ KAI_TRUST_PROXY: "0" }, "KAI_TRUST_PROXY");
  assertEnvironmentRejected({ KAI_REQUIRE_HTTPS_WRITES: "0" }, "KAI_REQUIRE_HTTPS_WRITES");
  assertEnvironmentRejected({ KAI_DB_DIR: "/" }, "KAI_DB_DIR");
  assertStateRootRejected("/");
  assertStateRootRejected("relative/kai-cloud-3050");
  assertStateRootRejected("/opt/kai-cloud-3050/../other");
}

async function main() {
  const projectRoot = resolve(import.meta.dirname, "../..");
  const composePath = resolve(projectRoot, "deploy/compose.production.yml");
  validateNegativeEnvironmentCases();

  const validateCurrentEnvironment = process.argv.includes("--current-env");
  if (validateCurrentEnvironment
    && process.env.KAI_IMAGE_REFERENCE
    && process.env.KAI_IMAGE_REFERENCE !== process.env.KAI_IMAGE) {
    throw new ProductionEnvironmentError(["KAI_IMAGE_REFERENCE, when present on the host, must exactly match KAI_IMAGE"]);
  }
  const candidateEnvironment = validateCurrentEnvironment
    ? productionEnvironment({
      KAI_CURSOR_SECRET: process.env.KAI_CURSOR_SECRET,
      KAI_PUBLIC_ORIGIN: process.env.KAI_PUBLIC_ORIGIN,
      KAI_RELEASE_SHA: process.env.KAI_RELEASE_SHA,
      KAI_IMAGE_REFERENCE: process.env.KAI_IMAGE,
      KAI_TRUST_PROXY: process.env.KAI_TRUST_PROXY,
      KAI_REQUIRE_HTTPS_WRITES: process.env.KAI_REQUIRE_HTTPS_WRITES,
    })
    : productionEnvironment();
  validateProductionEnvironment(candidateEnvironment);
  const stateRoot = validateCurrentEnvironment
    ? validateStateRoot(process.env.KAI_STATE_ROOT ?? "/opt/kai-cloud-3050", { checkFilesystem: true })
    : validateStateRoot("/opt/kai-cloud-validation");
  const compose = spawnSync("docker", [
    "compose",
    "--profile",
    "ops",
    "-f",
    composePath,
    "config",
    "--format",
    "json",
  ], {
    cwd: projectRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      KAI_IMAGE: candidateEnvironment.KAI_IMAGE_REFERENCE,
      KAI_RELEASE_SHA: candidateEnvironment.KAI_RELEASE_SHA,
      KAI_PUBLIC_ORIGIN: candidateEnvironment.KAI_PUBLIC_ORIGIN,
      KAI_CURSOR_SECRET: candidateEnvironment.KAI_CURSOR_SECRET,
      KAI_TRUST_PROXY: candidateEnvironment.KAI_TRUST_PROXY,
      KAI_REQUIRE_HTTPS_WRITES: candidateEnvironment.KAI_REQUIRE_HTTPS_WRITES,
      KAI_STATE_ROOT: stateRoot,
    },
  });
  if (compose.status !== 0) {
    throw new Error(`docker compose config failed: ${redact(compose.stderr || compose.stdout, [candidateEnvironment.KAI_CURSOR_SECRET])}`);
  }
  const configuration = JSON.parse(compose.stdout);
  const { app, backup, "market-update": marketUpdate } = configuration.services;
  assert(app && backup && marketUpdate, "compose must define app, backup, and market-update services");
  for (const [name, service] of Object.entries({ app, backup, marketUpdate })) {
    assert(service.image === candidateEnvironment.KAI_IMAGE_REFERENCE, `${name} must use the same immutable image digest`);
    assert(service.read_only === true, `${name} root filesystem must be read-only`);
    assert(service.user === "1000:1000", `${name} must use the fixed non-root UID/GID`);
    assert(service.cap_drop?.includes("ALL"), `${name} must drop all Linux capabilities`);
    assert(service.security_opt?.includes("no-new-privileges:true"), `${name} must set no-new-privileges`);
    assert(Number(service.mem_limit) > 0 && Number(service.cpus) > 0 && Number(service.pids_limit) > 0, `${name} must have memory, CPU, and PID limits`);
    assert(service.logging?.options?.["max-size"] && service.logging?.options?.["max-file"], `${name} must rotate container logs`);
  }
  assert(app.ports?.length === 1 && app.ports[0].host_ip === "127.0.0.1", "app port must bind loopback only");
  assert(app.healthcheck?.test?.join(" ").includes("/api/live"), "app healthcheck must use /api/live");
  assert(app.environment.KAI_DB_DIR === "/app/db", "app must use the isolated KAI_DB_DIR");
  assert(app.environment.KAI_TRUST_PROXY === "1", "loopback-only app must trust the configured reverse proxy");
  assert(app.environment.KAI_REQUIRE_HTTPS_WRITES === "1", "production writes must require HTTPS");
  assert(app.environment.KAI_PUBLIC_ORIGIN === candidateEnvironment.KAI_PUBLIC_ORIGIN, "app must receive the canonical HTTPS origin");
  assert(app.environment.KAI_CURSOR_SECRET === candidateEnvironment.KAI_CURSOR_SECRET, "app must receive the validated cursor secret");
  assert(app.environment.KAI_RELEASE_SHA === candidateEnvironment.KAI_RELEASE_SHA, "app must expose the validated release SHA");
  assert(app.environment.KAI_IMAGE_REFERENCE === candidateEnvironment.KAI_IMAGE_REFERENCE, "app must receive its immutable image reference for the startup gate");
  assert(volumeByTarget(app, "/app/db") && !volumeByTarget(app, "/app/db").read_only, "app requires a writable /app/db mount");
  assert(volumeByTarget(app, "/app/market")?.read_only === true, "app market mount must be read-only");

  assert(marketUpdate.volumes?.length === 1, "market update must have exactly one host mount");
  assert(volumeByTarget(marketUpdate, "/app/market") && !volumeByTarget(marketUpdate, "/app/market").read_only, "market update requires only writable /app/market");
  assert(!volumeByTarget(marketUpdate, "/app/db"), "market update must never mount the business database");

  assert(backup.network_mode === "none", "backup must have networking disabled");
  assert(volumeByTarget(backup, "/app/db") && !volumeByTarget(backup, "/app/db").read_only, "backup requires database access for VACUUM INTO");
  assert(volumeByTarget(backup, "/app/market")?.read_only === true, "backup market mount must be read-only");
  assert(volumeByTarget(backup, "/app/backups") && !volumeByTarget(backup, "/app/backups").read_only, "backup output mount must be writable");

  const [updateUnit, backupUnit, updateTimer, backupTimer, updateRunner, backupRunner, Dockerfile, productionEntrypoint, runbook] = await Promise.all([
    readFile(resolve(projectRoot, "deploy/kai-cloud-market-update.service"), "utf8"),
    readFile(resolve(projectRoot, "deploy/kai-cloud-backup.service"), "utf8"),
    readFile(resolve(projectRoot, "deploy/kai-cloud-market-update.timer"), "utf8"),
    readFile(resolve(projectRoot, "deploy/kai-cloud-backup.timer"), "utf8"),
    readFile(resolve(projectRoot, "deploy/kai-cloud-market-update-run.sh"), "utf8"),
    readFile(resolve(projectRoot, "deploy/kai-cloud-backup-run.sh"), "utf8"),
    readFile(resolve(projectRoot, "Dockerfile"), "utf8"),
    readFile(resolve(projectRoot, "scripts/ops/production-entrypoint.sh"), "utf8"),
    readFile(resolve(projectRoot, "deploy/PRODUCTION_RUNBOOK.md"), "utf8"),
  ]);
  for (const [name, unit] of Object.entries({ updateUnit, backupUnit })) {
    assert(unit.includes("OnFailure=kai-cloud-ops-alert@%n.service"), `${name} must have a failure hook`);
    assert(unit.includes("/usr/bin/flock --nonblock"), `${name} must prevent concurrent runs`);
    assert(unit.includes("/usr/bin/timeout --signal=TERM --kill-after=15s 300s"), `${name} must have a 300 second runtime boundary`);
    assert(unit.includes("EnvironmentFile=/etc/kai-cloud/kai-cloud-release.env"), `${name} must read the immutable release environment`);
  }
  assert(updateTimer.includes("06:00:00 Asia/Shanghai") && updateTimer.includes("Persistent=true"), "market update timer must persist the 06:00 China schedule");
  assert(backupTimer.includes("*:15:00 Asia/Shanghai") && backupTimer.includes("Persistent=true"), "backup timer must run hourly and persist missed runs");
  for (const [name, runner] of Object.entries({ updateRunner, backupRunner })) {
    assert(runner.includes("@sha256:[0-9a-fA-F]{64}$"), `${name} must reject mutable image tags`);
    assert(runner.includes("KAI_RELEASE_SHA must be a full 40- or 64-character Git object ID"), `${name} must validate the release SHA`);
  }
  assert(Dockerfile.includes("/app/scripts/ops ./scripts/ops"), "runtime image must contain operations scripts");
  assert(Dockerfile.includes("/api/live"), "runtime image healthcheck must use /api/live");
  assert(Dockerfile.includes('ENTRYPOINT ["/bin/sh", "/app/scripts/ops/production-entrypoint.sh"]'), "runtime image must invoke the production environment gate before its command");
  assert(productionEntrypoint.includes("node:scripts/model-market/cli.mjs|node:scripts/ops/backup-marketplace.mjs"), "production entrypoint may bypass the app gate only for the two supported maintenance commands");
  assert(productionEntrypoint.indexOf("validate-production-env.mjs --check-filesystem") < productionEntrypoint.lastIndexOf('exec "$@"'), "production entrypoint must validate before starting the default server command");
  assert(runbook.includes("/api/session") && runbook.includes("每分钟 30 次、突发 10 次"), "runbook must require a concrete reverse-proxy rate limit for /api/session");
  assert(runbook.includes("POST /api/*") && runbook.includes("每分钟 20 次、突发 5 次"), "runbook must require a concrete reverse-proxy rate limit for API writes");
  assert(runbook.includes("API 守卫会为 API 请求输出结构化日志") && runbook.includes("不记录表单正文、Cookie、会话令牌、CSRF 值或供应商原始报价"), "runbook must accurately describe structured API logs and their redaction boundary");
  assert(runbook.includes("首次安装时数据库尚不存在") && runbook.indexOf("请求 `/api/ready`") < runbook.indexOf("第一次备份"), "runbook must initialize the database before the first-install backup");
  assert(runbook.includes("升级已有实例时顺序相反") && runbook.includes("替换应用前创建并异地同步一致性备份"), "runbook must back up existing production data before an upgrade");

  return {
    status: "ok",
    checks: [
      "Compose parsed successfully with all ops profiles",
      "market updater has no database mount",
      "database, market, and backup boundaries are distinct",
      "loopback binding, limits, log rotation, and healthcheck are enforced",
      "startup gate rejects weak secrets, mutable images, invalid release IDs, invalid origins, unsafe paths, and disabled HTTPS/proxy flags",
      "systemd locks, timeouts, failure hooks, and schedules are present",
      "runtime image contains backup tools and uses liveness health",
    ],
  };
}

main()
  .then((result) => process.stdout.write(`${JSON.stringify(result)}\n`))
  .catch((error) => {
    process.stderr.write(`DEPLOYMENT_VALIDATION_FAILED: ${error.message}\n`);
    process.exitCode = 1;
  });
