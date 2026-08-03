#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { link, lstat, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";

import {
  assertCleanGitStatus,
  buildReleaseEnvironment,
  buildReleaseRecord,
  parseReleaseEnvironment,
  selectRepositoryDigest,
  validateImageInspection,
  validatePlatform,
  validateReleaseSha,
  validateRepository,
} from "./release-tooling.mjs";

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--initial-release") {
      options.initialRelease = true;
      continue;
    }
    if (!["--repository", "--platform", "--output-dir", "--previous-env", "--docker"].includes(argument)) {
      throw new Error(`unknown argument: ${argument}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${argument} requires a value`);
    options[argument.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
    index += 1;
  }
  if (Boolean(options.initialRelease) === Boolean(options.previousEnv)) {
    throw new Error("choose exactly one of --initial-release or --previous-env <current release env>");
  }
  return {
    repository: validateRepository(options.repository ?? process.env.KAI_RELEASE_REPOSITORY ?? "127.0.0.1:5443/kai-cloud-market"),
    platform: validatePlatform(options.platform ?? process.env.KAI_IMAGE_PLATFORM ?? "linux/amd64"),
    outputDirectory: resolve(options.outputDir ?? ".market-cache/release-artifacts"),
    previousEnvironmentPath: options.previousEnv ? resolve(options.previousEnv) : null,
    initialRelease: Boolean(options.initialRelease),
    dockerBinary: options.docker ?? process.env.KAI_DOCKER_BIN ?? "docker",
  };
}

function runCaptured(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: Object.hasOwn(options, "encoding") ? options.encoding : "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.slice(0, 3).join(" ")} failed: ${String(result.stderr || result.stdout).trim()}`);
  }
  return result.stdout;
}

function runVisible(command, args, { cwd, input } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    input,
    stdio: [input == null ? "ignore" : "pipe", "inherit", "inherit"],
    maxBuffer: 256 * 1024 * 1024,
  });
  if (result.status !== 0) throw new Error(`${command} ${args.slice(0, 3).join(" ")} failed with exit code ${result.status}`);
}

async function safeOutputDirectory(path) {
  await mkdir(path, { recursive: true, mode: 0o750 });
  const metadata = await lstat(path);
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || await realpath(path) !== path) {
    throw new Error("release output directory must be a real directory and not a symbolic link");
  }
}

async function writeOnce(path, content) {
  const temporaryPath = `${path}.partial-${randomUUID()}`;
  await writeFile(temporaryPath, content, { encoding: "utf8", flag: "wx", mode: 0o600 });
  try {
    await link(temporaryPath, path);
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    const existing = await readFile(path, "utf8");
    if (existing !== content) throw new Error(`refusing to overwrite existing release artifact: ${path}`);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

function inspectImage(dockerBinary, reference, cwd) {
  const raw = runCaptured(dockerBinary, ["image", "inspect", reference], { cwd });
  const inspections = JSON.parse(raw);
  if (!Array.isArray(inspections) || inspections.length !== 1) throw new Error("Docker returned an unexpected image inspection payload");
  return inspections[0];
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const projectRoot = runCaptured("git", ["rev-parse", "--show-toplevel"]).trim();
  const gitStatus = runCaptured("git", ["status", "--porcelain=v1", "--untracked-files=all"], { cwd: projectRoot });
  assertCleanGitStatus(gitStatus);
  const releaseSha = validateReleaseSha(runCaptured("git", ["rev-parse", "HEAD"], { cwd: projectRoot }).trim());
  const previous = options.initialRelease
    ? null
    : parseReleaseEnvironment(await readFile(options.previousEnvironmentPath, "utf8"));
  const sourceTag = `${options.repository}:${releaseSha}`;

  // A Git archive, rather than the working directory, makes the Docker build
  // context byte-for-byte tied to HEAD even when ignored local files exist.
  const buildContext = runCaptured("git", ["archive", "--format=tar", "HEAD"], { cwd: projectRoot, encoding: null });
  runVisible(options.dockerBinary, [
    "build",
    "--pull",
    "--platform", options.platform,
    "--build-arg", `KAI_RELEASE_SHA=${releaseSha}`,
    "--label", `org.opencontainers.image.revision=${releaseSha}`,
    "--tag", sourceTag,
    "-",
  ], { cwd: projectRoot, input: buildContext });

  const localBuild = inspectImage(options.dockerBinary, sourceTag, projectRoot);
  if (localBuild.Config?.Labels?.["org.opencontainers.image.revision"] !== releaseSha) {
    throw new Error("built image is missing the exact OCI revision label");
  }
  if (`${localBuild.Os}/${localBuild.Architecture}` !== options.platform) {
    throw new Error("built image platform does not match the requested platform");
  }

  // Authentication is intentionally delegated to Docker's credential store;
  // this process never accepts, prints, or writes a registry password.
  runVisible(options.dockerBinary, ["image", "push", sourceTag], { cwd: projectRoot });
  runVisible(options.dockerBinary, ["image", "pull", "--platform", options.platform, sourceTag], { cwd: projectRoot });
  const pushedInspection = inspectImage(options.dockerBinary, sourceTag, projectRoot);
  const imageReference = selectRepositoryDigest(pushedInspection.RepoDigests, options.repository);
  runVisible(options.dockerBinary, ["image", "pull", "--platform", options.platform, imageReference], { cwd: projectRoot });
  const immutableInspection = inspectImage(options.dockerBinary, imageReference, projectRoot);
  validateImageInspection(immutableInspection, { imageReference, releaseSha, platform: options.platform });

  await safeOutputDirectory(options.outputDirectory);
  const environment = buildReleaseEnvironment({ imageReference, releaseSha, platform: options.platform });
  const record = buildReleaseRecord({
    imageReference,
    releaseSha,
    platform: options.platform,
    sourceTag,
    previous,
    createdAt: new Date().toISOString(),
  });
  const environmentPath = resolve(options.outputDirectory, `kai-cloud-release-${releaseSha}.env`);
  const recordPath = resolve(options.outputDirectory, `kai-cloud-release-${releaseSha}.json`);
  await writeOnce(environmentPath, environment);
  await writeOnce(recordPath, `${JSON.stringify(record, null, 2)}\n`);

  process.stdout.write(`${JSON.stringify({
    status: "ok",
    imageReference,
    releaseSha,
    platform: options.platform,
    sourceTag,
    environmentPath,
    rollbackRecordPath: recordPath,
  })}\n`);
}

main().catch((error) => {
  process.stderr.write(`RELEASE_PROMOTION_FAILED: ${error.message}\n`);
  process.exitCode = 1;
});
