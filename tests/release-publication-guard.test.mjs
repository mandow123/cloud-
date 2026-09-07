import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm, symlink, realpath } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { assertUnpublishedRelease, validateReleaseId } from "../scripts/ops/release-publication-guard.mjs";
import { buildReleaseEnvironment, buildReleaseRecord } from "../scripts/ops/release-tooling.mjs";

const releaseSha = "a".repeat(40);
const previousSha = "b".repeat(40);
const releaseId = "cloud-pc/2026.09.06.1";
const tagRef = `refs/tags/${releaseId}`;
const tagsAtHead = () => ({
  localTag: { status: 0, stdout: `${releaseSha}\n` },
  remoteTag: { status: 0, stdout: `${releaseSha}\t${tagRef}\n` },
});
const unusedManifest = () => ({ status: 1, stderr: "manifest unknown" });
const optionsFor = outputDirectory => ({ outputDirectory, releaseId, releaseSha, sourceTag: `repo:${releaseSha}`, inspectGitTag: tagsAtHead });
function recordedRelease(sha = previousSha, id = releaseId) {
  const input = { releaseSha: sha, imageReference: `repo@sha256:${"c".repeat(64)}`, platform: "linux/amd64", sourceTag: `repo:${sha}`, previous: null, createdAt: "2026-09-06T12:00:00.000Z", releaseId: id };
  return { record: { ...buildReleaseRecord(input) }, environment: buildReleaseEnvironment(input) };
}

