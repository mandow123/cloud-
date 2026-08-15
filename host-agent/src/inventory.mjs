import { execFile as execFileCallback } from "node:child_process";
import { readFile, statfs } from "node:fs/promises";
import { hostname, totalmem } from "node:os";
import { promisify } from "node:util";
import { AgentError, sha256 } from "./protocol.mjs";

const execFile = promisify(execFileCallback);

function positiveInteger(value, field, minimum, maximum) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) throw new AgentError("CONFIG_INVALID", `${field} is invalid.`);
  return number;
}

export function normalizePublicHost(value) {
  const host = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!/^(?=.{3,253}$)(?:[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?|\[[0-9a-f:]+\])$/u.test(host)) {
    throw new AgentError("PUBLIC_HOST_INVALID", "Public host must be an IP address or DNS name without a scheme or path.");
  }
  return host;
}

export function normalizePorts(start, end) {
  const sshPortStart = positiveInteger(start, "sshPortStart", 1024, 65535);
  const sshPortEnd = positiveInteger(end, "sshPortEnd", sshPortStart, 65535);
  if (sshPortEnd - sshPortStart > 199) throw new AgentError("PORT_RANGE_INVALID", "At most 200 managed ports may be declared.");
  return { sshPortStart, sshPortEnd };
}

export function normalizeGpuUuid(value) {
  const uuid = typeof value === "string" ? value.trim() : "";
  if (!/^GPU-[A-Za-z0-9-]{3,80}$/u.test(uuid)) {
    throw new AgentError("GPU_UUID_INVALID", "GPU UUID must be copied exactly from nvidia-smi.");
  }
  return uuid;
}

export function parseNvidiaInventory(csv, banner, requestedGpuUuid) {
  const rows = csv.trim().split(/\r?\n/u).filter(Boolean);
  if (rows.length < 1 || rows.length > 64) throw new AgentError("GPU_INVENTORY_INVALID", "nvidia-smi returned an unsupported GPU inventory size.");
  const parsedRows = rows.map((row) => row.split(",").map((value) => value.trim()));
  if (parsedRows.some((fields) => fields.length !== 4)) throw new AgentError("GPU_INVENTORY_INVALID", "nvidia-smi returned an unexpected inventory shape.");
  const uuids = parsedRows.map(([uuid]) => normalizeGpuUuid(uuid));
  if (new Set(uuids).size !== uuids.length) throw new AgentError("GPU_INVENTORY_INVALID", "nvidia-smi returned duplicate GPU UUIDs.");
  const selectedUuid = requestedGpuUuid == null || requestedGpuUuid === ""
    ? rows.length === 1 ? uuids[0] : (() => { throw new AgentError("GPU_SELECTION_REQUIRED", "Multi-GPU hosts must select one GPU UUID explicitly."); })()
    : normalizeGpuUuid(requestedGpuUuid);
  const selectedIndex = uuids.indexOf(selectedUuid);
  if (selectedIndex < 0) throw new AgentError("GPU_UUID_NOT_FOUND", "The selected GPU UUID is not present on this host.");
  const fields = parsedRows[selectedIndex];
  if (fields.length !== 4) throw new AgentError("GPU_INVENTORY_INVALID", "nvidia-smi returned an unexpected inventory shape.");
  const [uuid, name, memoryText, driverVersion] = fields;
  const gpuMemoryMiB = positiveInteger(Math.round(Number(memoryText)), "gpuMemoryMiB", 20_000, 100_000);
  const normalizedName = name.toUpperCase();
  const gpuModel = normalizedName.includes("RTX 4090")
    ? "RTX_4090"
    : normalizedName.includes("H100")
      ? gpuMemoryMiB > 90_000 ? "H100_94GB" : "H100_80GB"
      : null;
  if (!gpuModel) throw new AgentError("GPU_MODEL_UNSUPPORTED", "Version 1 supports RTX 4090 and H100 only.");
  if (gpuModel === "RTX_4090" && (gpuMemoryMiB < 20_000 || gpuMemoryMiB > 30_000)) throw new AgentError("GPU_MEMORY_INVALID", "RTX 4090 memory is outside the accepted range.");
  if ((gpuModel === "H100_80GB" || gpuModel === "H100_94GB") && (gpuMemoryMiB < 70_000 || gpuMemoryMiB > 100_000)) throw new AgentError("GPU_MEMORY_INVALID", "H100 memory is outside the accepted range.");
  const cudaMatch = /CUDA Version:\s*([0-9]+(?:\.[0-9]+)+)/iu.exec(banner);
  if (!cudaMatch) throw new AgentError("CUDA_VERSION_UNAVAILABLE", "nvidia-smi did not report a CUDA compatibility version.");
  return { uuid, gpuModel, gpuMemoryMiB, driverVersion, cudaVersion: cudaMatch[1] };
}

async function cpuModel() {
  const cpuinfo = await readFile("/proc/cpuinfo", "utf8");
  const match = /^model name\s*:\s*(.+)$/imu.exec(cpuinfo);
  if (!match?.[1]) throw new AgentError("CPU_INVENTORY_INVALID", "CPU model cannot be read from /proc/cpuinfo.");
  return match[1].trim().slice(0, 200);
}

export async function collectInventory({ publicHost, sshPortStart, sshPortEnd, storagePath, gpuUuid }, { includeBinding = false } = {}) {
  const [{ stdout: csv }, { stdout: banner }, cpu, filesystem] = await Promise.all([
    execFile("nvidia-smi", ["--query-gpu=uuid,name,memory.total,driver_version", "--format=csv,noheader,nounits"], { encoding: "utf8", timeout: 15_000, maxBuffer: 64 * 1024 }),
    execFile("nvidia-smi", [], { encoding: "utf8", timeout: 15_000, maxBuffer: 256 * 1024 }),
    cpuModel(),
    statfs(storagePath, { bigint: true }),
  ]).catch((error) => {
    if (error instanceof AgentError) throw error;
    throw new AgentError("INVENTORY_COLLECTION_FAILED", "Host inventory collection failed.", { cause: error });
  });
  const gpu = parseNvidiaInventory(csv, banner, gpuUuid);
  const storageBytes = filesystem.blocks * filesystem.bsize;
  const storageGiB = Number(storageBytes / 1_073_741_824n);
  const inventory = {
    hostnameDigest: sha256(hostname()),
    gpuModel: gpu.gpuModel,
    gpuUuidDigest: sha256(gpu.uuid),
    gpuMemoryMiB: gpu.gpuMemoryMiB,
    driverVersion: gpu.driverVersion,
    cudaVersion: gpu.cudaVersion,
    cpuModel: cpu,
    memoryMiB: Math.floor(totalmem() / 1_048_576),
    storageGiB,
    publicHost: normalizePublicHost(publicHost),
    ...normalizePorts(sshPortStart, sshPortEnd),
  };
  return includeBinding ? { inventory, selectedGpuUuid: gpu.uuid } : inventory;
}
