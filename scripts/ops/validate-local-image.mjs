#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

import { validateImageInspection, validatePlatform } from "./release-tooling.mjs";

function runDocker(dockerBinary, args) {
  const result = spawnSync(dockerBinary, args, { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`Docker command failed (${args.slice(0, 2).join(" ")}): ${String(result.stderr || result.stdout).trim()}`);
  }
  return result.stdout.trim();
}

export function validateLocalImage({ imageReference, releaseSha, platform, dockerBinary = "docker", commandRunner = runDocker }) {
  const expectedPlatform = validatePlatform(platform);
  const enginePlatform = commandRunner(dockerBinary, ["version", "--format", "{{.Server.Os}}/{{.Server.Arch}}"]).trim();
  if (enginePlatform !== expectedPlatform) {
    throw new Error(`Docker Engine platform ${enginePlatform} does not match ${expectedPlatform}`);
  }
  const rawInspection = commandRunner(dockerBinary, ["image", "inspect", imageReference]);
  const inspections = JSON.parse(rawInspection);
  if (!Array.isArray(inspections) || inspections.length !== 1) throw new Error("Docker returned an unexpected image inspection payload");
  return validateImageInspection(inspections[0], { imageReference, releaseSha, platform: expectedPlatform });
}

async function main() {
  const result = validateLocalImage({
    imageReference: process.env.KAI_IMAGE,
    releaseSha: process.env.KAI_RELEASE_SHA,
    platform: process.env.KAI_IMAGE_PLATFORM ?? "linux/amd64",
    dockerBinary: process.env.KAI_DOCKER_BIN ?? "docker",
  });
  process.stdout.write(`${JSON.stringify({ status: "ok", ...result })}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`LOCAL_IMAGE_VALIDATION_FAILED: ${error.message}\n`);
    process.exitCode = 1;
  });
}
