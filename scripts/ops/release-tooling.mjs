const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;
const RELEASE_SHA_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const REPOSITORY_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+)*(?::[0-9]+)?(?:\/[a-z0-9]+(?:[._-][a-z0-9]+)*)*$/;
const SUPPORTED_PLATFORMS = new Set(["linux/amd64", "linux/arm64"]);
const RELEASE_ENVIRONMENT_KEYS = new Set([
  "KAI_IMAGE",
  "KAI_RELEASE_SHA",
  "KAI_IMAGE_PLATFORM",
  "KAI_STATE_ROOT",
  "KAI_UPDATE_CONTAINER_PREFIX",
  "KAI_BACKUP_CONTAINER_PREFIX",
  "KAI_BACKUP_RETENTION_HOURLY",
  "KAI_BACKUP_RETENTION_DAILY",
  "KAI_BACKUP_RETENTION_MONTHLY",
  "KAI_BACKUP_RETENTION_MAX_AGE_DAYS",
]);

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

export function validateReleaseSha(value) {
  invariant(typeof value === "string" && RELEASE_SHA_PATTERN.test(value) && !/^0+$/.test(value), "release SHA must be a non-zero full lowercase 40- or 64-character Git object ID");
  return value;
}

export function validateRepository(value) {
  invariant(typeof value === "string" && value.trim() === value && REPOSITORY_PATTERN.test(value), "repository must be a lowercase OCI repository without a scheme or tag");
  return value;
}

export function validatePlatform(value) {
  invariant(SUPPORTED_PLATFORMS.has(value), "platform must be linux/amd64 or linux/arm64");
  return value;
}

export function parseImmutableImageReference(value) {
  invariant(typeof value === "string" && value.trim() === value, "image reference must not contain whitespace");
  const marker = "@sha256:";
  const markerIndex = value.indexOf(marker);
  invariant(markerIndex > 0 && value.lastIndexOf(marker) === markerIndex, "image reference must be repository@sha256:<digest>");
  const repository = validateRepository(value.slice(0, markerIndex));
  const digest = `sha256:${value.slice(markerIndex + marker.length)}`;
  invariant(DIGEST_PATTERN.test(digest) && !/^sha256:0+$/.test(digest), "image digest must be 64 lowercase hexadecimal characters and must not be a placeholder");
  return Object.freeze({ repository, digest, reference: `${repository}@${digest}` });
}

export function assertCleanGitStatus(status) {
  invariant(typeof status === "string" && status.length === 0, "release promotion refuses a dirty Git worktree, including untracked files");
}

export function selectRepositoryDigest(repoDigests, repository) {
  validateRepository(repository);
  invariant(Array.isArray(repoDigests), "image inspection did not return RepoDigests");
  const matches = [...new Set(repoDigests
    .filter((entry) => typeof entry === "string" && entry.startsWith(`${repository}@sha256:`))
    .map((entry) => parseImmutableImageReference(entry).reference))];
  invariant(matches.length === 1, `expected exactly one digest for ${repository}, received ${matches.length}`);
  return matches[0];
}

export function validateImageInspection(inspection, { imageReference, releaseSha, platform }) {
  const parsedReference = parseImmutableImageReference(imageReference);
  const expectedSha = validateReleaseSha(releaseSha);
  const expectedPlatform = validatePlatform(platform);
  invariant(inspection && typeof inspection === "object", "Docker image inspection is missing");
  invariant(Array.isArray(inspection.RepoDigests) && inspection.RepoDigests.includes(parsedReference.reference), "local image RepoDigests does not contain the required immutable reference");
  invariant(inspection.Config?.Labels?.["org.opencontainers.image.revision"] === expectedSha, "local image OCI revision label does not match KAI_RELEASE_SHA");
  invariant(`${inspection.Os}/${inspection.Architecture}` === expectedPlatform, "local image OS/architecture does not match KAI_IMAGE_PLATFORM");
  return Object.freeze({ imageReference: parsedReference.reference, releaseSha: expectedSha, platform: expectedPlatform });
}

