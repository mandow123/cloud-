import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { assertUnpublishedRelease, validateReleaseId } from "../scripts/ops/release-publication-guard.mjs";

test("publication stops before registry operations when either immutable record already exists", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kai-publication-"));
  try {
    await writeFile(join(dir, "kai-cloud-release-abc.env"), "existing");
    let calls = 0;
    await assert.rejects(assertUnpublishedRelease({ outputDirectory: dir, releaseSha: "abc", sourceTag: "repo:abc", inspectManifest: () => { calls++; } }), /RELEASE_ALREADY_RECORDED/);
    assert.equal(calls, 0);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("remote tags, authentication failures and network errors cannot be treated as unused tags", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kai-publication-"));
  try {
    const options = { outputDirectory: dir, releaseSha: "abc", sourceTag: "repo:abc" };
    for (const result of [{ status: 0 }, { status: 1, stderr: "unauthorized" }, { status: 1, stderr: "connection refused" }, { status: null, error: new Error("timeout") }]) {
      await assert.rejects(assertUnpublishedRelease({ ...options, inspectManifest: () => result }), /RELEASE_TAG_ALREADY_EXISTS|RELEASE_REGISTRY_UNVERIFIED/);
    }
    await assertUnpublishedRelease({ ...options, inspectManifest: () => ({ status: 1, stderr: "manifest unknown" }) });
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("release identifiers are explicit and never alias latest", () => {
  assert.equal(validateReleaseId("cloud-pc/2026.09.06.1"), "cloud-pc/2026.09.06.1");
  for (const value of [undefined, "latest", "cloud-pc/2026.09.06.0"]) assert.throws(() => validateReleaseId(value));
});
