#!/usr/bin/env node

import { execFile as execFileCallback } from "node:child_process";
import { readFile, stat, statfs } from "node:fs/promises";
import { createServer } from "node:net";
import { totalmem } from "node:os";
import { isAbsolute, posix } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { normalizePorts, normalizePublicHost, parseNvidiaInventory } from "./inventory.mjs";
import { AgentError } from "./protocol.mjs";

const execFile = promisify(execFileCallback);
const IMAGE_PATTERN = /^ghcr\.io\/(?:kai-cloud\/cuda-pytorch|mandow123\/kai-cloud-gpu-workload)@sha256:[a-f0-9]{64}$/u;

function fail(code, message, cause) {
  return new AgentError(code, message, cause ? { cause } : undefined);
}

function nodeVersionReady(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)/u.exec(version ?? "");
  return Boolean(match && (Number(match[1]) > 24 || (Number(match[1]) === 24 && Number(match[2]) >= 15)));
}

function storagePath(value) {
  const path = typeof value === "string" && value.length > 0 ? value : "/var/lib";
  if (!isAbsolute(path) || posix.normalize(path) !== path || !/^\/[A-Za-z0-9._/-]{1,200}$/u.test(path) || path.includes("..")) {
    throw fail("STORAGE_PATH_INVALID", "Storage path must be a normalized absolute path.");
  }
  return path;
}

function parseOptions(args) {
  const allowed = new Set(["public-host", "ssh-port-start", "ssh-port-end", "storage-path", "image"]);
  const values = {};
  for (let index = 0; index < args.length; index += 1) {
    const item = args[index];
    if (!item.startsWith("--") || !allowed.has(item.slice(2))) throw fail("ARGUMENT_INVALID", `Unexpected argument: ${item}`);
    const name = item.slice(2);
    if (Object.hasOwn(values, name)) throw fail("ARGUMENT_INVALID", `Duplicate argument: ${item}`);
    const value = args[index + 1];
    if (!value || value.startsWith("--")) throw fail("ARGUMENT_INVALID", `Missing value for ${item}`);
    values[name] = value;
    index += 1;
  }
  return values;
}

async function command(file, args) {
  try {
    return await execFile(file, args, { encoding: "utf8", timeout: 30_000, maxBuffer: 256 * 1024 });
  } catch (error) {
    throw fail("HOST_COMMAND_FAILED", `Required host command failed: ${file}`, error);
  }
}

async function assertPortRangeAvailable(start, end) {
  for (let port = start; port <= end; port += 1) {
    await new Promise((resolve, reject) => {
      const server = createServer();
      let settled = false;
      const finish = (error) => {
        if (settled) return;
        settled = true;
        if (error) reject(error); else resolve();
      };
      server.once("error", (error) => finish(fail("MANAGED_PORT_UNAVAILABLE", `Managed port ${port} is unavailable.`, error)));
      server.listen({ host: "0.0.0.0", port, exclusive: true }, () => {
        server.close((error) => finish(error ? fail("MANAGED_PORT_CHECK_FAILED", `Managed port ${port} could not be released after inspection.`, error) : undefined));
      });
    });
  }
}

function requireShape(value, predicate, code, message) {
  if (!predicate(value)) throw fail(code, message);
  return value;
}

