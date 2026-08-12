#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";

const projectRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const agentRoot = join(projectRoot, "host-agent");
const outputRoot = join(projectRoot, "public", "downloads");

const releaseFiles = Object.freeze([
  ["README.md", 0o644],
  ["install.sh", 0o755],
  ["kai-host-actuator.env.example", 0o600],
  ["kai-host-actuator.service", 0o644],
  ["kai-host-agent.service", 0o644],
  ["package.json", 0o644],
  ["src/actuator-client.mjs", 0o644],
  ["src/actuator-server.mjs", 0o755],
  ["src/actuator.mjs", 0o644],
  ["src/cli.mjs", 0o755],
  ["src/client.mjs", 0o644],
  ["src/inventory.mjs", 0o644],
  ["src/doctor.mjs", 0o644],
  ["src/protocol.mjs", 0o644],
  ["src/state.mjs", 0o644],
  ["src/verify.mjs", 0o644],
]);

function octal(value, bytes) {
  return `${value.toString(8).padStart(bytes - 1, "0")}\0`;
}

function tarHeader(name, size, mode) {
  if (!/^[A-Za-z0-9._/-]{1,100}$/u.test(name)) throw new Error(`unsafe archive path: ${name}`);
  const header = Buffer.alloc(512);
  header.write(name, 0, 100, "utf8");
  header.write(octal(mode, 8), 100, 8, "ascii");
  header.write(octal(0, 8), 108, 8, "ascii");
  header.write(octal(0, 8), 116, 8, "ascii");
  header.write(octal(size, 12), 124, 12, "ascii");
  header.write(octal(0, 12), 136, 12, "ascii");
  header.fill(0x20, 148, 156);
  header.write("0", 156, 1, "ascii");
  header.write("ustar\0", 257, 6, "ascii");
  header.write("00", 263, 2, "ascii");
  header.write("root", 265, 32, "ascii");
  header.write("root", 297, 32, "ascii");
  const checksum = [...header].reduce((sum, byte) => sum + byte, 0);
  header.write(`${checksum.toString(8).padStart(6, "0")}\0 `, 148, 8, "ascii");
  return header;
}

function revision() {
  const configured = process.env.KAI_RELEASE_SHA?.trim() || process.env.KAI_BUILD_REVISION?.trim();
  if (/^[a-f0-9]{40}$/u.test(configured ?? "")) return configured;
  try {
    const value = execFileSync("git", ["rev-parse", "HEAD"], { cwd: projectRoot, encoding: "utf8" }).trim();
    if (/^[a-f0-9]{40}$/u.test(value)) return value;
  } catch { /* Source archives must receive KAI_RELEASE_SHA from the build. */ }
  throw new Error("Host Agent release requires an exact 40-character KAI_RELEASE_SHA.");
}

export async function buildHostAgentRelease({ outputDirectory = outputRoot } = {}) {
  const packageJson = JSON.parse(await readFile(join(agentRoot, "package.json"), "utf8"));
  const version = packageJson.version;
  if (!/^\d+\.\d+\.\d+$/u.test(version)) throw new Error("Host Agent version must be semantic.");
  const sourceRevision = revision();
  const root = `kai-host-agent-${version}`;
  const entries = [];
  const manifestFiles = [];
  for (const [path, mode] of releaseFiles) {
    const content = await readFile(join(agentRoot, path));
    entries.push({ name: `${root}/${path}`, content, mode });
    manifestFiles.push({ path, bytes: content.byteLength, sha256: createHash("sha256").update(content).digest("hex") });
  }
  const manifest = Buffer.from(`${JSON.stringify({ schemaVersion: "kai-host-agent-release/1", name: packageJson.name, version, revision: sourceRevision, files: manifestFiles }, null, 2)}\n`);
  entries.push({ name: `${root}/release-manifest.json`, content: manifest, mode: 0o644 });

  const tar = [];
  for (const entry of entries) {
    tar.push(tarHeader(entry.name, entry.content.byteLength, entry.mode), entry.content);
    const padding = (512 - (entry.content.byteLength % 512)) % 512;
    if (padding) tar.push(Buffer.alloc(padding));
  }
  tar.push(Buffer.alloc(1024));
  const archive = gzipSync(Buffer.concat(tar), { level: 9, mtime: 0 });
  const archiveName = `kai-host-agent-${version}.tgz`;
  const digest = createHash("sha256").update(archive).digest("hex");
  await mkdir(outputDirectory, { recursive: true, mode: 0o755 });
  for (const existing of await readdir(outputDirectory)) {
    if (/^kai-host-agent-(?:\d+\.\d+\.\d+\.(?:tar\.gz|tgz)(?:\.sha256)?|release\.json)$/u.test(existing)) {
      await unlink(join(outputDirectory, existing));
    }
  }
  await writeFile(join(outputDirectory, archiveName), archive, { mode: 0o644 });
  await writeFile(join(outputDirectory, `${archiveName}.sha256`), `${digest}  ${archiveName}\n`, { mode: 0o644 });
  await writeFile(join(outputDirectory, "kai-host-agent-release.json"), `${JSON.stringify({ version, revision: sourceRevision, archive: archiveName, bytes: archive.byteLength, sha256: digest }, null, 2)}\n`, { mode: 0o644 });
  return { version, revision: sourceRevision, archive: archiveName, bytes: archive.byteLength, sha256: digest };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  buildHostAgentRelease().then((result) => process.stdout.write(`${JSON.stringify({ status: "ok", ...result })}\n`)).catch((error) => {
    process.stderr.write(`HOST_AGENT_RELEASE_FAILED: ${error.message}\n`);
    process.exitCode = 1;
  });
}
