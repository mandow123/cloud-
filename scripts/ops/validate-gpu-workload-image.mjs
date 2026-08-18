#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const DIGEST_REFERENCE = /^ghcr\.io\/mandow123\/kai-cloud-gpu-workload@sha256:[a-f0-9]{64}$/u;
const REVISION = /^[a-f0-9]{40}$/u;
const EXPECTED_SOURCE = "https://github.com/mandow123/cloud-";
const EXPECTED_ENTRYPOINT = ["/usr/bin/tini", "--", "/usr/local/bin/kai-workload-entrypoint"];

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function runDocker(binary, args) {
  const result = spawnSync(binary, args, { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`Docker image inspection failed: ${String(result.stderr || result.stdout).trim()}`);
  return result.stdout;
}

export function validateGpuWorkloadInspection(inspection, { imageReference, revision }) {
  invariant(typeof imageReference === "string" && DIGEST_REFERENCE.test(imageReference), "GPU workload must use the approved GHCR repository and an immutable sha256 digest");
  invariant(typeof revision === "string" && REVISION.test(revision) && !/^0+$/u.test(revision), "GPU workload revision must be an exact non-zero 40-character Git commit");
  invariant(inspection && typeof inspection === "object" && !Array.isArray(inspection), "GPU workload inspection is missing");
  invariant(Array.isArray(inspection.RepoDigests) && inspection.RepoDigests.includes(imageReference), "GPU workload RepoDigests does not contain the approved immutable reference");
  invariant(inspection.Config?.Labels?.["org.opencontainers.image.revision"] === revision, "GPU workload revision label does not exactly match the publishing commit");
  invariant(inspection.Config?.Labels?.["org.opencontainers.image.source"] === EXPECTED_SOURCE, "GPU workload source label does not identify the KAI Cloud repository");
  invariant(inspection.Config?.User === "1000:1000", "GPU workload must run as the fixed non-root UID/GID 1000:1000");
  invariant(JSON.stringify(inspection.Config?.Entrypoint) === JSON.stringify(EXPECTED_ENTRYPOINT), "GPU workload entrypoint does not match the reviewed runtime contract");
  invariant(`${inspection.Os}/${inspection.Architecture}` === "linux/amd64", "GPU workload must target linux/amd64 for the first production release");
  return Object.freeze({ imageReference, revision, platform: "linux/amd64", user: "1000:1000" });
}

export function validateGpuWorkloadImage({ imageReference, revision, dockerBinary = "docker", commandRunner = runDocker }) {
  const raw = commandRunner(dockerBinary, ["image", "inspect", imageReference]);
  const inspections = JSON.parse(raw);
  invariant(Array.isArray(inspections) && inspections.length === 1, "Docker returned an unexpected GPU workload inspection payload");
  return validateGpuWorkloadInspection(inspections[0], { imageReference, revision });
}

async function main() {
  const result = validateGpuWorkloadImage({
    imageReference: process.env.KAI_GPU_WORKLOAD_IMAGE,
    revision: process.env.KAI_GPU_WORKLOAD_REVISION,
    dockerBinary: process.env.KAI_DOCKER_BIN ?? "docker",
  });
  process.stdout.write(`${JSON.stringify({ status: "ok", ...result })}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`GPU_WORKLOAD_VALIDATION_FAILED: ${error.message}\n`);
    process.exitCode = 1;
  });
}
