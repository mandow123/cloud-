import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import {
  assertCleanGitStatus,
  buildReleaseEnvironment,
  buildReleaseRecord,
  parseImmutableImageReference,
  parseReleaseEnvironment,
  selectRepositoryDigest,
  validateImageInspection,
} from "../scripts/ops/release-tooling.mjs";
import { validateLocalImage } from "../scripts/ops/validate-local-image.mjs";

const projectRoot = resolve(import.meta.dirname, "..");
const releaseSha = "0123456789abcdef0123456789abcdef01234567";
const digest = "a1b2c3d4".repeat(8);
const imageReference = `127.0.0.1:5443/kai-cloud-market@sha256:${digest}`;

test("immutable image references and clean Git state fail closed", () => {
  assert.equal(parseImmutableImageReference(imageReference).reference, imageReference);
  assert.throws(() => parseImmutableImageReference(`127.0.0.1:5443/kai-cloud-market:${releaseSha}`), /repository@sha256/);
  assert.throws(() => parseImmutableImageReference(`HTTPS:\/\/example.test\/image@sha256:${digest}`), /repository/);
  assert.throws(() => parseImmutableImageReference(`example.test/image@sha256:${digest.toUpperCase()}`), /lowercase/);
  assert.throws(() => assertCleanGitStatus("?? unexpected.txt\n"), /dirty Git worktree/);
  assert.doesNotThrow(() => assertCleanGitStatus(""));
});

test("promotion artifacts keep immutable current and previous releases without secrets", () => {
  const previousReference = `127.0.0.1:5443/kai-cloud-market@sha256:${"b2c3d4e5".repeat(8)}`;
  const previousSha = "89abcdef0123456789abcdef0123456789abcdef";
  const previousEnvironment = buildReleaseEnvironment({ imageReference: previousReference, releaseSha: previousSha, platform: "linux/amd64" });
  const previous = parseReleaseEnvironment(previousEnvironment);
  const environment = buildReleaseEnvironment({ imageReference, releaseSha, platform: "linux/amd64" });
  assert.match(environment, new RegExp(`KAI_IMAGE=${imageReference}`));
  assert.match(environment, /KAI_STATE_ROOT=\/opt\/kai-cloud-3051/);
  assert.doesNotMatch(environment, /PASSWORD|TOKEN|CURSOR_SECRET/);
  assert.throws(() => parseReleaseEnvironment(`${environment}KAI_QIXIANG_PAY_ENABLED=1\n`), /unexpected/);
  assert.throws(() => parseReleaseEnvironment(environment.replace(`KAI_RELEASE_SHA=${releaseSha}`, `KAI_RELEASE_SHA=${releaseSha}\nKAI_RELEASE_SHA=${releaseSha}`)), /duplicate/);
  assert.throws(() => parseReleaseEnvironment(environment.replace("KAI_STATE_ROOT=/opt/kai-cloud-3051\n", "")), /missing/);
  assert.throws(() => parseReleaseEnvironment(environment.replace("KAI_STATE_ROOT=/opt/kai-cloud-3051", "KAI_STATE_ROOT=/tmp/unsafe")), /state root/);
  const record = buildReleaseRecord({
    imageReference,
    releaseSha,
    platform: "linux/amd64",
    sourceTag: `127.0.0.1:5443/kai-cloud-market:${releaseSha}`,
    previous,
    createdAt: "2026-08-03T06:00:00.000Z",
  });
  assert.equal(record.rollback.available, true);
  assert.equal(record.rollback.imageReference, previousReference);
  assert.equal(record.current.imageReference, imageReference);
});

test("local image verification binds RepoDigest, revision and OS/architecture", () => {
  const inspection = {
    RepoDigests: [imageReference],
    Config: { Labels: { "org.opencontainers.image.revision": releaseSha } },
    Os: "linux",
    Architecture: "amd64",
  };
  assert.equal(selectRepositoryDigest(inspection.RepoDigests, "127.0.0.1:5443/kai-cloud-market"), imageReference);
  assert.deepEqual(validateImageInspection(inspection, { imageReference, releaseSha, platform: "linux/amd64" }), {
    imageReference,
    releaseSha,
    platform: "linux/amd64",
  });
  assert.throws(() => validateImageInspection({ ...inspection, RepoDigests: [] }, { imageReference, releaseSha, platform: "linux/amd64" }), /RepoDigests/);
  assert.throws(() => validateImageInspection({ ...inspection, Architecture: "arm64" }, { imageReference, releaseSha, platform: "linux/amd64" }), /OS\/architecture/);

  const commands = [];
  const result = validateLocalImage({
    imageReference,
    releaseSha,
    platform: "linux/amd64",
    commandRunner(_binary, args) {
      commands.push(args);
      if (args[0] === "version") return "linux/amd64";
      return JSON.stringify([inspection]);
    },
  });
  assert.equal(result.imageReference, imageReference);
  assert.deepEqual(commands.map((args) => args[0]), ["version", "image"]);
});

