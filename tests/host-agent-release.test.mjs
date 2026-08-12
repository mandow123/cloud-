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
    assert.equal(first.archive, "kai-host-agent-1.9.4.tgz");
    assert.deepEqual(secondArchive, firstArchive);
    assert.ok(firstArchive.byteLength > 1_000 && firstArchive.byteLength < 1_000_000);
    assert.equal(createHash("sha256").update(firstArchive).digest("hex"), first.sha256);
    assert.equal(await readFile(join(outputDirectory, `${first.archive}.sha256`), "utf8"), `${first.sha256}  ${first.archive}\n`);

    const entries = execFileSync("tar", ["-tzf", join(outputDirectory, first.archive)], { encoding: "utf8" }).trim().split("\n");
    assert.equal(entries.length, 18);
    for (const entry of entries) {
      assert.match(entry, /^kai-host-agent-1\.9\.4\/[A-Za-z0-9._/-]+$/u);
      assert.doesNotMatch(entry, /(?:^|\/)\.\.?\/|identity\.json|pairing\.json|\.env$/u);
    }
    assert.ok(entries.includes("kai-host-agent-1.9.4/release-manifest.json"));
    assert.ok(entries.includes("kai-host-agent-1.9.4/src/doctor.mjs"));
    assert.ok(entries.includes("kai-host-agent-1.9.4/src/preflight.mjs"));

    execFileSync("tar", ["-xzf", join(outputDirectory, first.archive), "-C", extractionDirectory]);
    const manifest = JSON.parse(await readFile(join(extractionDirectory, "kai-host-agent-1.9.4", "release-manifest.json"), "utf8"));
    assert.equal(manifest.schemaVersion, "kai-host-agent-release/1");
    assert.equal(manifest.version, "1.9.4");
    assert.equal(manifest.revision, FIXED_REVISION);
    assert.equal(manifest.files.length, 17);
    assert.equal(manifest.files.some((file) => /identity|pairing/u.test(file.path)), false);
  } finally {
    if (previousRevision === undefined) delete process.env.KAI_RELEASE_SHA;
    else process.env.KAI_RELEASE_SHA = previousRevision;
    await rm(outputDirectory, { recursive: true, force: true });
    await rm(extractionDirectory, { recursive: true, force: true });
  }
});

test("every public install surface requires the exact release version", async () => {
  const packageJson = JSON.parse(await readFile("host-agent/package.json", "utf8"));
  const client = await readFile("host-agent/src/client.mjs", "utf8");
  const server = await readFile("lib/server/hosting-v2-store-core.ts", "utf8");
  const guide = await readFile("app/guides/host-agent/page.tsx", "utf8");
  const registration = await readFile("components/supply-resource-registration.tsx", "utf8");
  for (const [name, source] of Object.entries({ client, server, guide, registration })) {
    assert.match(source, new RegExp(`(?:AGENT_VERSION|HOSTING_V2_MIN_AGENT_VERSION|HOST_AGENT_VERSION) = "${packageJson.version.replaceAll(".", "\\.")}"`, "u"), `${name} must use Host Agent ${packageJson.version}`);
  }
});
