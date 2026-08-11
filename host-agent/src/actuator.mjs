import { execFile as execFileCallback } from "node:child_process";
import { chmod, chown, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { promisify } from "node:util";
import { AgentError, digestJson } from "./protocol.mjs";

const execFile = promisify(execFileCallback);
const IMAGE_PATTERN = /^ghcr\.io\/kai-cloud\/[a-z0-9._/-]+@sha256:[a-f0-9]{64}$/u;
const ID_PATTERN = /^(?:hcmd|hctr)_[a-z0-9]{8,80}$/u;
const PUBLIC_KEY_PATTERN = /^ssh-(?:ed25519|rsa) [A-Za-z0-9+/=]{40,8192}(?: [^\r\n]{1,120})?$/u;

function fail(code, message, cause) {
  return new AgentError(code, message, cause ? { cause } : undefined);
}

function approvedImages(environment) {
  const values = (environment.KAI_HOSTING_APPROVED_IMAGES ?? "").split(/[\n,]/u).map((value) => value.trim()).filter(Boolean);
  if (values.length === 0 || values.length > 20 || new Set(values).size !== values.length || values.some((value) => !IMAGE_PATTERN.test(value))) {
    throw fail("IMAGE_POLICY_INVALID", "Actuator image policy is missing or invalid.");
  }
  return new Set(values);
}

function stateRoot(environment) {
  const root = environment.KAI_HOST_ACTUATOR_STATE_DIR?.trim() || "/var/lib/kai-host-actuator";
  if (!isAbsolute(root) || !/^\/[A-Za-z0-9._/-]{3,200}$/u.test(root) || root.includes("..")) throw fail("ACTUATOR_STATE_ROOT_INVALID", "Actuator state root is invalid.");
  return root;
}

export function parseProvisionRequest(value, environment = process.env) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw fail("PROVISION_REQUEST_INVALID", "Provision request must be an object.");
  const input = value;
  if (input.protocolVersion !== 1 || input.operation !== "PROVISION") throw fail("PROVISION_REQUEST_INVALID", "Provision protocol is unsupported.");
  if (typeof input.commandId !== "string" || !ID_PATTERN.test(input.commandId) || typeof input.contractId !== "string" || !ID_PATTERN.test(input.contractId)) throw fail("PROVISION_ID_INVALID", "Provision identifiers are invalid.");
  if (typeof input.image !== "string" || !IMAGE_PATTERN.test(input.image) || !approvedImages(environment).has(input.image)) throw fail("IMAGE_NOT_APPROVED", "Provision image is not in the root-owned allowlist.");
  if (typeof input.publicKey !== "string" || !PUBLIC_KEY_PATTERN.test(input.publicKey.trim())) throw fail("PUBLIC_KEY_INVALID", "Provision SSH public key is invalid.");
  if (typeof input.publicHost !== "string" || !/^(?:[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?|\[[0-9a-f:]+\])$/u.test(input.publicHost)) throw fail("PUBLIC_HOST_INVALID", "Provision public host is invalid.");
  if (!Number.isSafeInteger(input.sshPort) || input.sshPort < 1024 || input.sshPort > 65535) throw fail("SSH_PORT_INVALID", "Provision SSH port is invalid.");
  if (!Number.isSafeInteger(input.memoryMiB) || input.memoryMiB < 8_192 || input.memoryMiB > 4_194_304) throw fail("MEMORY_LIMIT_INVALID", "Provision memory limit is invalid.");
  if (input.gpuCount !== 1) throw fail("GPU_COUNT_UNSUPPORTED", "Provisioning supports exactly one GPU.");
  return {
    protocolVersion: 1,
    operation: "PROVISION",
    commandId: input.commandId,
    contractId: input.contractId,
    image: input.image,
    publicKey: input.publicKey.trim(),
    publicHost: input.publicHost,
    sshPort: input.sshPort,
    memoryMiB: input.memoryMiB,
    gpuCount: 1,
  };
}

async function docker(args) {
  try {
    return await execFile("/usr/bin/docker", args, { encoding: "utf8", timeout: 30_000, maxBuffer: 256 * 1024 });
  } catch (error) {
    throw fail("DOCKER_OPERATION_FAILED", "The isolated container operation failed.", error);
  }
}

async function writeJsonAtomic(path, value) {
  const temporary = `${path}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: "w" });
  await chmod(temporary, 0o600);
  await rename(temporary, path);
  await chmod(path, 0o600);
}

async function existingResult(manifestPath, requestDigest) {
  try {
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    if (manifest.requestDigest !== requestDigest) throw fail("PROVISION_REPLAY_CONFLICT", "Existing workload belongs to a different provision request.");
    if (manifest.status === "READY" && manifest.result) return manifest.result;
    throw fail("PROVISION_RECOVERY_REQUIRED", "A previous provision attempt did not complete cleanly and requires operator recovery.");
  } catch (error) {
    if (error instanceof AgentError) throw error;
    if (error?.code === "ENOENT") return null;
    throw fail("PROVISION_MANIFEST_INVALID", "Existing workload manifest cannot be trusted.", error);
  }
}

export async function executeProvision(value, {
  environment = process.env,
  runDocker = docker,
  changeOwner = chown,
  now = () => new Date().toISOString(),
} = {}) {
  const request = parseProvisionRequest(value, environment);
  const requestDigest = digestJson(request);
  const workloadName = `kai-${digestJson({ contractId: request.contractId }).slice(7, 31)}`;
  const workloadRoot = join(stateRoot(environment), "workloads", workloadName);
  const manifestPath = join(workloadRoot, "manifest.json");
  const replay = await existingResult(manifestPath, requestDigest);
  if (replay) return replay;

  await mkdir(workloadRoot, { recursive: true, mode: 0o700 });
  await writeJsonAtomic(manifestPath, { protocolVersion: 1, status: "CREATING", requestDigest, commandId: request.commandId, contractId: request.contractId, createdAt: now() });
  const workspace = join(workloadRoot, "workspace");
  const authorizedKeys = join(workloadRoot, "authorized_keys");
  try {
    await mkdir(workspace, { mode: 0o700 });
    await changeOwner(workspace, 1000, 1000);
    await writeFile(authorizedKeys, `${request.publicKey}\n`, { mode: 0o400, flag: "wx" });
    await changeOwner(authorizedKeys, 1000, 1000);

    const inspected = await runDocker(["image", "inspect", "--format", "{{json .RepoDigests}}", request.image]);
    const repoDigests = JSON.parse(inspected.stdout.trim());
    if (!Array.isArray(repoDigests) || !repoDigests.includes(request.image)) throw fail("IMAGE_DIGEST_MISMATCH", "Local OCI image does not match the approved digest.");

    const memoryLimitMiB = Math.max(8_192, Math.floor(request.memoryMiB * 0.8));
    const created = await runDocker([
      "container", "create",
      "--name", workloadName,
      "--label", "kai.cloud.managed=true",
      "--label", `kai.cloud.contract-digest=${digestJson({ contractId: request.contractId })}`,
      "--pull", "never",
      "--gpus", "device=0",
      "--network", "bridge",
      "--publish", `${request.sshPort}:2222/tcp`,
      "--read-only",
      "--user", "1000:1000",
      "--cap-drop", "ALL",
      "--security-opt", "no-new-privileges:true",
      "--pids-limit", "1024",
      "--memory", `${memoryLimitMiB}m`,
      "--shm-size", "8g",
      "--tmpfs", "/tmp:rw,noexec,nosuid,nodev,size=4g,uid=1000,gid=1000,mode=1777",
      "--mount", `type=bind,src=${workspace},dst=/workspace`,
      "--mount", `type=bind,src=${authorizedKeys},dst=/home/kai/.ssh/authorized_keys,readonly`,
      "--workdir", "/workspace",
      "--restart", "no",
      request.image,
    ]);
    const containerId = created.stdout.trim();
    if (!/^[a-f0-9]{64}$/u.test(containerId)) throw fail("CONTAINER_ID_INVALID", "Container runtime returned an invalid identifier.");
    const observedAt = now();
    const result = {
      protocolVersion: 1,
      contractId: request.contractId,
      image: request.image,
      endpointDisplay: `${request.publicHost}:${request.sshPort}`,
      containerDigest: digestJson({ containerId }),
      workspaceDigest: digestJson({ workloadName, requestDigest }),
      observedAt,
    };
    await writeJsonAtomic(manifestPath, { protocolVersion: 1, status: "READY", requestDigest, result, createdAt: observedAt, updatedAt: observedAt });
    return result;
  } catch (error) {
    const code = error instanceof AgentError ? error.code : "PROVISION_FAILED";
    await writeJsonAtomic(manifestPath, { protocolVersion: 1, status: "FAILED", requestDigest, errorCode: code, updatedAt: now() }).catch(() => undefined);
    if (error instanceof AgentError) throw error;
    throw fail("PROVISION_FAILED", "The isolated workload could not be provisioned.", error);
  }
}
