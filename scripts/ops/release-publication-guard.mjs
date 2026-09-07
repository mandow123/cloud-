import { lstat, readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { buildReleaseRecord, parseReleaseEnvironment, validateReleaseSha } from "./release-tooling.mjs";

async function assertReleaseIdUnused(outputDirectory, releaseId) {
  const names = await readdir(outputDirectory);
  const records = new Map();
  for (const name of names) {
    if (!/^kai-cloud-release-.*\.(?:env|json)$/.test(name)) continue;
    const match = /^kai-cloud-release-([a-f0-9]{40}|[a-f0-9]{64})\.(env|json)$/.exec(name);
    if (!match || !((await lstat(resolve(outputDirectory, name))).isFile())) {
      throw new Error("RELEASE_RECORD_UNVERIFIED: release records must be regular files with exact SHA names");
    }
    const entry = records.get(match[1]) ?? new Set();
    entry.add(match[2]);
    records.set(match[1], entry);
  }
  for (const [sha, extensions] of records) {
    if (!extensions.has("json") || !extensions.has("env")) {
      throw new Error("RELEASE_RECORD_UNVERIFIED: an incomplete publication requires investigation before another release");
    }
    let record;
    try {
      record = JSON.parse(await readFile(resolve(outputDirectory, `kai-cloud-release-${sha}.json`), "utf8"));
      if (!["kai-cloud-release-record/1", "kai-cloud-release-record/2"].includes(record?.schemaVersion)
        || record?.current?.releaseSha !== validateReleaseSha(sha) || !Object.hasOwn(record, "previous")) throw new Error();
      const verified = buildReleaseRecord({ ...record.current, previous: record.previous, createdAt: record.createdAt });
      const environment = parseReleaseEnvironment(await readFile(resolve(outputDirectory, `kai-cloud-release-${sha}.env`), "utf8"));
      if (["releaseSha", "imageReference", "platform"].some(key => environment[key] !== verified.current[key])) throw new Error();
      if (record.schemaVersion === "kai-cloud-release-record/1") {
        // The original production publisher predates numbered release IDs.
        // Its verified artifacts occupy only the historical SHA namespace.
        if (Object.hasOwn(record, "releaseId") || record.rollback?.available !== (verified.previous !== null)
          || (verified.previous && ["releaseSha", "imageReference", "platform"].some(key => record.rollback[key] !== verified.previous[key]))) throw new Error();
      } else {
        validateReleaseId(record.releaseId);
      }
    } catch {
      throw new Error("RELEASE_RECORD_UNVERIFIED: existing release identity cannot be established");
    }
    if (record.releaseId === releaseId) {
      throw new Error("RELEASE_ID_ALREADY_RECORDED: release identifiers cannot be reused for another SHA");
    }
  }
}

function assertExactGitTag({ releaseId, releaseSha, localTag, remoteTag }) {
  if (localTag.error || localTag.status !== 0 || String(localTag.stdout ?? "").trim() !== releaseSha) {
    throw new Error("RELEASE_GIT_TAG_UNVERIFIED: the local release tag must resolve to the exact candidate SHA");
  }
  if (remoteTag.error || remoteTag.status !== 0) {
    throw new Error("RELEASE_GIT_TAG_UNVERIFIED: origin must confirm the pre-created release tag");
  }
  const ref = `refs/tags/${releaseId}`;
  const refs = new Map();
  for (const line of String(remoteTag.stdout ?? "").trim().split("\n")) {
    const match = /^([a-f0-9]{40}|[a-f0-9]{64})\t(.+)$/.exec(line);
    if (!match || match[1].length !== releaseSha.length || ![ref, `${ref}^{}`].includes(match[2]) || refs.has(match[2])) {
      throw new Error("RELEASE_GIT_TAG_UNVERIFIED: origin returned an ambiguous release tag");
    }
    refs.set(match[2], match[1]);
  }
  if (!refs.has(ref) || (refs.get(`${ref}^{}`) ?? refs.get(ref)) !== releaseSha) {
    throw new Error("RELEASE_GIT_TAG_UNVERIFIED: the origin release tag must resolve to the exact candidate SHA");
  }
}

// Run before building or publishing anything. An unavailable registry is not
// evidence that a tag is unused.
export async function assertUnpublishedRelease({ outputDirectory, releaseId, releaseSha, sourceTag, inspectGitTag, inspectManifest }) {
  validateReleaseId(releaseId);
  validateReleaseSha(releaseSha);
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
  await assertReleaseIdUnused(outputDirectory, releaseId);
  const tags = await inspectGitTag(releaseId);
  assertExactGitTag({ releaseId, releaseSha, ...tags });
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
