import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import { buildHostAgentRelease } from "../scripts/ops/build-host-agent-release.mjs";

const FIXED_REVISION = "0123456789abcdef0123456789abcdef01234567";
const AGENT_VERSION = "1.11.0";
const EXPECTED_RELEASE_FILES = [
  "README.md",
  "install.sh",
  "kai-host-actuator.env.example",
  "kai-host-actuator.service",
  "kai-host-agent.service",
  "package.json",
  "src/actuator-client.mjs",
  "src/actuator-server.mjs",
  "src/actuator.mjs",
  "src/cli.mjs",
  "src/client.mjs",
  "src/inventory.mjs",
  "src/preflight.mjs",
  "src/doctor.mjs",
  "src/gateway-client.mjs",
  "src/protocol.mjs",
  "src/state.mjs",
  "src/verify.mjs",
].sort();

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
    assert.equal(first.archive, `kai-host-agent-${AGENT_VERSION}.tgz`);
    assert.deepEqual(secondArchive, firstArchive);
    assert.ok(firstArchive.byteLength > 1_000 && firstArchive.byteLength < 1_000_000);
    assert.equal(createHash("sha256").update(firstArchive).digest("hex"), first.sha256);
    assert.equal(await readFile(join(outputDirectory, `${first.archive}.sha256`), "utf8"), `${first.sha256}  ${first.archive}\n`);

    const entries = execFileSync("tar", ["-tzf", join(outputDirectory, first.archive)], { encoding: "utf8" }).trim().split("\n");
    assert.equal(entries.length, 19);
    for (const entry of entries) {
      assert.match(entry, /^kai-host-agent-1\.11\.0\/[A-Za-z0-9._/-]+$/u);
      assert.doesNotMatch(entry, /(?:^|\/)\.\.?\/|identity\.json|pairing\.json|\.env$/u);
    }
    assert.ok(entries.includes(`kai-host-agent-${AGENT_VERSION}/release-manifest.json`));
    assert.ok(entries.includes(`kai-host-agent-${AGENT_VERSION}/src/doctor.mjs`));
    assert.ok(entries.includes(`kai-host-agent-${AGENT_VERSION}/src/preflight.mjs`));

    execFileSync("tar", ["-xzf", join(outputDirectory, first.archive), "-C", extractionDirectory]);
    const releaseRoot = join(extractionDirectory, `kai-host-agent-${AGENT_VERSION}`);
    const manifestPath = join(releaseRoot, "release-manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    assert.equal(manifest.schemaVersion, "kai-host-agent-release/1");
    assert.equal(manifest.version, AGENT_VERSION);
    assert.equal(manifest.revision, FIXED_REVISION);
    assert.equal(manifest.files.length, 18);
    assert.deepEqual(manifest.files.map((file) => file.path).sort(), EXPECTED_RELEASE_FILES);
    assert.equal(new Set(manifest.files.map((file) => file.path)).size, EXPECTED_RELEASE_FILES.length);
    assert.equal(manifest.files.some((file) => /identity|pairing/u.test(file.path)), false);
    const installer = await readFile("host-agent/install.sh", "utf8");
    const installerManifestBlock = installer.match(/const requiredFiles = (\[[\s\S]*?\]);/u);
    assert.ok(installerManifestBlock, "installer must declare its exact release allowlist");
    const installerReleaseFiles = [...installerManifestBlock[1].matchAll(/"([^"]+)"/gu)].map((match) => match[1]).sort();
    assert.deepEqual(installerReleaseFiles, EXPECTED_RELEASE_FILES, "release builder and offline installer must verify the same exact files");
    const embeddedVerifier = installer.match(/<<'NODE'\n([\s\S]*?)\nNODE\n/u);
    assert.ok(embeddedVerifier, "installer must embed an offline release verifier");
    const verifyExtractedRelease = () => execFileSync(process.execPath, ["--input-type=module", "-", releaseRoot], {
      input: embeddedVerifier[1],
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    assert.equal(verifyExtractedRelease(), `${AGENT_VERSION} ${FIXED_REVISION}`);
    for (const files of [
      manifest.files.slice(1),
      [...manifest.files.slice(0, -1), manifest.files[0]],
      [...manifest.files.slice(0, -1), { ...manifest.files.at(-1), path: "src/unreviewed.mjs" }],
    ]) {
      await writeFile(manifestPath, `${JSON.stringify({ ...manifest, files }, null, 2)}\n`);
      assert.throws(verifyExtractedRelease, /Command failed/u);
    }
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
