import assert from "node:assert/strict";
import test from "node:test";

import { validateGpuWorkloadImage, validateGpuWorkloadInspection } from "../scripts/ops/validate-gpu-workload-image.mjs";

const revision = "0123456789abcdef0123456789abcdef01234567";
const imageReference = `ghcr.io/mandow123/kai-cloud-gpu-workload@sha256:${"a1b2c3d4".repeat(8)}`;
const inspection = () => ({
  RepoDigests: [imageReference],
  Config: {
    User: "1000:1000",
    Entrypoint: ["/usr/bin/tini", "--", "/usr/local/bin/kai-workload-entrypoint"],
    Labels: {
      "org.opencontainers.image.revision": revision,
      "org.opencontainers.image.source": "https://github.com/mandow123/cloud-",
    },
  },
  Os: "linux",
  Architecture: "amd64",
});

test("GPU workload release validator binds immutable digest, exact commit and sandbox contract", () => {
  assert.deepEqual(validateGpuWorkloadInspection(inspection(), { imageReference, revision }), {
    imageReference,
    revision,
    platform: "linux/amd64",
    user: "1000:1000",
  });
});

test("GPU workload release validator rejects a near-match or fabricated full revision", () => {
  assert.throws(() => validateGpuWorkloadInspection({
    ...inspection(),
    Config: { ...inspection().Config, Labels: { ...inspection().Config.Labels, "org.opencontainers.image.revision": `${revision.slice(0, -1)}8` } },
  }, { imageReference, revision }), /does not exactly match/u);
});

test("GPU workload release validator rejects mutable tags, root and altered entrypoints", () => {
  assert.throws(() => validateGpuWorkloadInspection(inspection(), { imageReference: "ghcr.io/mandow123/kai-cloud-gpu-workload:latest", revision }), /immutable/u);
  assert.throws(() => validateGpuWorkloadInspection({ ...inspection(), Config: { ...inspection().Config, User: "0:0" } }, { imageReference, revision }), /non-root/u);
  assert.throws(() => validateGpuWorkloadInspection({ ...inspection(), Config: { ...inspection().Config, Entrypoint: ["/bin/sh"] } }, { imageReference, revision }), /entrypoint/u);
});

test("GPU workload release validator inspects exactly the requested digest", () => {
  const commands = [];
  const result = validateGpuWorkloadImage({ imageReference, revision, commandRunner(_binary, args) {
    commands.push(args);
    return JSON.stringify([inspection()]);
  } });
  assert.equal(result.imageReference, imageReference);
  assert.deepEqual(commands, [["image", "inspect", imageReference]]);
});