export async function runHostPreflight(input, {
  effectiveUid = () => typeof process.geteuid === "function" ? process.geteuid() : -1,
  nodeVersion = process.versions.node,
  nodeExecutable = process.execPath,
  readText = (path) => readFile(path, "utf8"),
  pathStat = (path) => stat(path),
  runCommand = command,
  filesystemStat = (path) => statfs(path, { bigint: true }),
  memoryBytes = () => totalmem(),
  portChecker = assertPortRangeAvailable,
} = {}) {
  if (effectiveUid() !== 0) throw fail("ROOT_REQUIRED", "Run the read-only preflight with sudo so Docker and every managed port can be inspected.");
  if (!nodeVersionReady(nodeVersion)) throw fail("NODE_VERSION_UNSUPPORTED", "Node.js 24.15 or newer is required.");
  if (nodeExecutable !== "/usr/bin/node" && nodeExecutable !== "/usr/local/bin/node") throw fail("NODE_INSTALLATION_UNSUPPORTED", "Node.js must be installed system-wide at /usr/bin/node or /usr/local/bin/node.");

  const publicHost = normalizePublicHost(input.publicHost);
  const ports = normalizePorts(input.sshPortStart, input.sshPortEnd);
  const inspectedStoragePath = storagePath(input.storagePath);
  const image = input.image?.trim() || null;
  if (image && !IMAGE_PATTERN.test(image)) throw fail("IMAGE_REFERENCE_INVALID", "Workload image must be an approved immutable GHCR digest.");

  const osRelease = await readText("/etc/os-release").catch((error) => { throw fail("OS_RELEASE_UNAVAILABLE", "Ubuntu release metadata could not be read.", error); });
  if (!/^ID=(?:ubuntu|"ubuntu")$/mu.test(osRelease)) throw fail("OS_UNSUPPORTED", "Host Agent version 1 requires Ubuntu.");

  const systemd = await pathStat("/run/systemd/system").catch((error) => { throw fail("SYSTEMD_UNAVAILABLE", "The host must be booted with systemd.", error); });
  requireShape(systemd, (value) => value.isDirectory(), "SYSTEMD_UNAVAILABLE", "The host must be booted with systemd.");
  const dockerSocket = await pathStat("/run/docker.sock").catch((error) => { throw fail("DOCKER_SOCKET_UNAVAILABLE", "Docker Engine Unix socket is unavailable.", error); });
  requireShape(dockerSocket, (value) => value.isSocket(), "DOCKER_SOCKET_UNAVAILABLE", "Docker Engine Unix socket is unavailable.");

  const [gpuCsv, gpuBanner, dockerVersionOutput, runtimeOutput, filesystem] = await Promise.all([
    runCommand("nvidia-smi", ["--query-gpu=uuid,name,memory.total,driver_version", "--format=csv,noheader,nounits"]),
    runCommand("nvidia-smi", []),
    runCommand("/usr/bin/docker", ["version", "--format", "{{.Server.Version}}"]),
    runCommand("/usr/bin/docker", ["info", "--format", "{{json .Runtimes}}"]),
    filesystemStat(inspectedStoragePath),
  ]);

  const gpu = parseNvidiaInventory(gpuCsv.stdout, gpuBanner.stdout);
  const dockerVersion = dockerVersionOutput.stdout.trim();
  if (!/^\d+\.\d+(?:\.\d+)?(?:[-+._A-Za-z0-9]*)?$/u.test(dockerVersion)) throw fail("DOCKER_VERSION_INVALID", "Docker returned an invalid server version.");
  let runtimes;
  try { runtimes = JSON.parse(runtimeOutput.stdout.trim()); }
  catch (error) { throw fail("NVIDIA_RUNTIME_INVALID", "Docker returned an invalid runtime inventory.", error); }
  if (!runtimes || typeof runtimes !== "object" || Array.isArray(runtimes) || !("nvidia" in runtimes)) throw fail("NVIDIA_RUNTIME_MISSING", "Docker is not configured with the NVIDIA container runtime.");

  const availableStorageGiB = Number(filesystem.bavail * filesystem.bsize / 1_073_741_824n);
  if (!Number.isSafeInteger(availableStorageGiB) || availableStorageGiB < 40) throw fail("STORAGE_CAPACITY_LOW", "At least 40 GiB of available storage is required.");
  const memoryMiB = Math.floor(memoryBytes() / 1_048_576);
  if (!Number.isSafeInteger(memoryMiB) || memoryMiB < 8_192) throw fail("HOST_MEMORY_LOW", "At least 8 GiB of host memory is required.");
  await portChecker(ports.sshPortStart, ports.sshPortEnd);

  let workloadImage = { status: "PENDING", image: null };
  if (image) {
    const inspection = await runCommand("/usr/bin/docker", ["image", "inspect", "--format", "{{json .RepoDigests}}", image]);
    let digests;
    try { digests = JSON.parse(inspection.stdout.trim()); }
    catch (error) { throw fail("IMAGE_INSPECTION_INVALID", "Docker returned invalid image digest evidence.", error); }
    if (!Array.isArray(digests) || !digests.includes(image)) throw fail("IMAGE_DIGEST_MISMATCH", "The requested immutable workload image is not present on this host.");
    workloadImage = { status: "READY", image };
  }

  return {
    status: "ok",
    mode: "READ_ONLY",
    system: { os: "ubuntu", systemd: true, nodeVersion, nodeExecutable },
    gpu: { model: gpu.gpuModel, memoryMiB: gpu.gpuMemoryMiB, driverVersion: gpu.driverVersion, cudaVersion: gpu.cudaVersion },
    docker: { version: dockerVersion, nvidiaRuntime: true },
    capacity: { memoryMiB, availableStorageGiB, storagePath: inspectedStoragePath },
    network: {
      publicHost,
      sshPortStart: ports.sshPortStart,
      sshPortEnd: ports.sshPortEnd,
      localPortsAvailable: true,
      controlPlaneReachability: "PENDING",
    },
    workloadImage,
  };
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const result = await runHostPreflight({
    publicHost: options["public-host"],
    sshPortStart: options["ssh-port-start"],
    sshPortEnd: options["ssh-port-end"],
    storagePath: options["storage-path"],
    image: options.image,
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    const code = error instanceof AgentError ? error.code : "HOST_PREFLIGHT_FAILED";
    const message = error instanceof Error ? error.message : "GPU host preflight failed.";
    process.stderr.write(`${JSON.stringify({ status: "failed", code, message })}\n`);
    process.exitCode = 1;
  });
}
