import { lstat } from "node:fs/promises";
import { resolve } from "node:path";

// Run before building or publishing anything. An unavailable registry is not
// evidence that a tag is unused.
export async function assertUnpublishedRelease({ outputDirectory, releaseSha, sourceTag, inspectManifest }) {
  for (const suffix of ["env", "json"]) {
    const path = resolve(outputDirectory, `kai-cloud-release-${releaseSha}.${suffix}`);
    try {
      await lstat(path);
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
    throw new Error("RELEASE_ALREADY_RECORDED: use its validated immutable digest; never rebuild this SHA");
  }
  const result = await inspectManifest(sourceTag);
  if (result.status === 0) throw new Error("RELEASE_TAG_ALREADY_EXISTS: refusing to move the existing SHA tag");
  const diagnostic = String(result.stderr ?? "");
  if (result.error || !/manifest unknown|no such manifest|manifest_unknown/i.test(diagnostic)) {
    throw new Error("RELEASE_REGISTRY_UNVERIFIED: registry must explicitly confirm that the manifest does not exist");
  }
}

export function validateReleaseId(value) {
  if (!/^cloud-pc\/\d{4}\.\d{2}\.\d{2}\.[1-9]\d*$/.test(value ?? "")) {
    throw new Error("release id must be cloud-pc/YYYY.MM.DD.N");
  }
  return value;
}