test("publication stops before registry operations when either immutable record already exists", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kai-publication-"));
  try {
    await writeFile(join(dir, `kai-cloud-release-${releaseSha}.env`), "existing");
    let calls = 0;
    await assert.rejects(assertUnpublishedRelease({ ...optionsFor(dir), inspectManifest: () => { calls++; } }), /RELEASE_ALREADY_RECORDED/);
    assert.equal(calls, 0);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("remote tags, authentication failures and network errors cannot be treated as unused tags", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kai-publication-"));
  try {
    const options = optionsFor(dir);
    for (const result of [{ status: 0 }, { status: 1, stderr: "unauthorized" }, { status: 1, stderr: "connection refused" }, { status: null, error: new Error("timeout") }]) {
      await assert.rejects(assertUnpublishedRelease({ ...options, inspectManifest: () => result }), /RELEASE_TAG_ALREADY_EXISTS|RELEASE_REGISTRY_UNVERIFIED/);
    }
    await assertUnpublishedRelease({ ...options, inspectManifest: () => ({ status: 1, stderr: "manifest unknown" }) });
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("a release identifier recorded for another SHA is rejected before Git or registry access", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kai-publication-"));
  try {
    const { record, environment } = recordedRelease();
    await writeFile(join(dir, `kai-cloud-release-${previousSha}.env`), environment);
    await writeFile(join(dir, `kai-cloud-release-${previousSha}.json`), JSON.stringify(record));
    let calls = 0;
    await assert.rejects(assertUnpublishedRelease({ ...optionsFor(dir), inspectGitTag: () => { calls++; }, inspectManifest: () => { calls++; } }), /RELEASE_ID_ALREADY_RECORDED/);
    assert.equal(calls, 0);
    await assertUnpublishedRelease({ ...optionsFor(dir), releaseId: "cloud-pc/2026.09.06.2", inspectGitTag: id => ({
      localTag: { status: 0, stdout: releaseSha },
      remoteTag: { status: 0, stdout: `${releaseSha}\trefs/tags/${id}\n` },
    }), inspectManifest: unusedManifest });
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("verified legacy v1 artifacts remain untouched while ambiguous legacy IDs and unknown schemas are rejected", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kai-publication-"));
  try {
    const { record, environment } = recordedRelease();
    record.schemaVersion = "kai-cloud-release-record/1";
    delete record.releaseId;
    delete record.validationEvidence;
    const recordPath = join(dir, `kai-cloud-release-${previousSha}.json`);
    const environmentPath = join(dir, `kai-cloud-release-${previousSha}.env`);
    const original = JSON.stringify(record);
    await writeFile(recordPath, original);
    await writeFile(environmentPath, environment);
    await assertUnpublishedRelease({ ...optionsFor(dir), inspectManifest: unusedManifest });
    assert.equal(await readFile(recordPath, "utf8"), original);
    assert.equal(await readFile(environmentPath, "utf8"), environment);
    for (const bad of [{ ...record, releaseId }, { ...record, schemaVersion: "kai-cloud-release-record/99" }, { ...record, rollback: { available: true } }]) {
      await writeFile(recordPath, JSON.stringify(bad));
      await assert.rejects(assertUnpublishedRelease({ ...optionsFor(dir), inspectManifest: unusedManifest }), /RELEASE_RECORD_UNVERIFIED/);
    }
    await writeFile(recordPath, original);
    await writeFile(environmentPath, environment.replace(previousSha, releaseSha));
    await assert.rejects(assertUnpublishedRelease({ ...optionsFor(dir), inspectManifest: unusedManifest }), /RELEASE_RECORD_UNVERIFIED/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("64-character Git identities retain exact record and tag binding", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kai-publication-"));
  try {
    const sha = "a".repeat(64);
    const prior = "b".repeat(64);
    const { record, environment } = recordedRelease(prior);
    await writeFile(join(dir, `kai-cloud-release-${prior}.env`), environment);
    await writeFile(join(dir, `kai-cloud-release-${prior}.json`), JSON.stringify(record));
    const options = { ...optionsFor(dir), releaseSha: sha, sourceTag: `repo:${sha}`, inspectGitTag: id => ({
      localTag: { status: 0, stdout: sha },
      remoteTag: { status: 0, stdout: `${sha}\trefs/tags/${id}\n` },
    }), inspectManifest: unusedManifest };
    await assert.rejects(assertUnpublishedRelease(options), /RELEASE_ID_ALREADY_RECORDED/);
    await assertUnpublishedRelease({ ...options, releaseId: "cloud-pc/2026.09.06.2" });
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("malformed, mismatched, incomplete and symbolic-link records fail closed without exposing their contents", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kai-publication-"));
  const recordPath = join(dir, `kai-cloud-release-${previousSha}.json`);
  const marker = "private-record-marker";
  try {
    await writeFile(join(dir, `kai-cloud-release-${previousSha}.env`), marker);
    let calls = 0;
    const options = { ...optionsFor(dir), inspectGitTag: () => { calls++; }, inspectManifest: () => { calls++; } };
    await assert.rejects(assertUnpublishedRelease(options), /RELEASE_RECORD_UNVERIFIED/);
    for (const content of [marker, "null", "[]", JSON.stringify({ schemaVersion: "kai-cloud-release-record/2", releaseId, current: { releaseSha } }), JSON.stringify({ schemaVersion: "kai-cloud-release-record/2", releaseId: marker, current: { releaseSha: previousSha } })]) {
      await writeFile(recordPath, content);
      await assert.rejects(assertUnpublishedRelease(options), error => error.message.startsWith("RELEASE_RECORD_UNVERIFIED") && !error.message.includes(marker));
    }
    await rm(recordPath);
    await symlink(join(dir, `kai-cloud-release-${previousSha}.env`), recordPath);
    await assert.rejects(assertUnpublishedRelease(options), /RELEASE_RECORD_UNVERIFIED/);
    assert.equal(calls, 0);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("both local and origin Git release tags must identify HEAD before registry access", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kai-publication-"));
  try {
    let calls = 0;
    const options = { ...optionsFor(dir), inspectManifest: () => { calls++; return unusedManifest(); } };
    for (const tags of [
      { ...tagsAtHead(), localTag: { status: 128, stderr: "missing" } },
      { ...tagsAtHead(), localTag: { status: 0, stdout: previousSha } },
      { ...tagsAtHead(), remoteTag: { status: 2, stdout: "" } },
      { ...tagsAtHead(), remoteTag: { status: null, error: new Error("timeout") } },
      { ...tagsAtHead(), remoteTag: { status: 0, stdout: `${previousSha}\t${tagRef}\n` } },
      { ...tagsAtHead(), remoteTag: { status: 0, stdout: `${releaseSha}\t${tagRef}^{}\n` } },
      { ...tagsAtHead(), remoteTag: { status: 0, stdout: `${releaseSha}\t${tagRef}\n${releaseSha}\t${tagRef}\n` } },
    ]) await assert.rejects(assertUnpublishedRelease({ ...options, inspectGitTag: () => tags }), /RELEASE_GIT_TAG_UNVERIFIED/);
    assert.equal(calls, 0);
    await assertUnpublishedRelease({ ...options, inspectGitTag: tagsAtHead });
    await assertUnpublishedRelease({ ...options, inspectGitTag: () => ({ ...tagsAtHead(), remoteTag: { status: 0, stdout: `${previousSha}\t${tagRef}\n${releaseSha}\t${tagRef}^{}\n` } }) });
    assert.equal(calls, 2);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("promotion CLI permits Docker access only for pre-created local and origin tags at the candidate", async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "kai-publication-cli-")));
  const repo = join(dir, "source");
  const remote = join(dir, "origin.git");
  const runGit = (args, cwd = dir) => {
    const result = spawnSync("git", ["-c", "user.name=Publication test", "-c", "user.email=publication@example.test", "-c", "commit.gpgsign=false", "-c", "tag.gpgsign=false", "-c", "core.hooksPath=/dev/null", ...args], { cwd, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  try {
    runGit(["init", "--bare", remote]);
    runGit(["init", repo]);
    await writeFile(join(repo, "README.md"), "synthetic release fixture\n");
    runGit(["add", "README.md"], repo);
    runGit(["commit", "-m", "Synthetic prior release"], repo);
    const oldSha = runGit(["rev-parse", "HEAD"], repo);
    await writeFile(join(repo, "README.md"), "synthetic candidate release\n");
    runGit(["commit", "-am", "Synthetic candidate release"], repo);
    const head = runGit(["rev-parse", "HEAD"], repo);
    runGit(["remote", "add", "origin", remote], repo);
    const evidencePath = join(dir, "validation.json");
    await writeFile(evidencePath, JSON.stringify({ releaseSha: head, schemaSha256: "1".repeat(64), configurationSha256: "2".repeat(64), restoreManifestSha256: "3".repeat(64), testReportSha256: "4".repeat(64) }));
    const dockerPath = join(dir, "docker-spy.mjs");
    const dockerLog = join(dir, "docker-called");
    await writeFile(dockerPath, `#!${process.execPath}\nimport { writeFileSync } from "node:fs"; writeFileSync(${JSON.stringify(dockerLog)}, "called"); process.exitCode=1;\n`, { mode: 0o700 });
    const command = [fileURLToPath(new URL("../scripts/ops/promote-release.mjs", import.meta.url)), "--initial-release", "--release-id", releaseId, "--validation-evidence", evidencePath, "--output-dir", join(dir, "records"), "--docker", dockerPath];
    const assertBlocked = () => {
      const result = spawnSync(process.execPath, command, { cwd: repo, encoding: "utf8" });
      assert.equal(result.status, 1);
      assert.match(result.stderr, /RELEASE_GIT_TAG_UNVERIFIED/);
      assert.equal(existsSync(dockerLog), false);
    };
    assertBlocked();
    runGit(["tag", releaseId, oldSha], repo);
    assertBlocked();
    runGit(["tag", "-f", releaseId, head], repo);
    assertBlocked();
    runGit(["--git-dir", remote, "fetch", repo, "HEAD"], repo);
    runGit(["--git-dir", remote, "update-ref", tagRef, oldSha], repo);
    assertBlocked();
    runGit(["tag", "-af", releaseId, "-m", "Synthetic annotated release", head], repo);
    runGit(["--git-dir", remote, "fetch", "--force", repo, `${tagRef}:${tagRef}`], repo);
    const accepted = spawnSync(process.execPath, command, { cwd: repo, encoding: "utf8" });
    assert.equal(accepted.status, 1);
    assert.match(accepted.stderr, /RELEASE_REGISTRY_UNVERIFIED/);
    assert.equal(existsSync(dockerLog), true);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("release identifiers are explicit and never alias latest", () => {
  assert.equal(validateReleaseId("cloud-pc/2026.09.06.1"), "cloud-pc/2026.09.06.1");
  for (const value of [undefined, "latest", "cloud-pc/2026.09.06.0"]) assert.throws(() => validateReleaseId(value));
});
