import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import { buildHostAgentRelease } from "../scripts/ops/build-host-agent-release.mjs";

const FIXED_REVISION = "0123456789abcdef0123456789abcdef01234567";

test("Host Agent release is deterministic, checksummed and contains only reviewed source files", async () => {
  const outputDirectory = await mkdtemp(join(tmpdir(), "kai-host-agent-release-"));
  const extractionDirectory = await mkdtemp(join(tmpdir(), "kai-host-agent-extract-"));
  const previousRevision = process.env.KAI_RELEASE_SHA;
  try {
    process.env.KAI_RELEASE_SHA = FIXED_REVISION;
    const first = await buildHostAgentRelease({ outputDirectory });
    const firstArchive = await readFile(join(outputDirectory, first.archive));
    const second = await buildHostAgentRelease({ outputDirectory });
    const secondArchive = await readFile(join(outputDirectory, second.archive));

    assert.deepEqual(second, first);
    assert.equal(first.archive, "kai-host-agent-1.3.0.tgz");
    assert.deepEqual(secondArchive, firstArchive);
    assert.ok(firstArchive.byteLength > 1_000 && firstArchive.byteLength < 1_000_000);
    assert.equal(createHash("sha256").update(firstArchive).digest("hex"), first.sha256);
    assert.equal(await readFile(join(outputDirectory, `${first.archive}.sha256`), "utf8"), `${first.sha256}  ${first.archive}\n`);

    const entries = execFileSync("tar", ["-tzf", join(outputDirectory, first.archive)], { encoding: "utf8" }).trim().split("\n");
    assert.equal(entries.length, 16);
    for (const entry of entries) {
      assert.match(entry, /^kai-host-agent-1\.3\.0\/[A-Za-z0-9._/-]+$/u);
      assert.doesNotMatch(entry, /(?:^|\/)\.\.?\/|identity\.json|pairing\.json|\.env$/u);
    }
    assert.ok(entries.includes("kai-host-agent-1.3.0/release-manifest.json"));

    execFileSync("tar", ["-xzf", join(outputDirectory, first.archive), "-C", extractionDirectory]);
    const manifest = JSON.parse(await readFile(join(extractionDirectory, "kai-host-agent-1.3.0", "release-manifest.json"), "utf8"));
    assert.equal(manifest.schemaVersion, "kai-host-agent-release/1");
    assert.equal(manifest.version, "1.3.0");
    assert.equal(manifest.revision, FIXED_REVISION);
    assert.equal(manifest.files.length, 15);
    assert.equal(manifest.files.some((file) => /identity|pairing/u.test(file.path)), false);
  } finally {
    if (previousRevision === undefined) delete process.env.KAI_RELEASE_SHA;
    else process.env.KAI_RELEASE_SHA = previousRevision;
    await rm(outputDirectory, { recursive: true, force: true });
    await rm(extractionDirectory, { recursive: true, force: true });
  }
});