export function parseReleaseEnvironment(text) {
  invariant(typeof text === "string", "release environment must be text");
  const values = new Map();
  for (const rawLine of text.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    invariant(separator > 0, "release environment contains an invalid line");
    const key = line.slice(0, separator);
    const value = line.slice(separator + 1);
    invariant(/^[A-Z][A-Z0-9_]*$/.test(key) && RELEASE_ENVIRONMENT_KEYS.has(key) && !values.has(key), "release environment contains an invalid, unexpected, or duplicate key");
    values.set(key, value);
  }
  invariant(values.size === RELEASE_ENVIRONMENT_KEYS.size && [...RELEASE_ENVIRONMENT_KEYS].every((key) => values.has(key)), "release environment is missing a required release key");
  const image = parseImmutableImageReference(values.get("KAI_IMAGE"));
  const releaseSha = validateReleaseSha(values.get("KAI_RELEASE_SHA"));
  const platform = validatePlatform(values.get("KAI_IMAGE_PLATFORM"));
  invariant(values.get("KAI_STATE_ROOT") === "/opt/kai-cloud-3051", "release environment has an invalid state root");
  invariant(values.get("KAI_UPDATE_CONTAINER_PREFIX") === "kai-cloud-market-update-3051", "release environment has an invalid update prefix");
  invariant(values.get("KAI_BACKUP_CONTAINER_PREFIX") === "kai-cloud-backup-3051", "release environment has an invalid backup prefix");
  invariant(values.get("KAI_BACKUP_RETENTION_HOURLY") === "48", "release environment has an invalid hourly retention policy");
  invariant(values.get("KAI_BACKUP_RETENTION_DAILY") === "30", "release environment has an invalid daily retention policy");
  invariant(values.get("KAI_BACKUP_RETENTION_MONTHLY") === "0", "release environment has an invalid monthly retention policy");
  invariant(values.get("KAI_BACKUP_RETENTION_MAX_AGE_DAYS") === "30", "release environment has an invalid maximum retention policy");
  return Object.freeze({ imageReference: image.reference, releaseSha, platform });
}

export function buildReleaseEnvironment({ imageReference, releaseSha, platform }) {
  const image = parseImmutableImageReference(imageReference).reference;
  const sha = validateReleaseSha(releaseSha);
  const targetPlatform = validatePlatform(platform);
  return [
    "# Generated by scripts/ops/promote-release.mjs; contains no credentials.",
    `KAI_IMAGE=${image}`,
    `KAI_RELEASE_SHA=${sha}`,
    `KAI_IMAGE_PLATFORM=${targetPlatform}`,
    "KAI_STATE_ROOT=/opt/kai-cloud-3051",
    "KAI_UPDATE_CONTAINER_PREFIX=kai-cloud-market-update-3051",
    "KAI_BACKUP_CONTAINER_PREFIX=kai-cloud-backup-3051",
    "KAI_BACKUP_RETENTION_HOURLY=48",
    "KAI_BACKUP_RETENTION_DAILY=30",
    "KAI_BACKUP_RETENTION_MONTHLY=0",
    "KAI_BACKUP_RETENTION_MAX_AGE_DAYS=30",
    "",
  ].join("\n");
}

export function buildReleaseRecord({ imageReference, releaseSha, platform, sourceTag, previous, createdAt }) {
  const current = {
    imageReference: parseImmutableImageReference(imageReference).reference,
    releaseSha: validateReleaseSha(releaseSha),
    platform: validatePlatform(platform),
    sourceTag,
  };
  validateRepository(sourceTag.slice(0, sourceTag.lastIndexOf(":")));
  invariant(sourceTag.endsWith(`:${current.releaseSha}`), "source tag must be the unique full-SHA tag");
  const prior = previous == null ? null : {
    imageReference: parseImmutableImageReference(previous.imageReference).reference,
    releaseSha: validateReleaseSha(previous.releaseSha),
    platform: validatePlatform(previous.platform),
  };
  const timestamp = new Date(createdAt);
  invariant(Number.isFinite(timestamp.valueOf()), "release record timestamp is invalid");
  return Object.freeze({
    schemaVersion: "kai-cloud-release-record/1",
    createdAt: timestamp.toISOString(),
    current,
    previous: prior,
    rollback: prior == null
      ? { available: false, reason: "initial release has no previous immutable image" }
      : { available: true, imageReference: prior.imageReference, releaseSha: prior.releaseSha, platform: prior.platform },
  });
}