test("registry, application, and systemd templates enforce bounded immutable operation", async () => {
  const [registryCompose, registryConfig, productionCompose, Dockerfile, updater, backup, promotion, updateUnit, backupUnit, updateTimer, backupTimer, schemaGateRunner] = await Promise.all([
    readFile(resolve(projectRoot, "deploy/compose.registry.yml"), "utf8"),
    readFile(resolve(projectRoot, "deploy/registry/config.yml"), "utf8"),
    readFile(resolve(projectRoot, "deploy/compose.production.yml"), "utf8"),
    readFile(resolve(projectRoot, "Dockerfile"), "utf8"),
    readFile(resolve(projectRoot, "deploy/kai-cloud-market-update-run.sh"), "utf8"),
    readFile(resolve(projectRoot, "deploy/kai-cloud-backup-run.sh"), "utf8"),
    readFile(resolve(projectRoot, "scripts/ops/promote-release.mjs"), "utf8"),
    readFile(resolve(projectRoot, "deploy/kai-cloud-market-update.service"), "utf8"),
    readFile(resolve(projectRoot, "deploy/kai-cloud-backup.service"), "utf8"),
    readFile(resolve(projectRoot, "deploy/kai-cloud-market-update.timer"), "utf8"),
    readFile(resolve(projectRoot, "deploy/kai-cloud-backup.timer"), "utf8"),
    readFile(resolve(projectRoot, "scripts/ops/run-production-schema-gate.sh"), "utf8"),
  ]);
  assert.match(registryCompose, /registry:3\.1\.1@sha256:1be55279f18a2fe1a74edf2664cac61c1bea305b7b4642dab412e7affdcb3e33/);
  assert.match(registryCompose, /127\.0\.0\.1:\$\{KAI_REGISTRY_PORT:-5443\}:5000/);
  assert.match(registryCompose, /\/opt\/kai-cloud-registry/);
  assert.match(registryConfig, /certificate: \/certs\/registry\.crt/);
  assert.match(registryConfig, /path: \/auth\/htpasswd/);
  assert.equal((productionCompose.match(/pull_policy: always/g) ?? []).length, 4);
  assert.match(productionCompose, /schema-gate:[\s\S]*network_mode: none[\s\S]*environment: \*kai-app-environment[\s\S]*volumes: \*kai-app-volumes/);
  assert.match(schemaGateRunner, /--project-name kai-cloud-schema-gate/);
  assert.match(schemaGateRunner, /exec env -i/);
  assert.match(schemaGateRunner, /\/usr\/bin\/docker compose/);
  assert.match(schemaGateRunner, /\/etc\/kai-cloud\/kai-cloud-schema-gate\.compose\.yml/);
  assert.match(schemaGateRunner, /\/usr\/local\/lib\/kai-cloud\/run-production-schema-gate\.sh/);
  assert.match(schemaGateRunner, /application env must not redefine release-owned keys/);
  assert.ok(schemaGateRunner.indexOf('--env-file "$APP_ENV"') < schemaGateRunner.indexOf('--env-file "$CANDIDATE_RELEASE_ENV"'));
  assert.match(schemaGateRunner, /run --rm --no-deps schema-gate/);
  assert.match(schemaGateRunner, /schema gate command is not allowlisted/);
  assert.match(Dockerfile, /ARG KAI_RELEASE_SHA/);
  assert.match(Dockerfile, /org\.opencontainers\.image\.revision="\$\{KAI_RELEASE_SHA\}"/);
  assert.match(Dockerfile, /\/app\/drizzle \.\/drizzle/);
  assert.match(productionCompose, /KAI_ENVIRONMENT: LIVE/);
  const strictRunnerPattern = /\^\[a-z0-9\]\+\(\[\._-\]\[a-z0-9\]\+\)\*\(:\[0-9\]\+\)\?\(\/\[a-z0-9\]\+\(\[\._-\]\[a-z0-9\]\+\)\*\)\*@sha256:\[0-9a-f\]\{64\}\$/;
  assert.match(updater, strictRunnerPattern);
  assert.match(backup, strictRunnerPattern);
  assert.match(backup, /KAI_BACKUP_SHARED_LOCK="\$KAI_STATE_ROOT\/backups\/\.kai-cloud-backup\.lock"/);
  assert.match(backup, /\/usr\/bin\/flock --nonblock 9/);
  assert.match(promotion, /git", \["archive", "--format=tar", "HEAD"\]/);
  assert.match(promotion, /"image", "push", sourceTag/);
  assert.match(promotion, /selectRepositoryDigest/);
  for (const unit of [updateUnit, backupUnit]) {
    assert.match(unit, /Type=oneshot/);
    assert.match(unit, /TimeoutStartSec=330/);
    assert.match(unit, /\/usr\/bin\/timeout --signal=TERM --kill-after=15s 300s/);
    assert.match(unit, /OnFailure=kai-cloud-ops-alert@%n\.service/);
    assert.doesNotMatch(unit, /RuntimeMaxSec=/);
  }
  assert.match(updateTimer, /OnCalendar=\*-\*-\* 06:00:00 Asia\/Shanghai/);
  assert.match(backupTimer, /OnCalendar=\*-\*-\* \*:15:00 Asia\/Shanghai/);
  assert.match(updateTimer, /Persistent=true/);
  assert.match(backupTimer, /Persistent=true/);
});
