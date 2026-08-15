import assert from "node:assert/strict";
import test from "node:test";

import { runHostPreflight } from "../host-agent/src/preflight.mjs";

const immutableImage = `ghcr.io/mandow123/kai-cloud-gpu-workload@sha256:${"a".repeat(64)}`;

function dependencies(overrides = {}) {
  const calls = [];
  return {
    calls,
    values: {
      effectiveUid: () => 0,
      nodeVersion: "24.15.0",
      nodeExecutable: "/usr/bin/node",
      readText: async (path) => {
        calls.push(["read", path]);
        return "ID=ubuntu\nVERSION_ID=24.04\n";
      },
      pathStat: async (path) => {
        calls.push(["stat", path]);
        return path === "/run/systemd/system"
          ? { isDirectory: () => true, isSocket: () => false }
          : { isDirectory: () => false, isSocket: () => true };
      },
      runCommand: async (file, args) => {
        calls.push([file, ...args]);
        if (file === "nvidia-smi" && args.length > 0) return { stdout: "GPU-real, NVIDIA GeForce RTX 4090, 24576, 580.10\n" };
        if (file === "nvidia-smi") return { stdout: "NVIDIA-SMI 580.10 CUDA Version: 13.0\n" };
        if (args[0] === "version") return { stdout: "28.0.4\n" };
        if (args[0] === "info") return { stdout: '{"io.containerd.runc.v2":{},"nvidia":{}}\n' };
        if (args[0] === "image") return { stdout: `${JSON.stringify([immutableImage])}\n` };
        throw new Error(`Unexpected command: ${file} ${args.join(" ")}`);
      },
      filesystemStat: async (path) => {
        calls.push(["statfs", path]);
        return { bavail: 100n, bsize: 1_073_741_824n };
      },
      memoryBytes: () => 64 * 1_048_576 * 1_024,
      portChecker: async (start, end) => calls.push(["ports", start, end]),
      ...overrides,
    },
  };
}

test("read-only GPU host preflight validates the entire local range and preserves public reachability as pending", async () => {
  const fixture = dependencies();
  const result = await runHostPreflight({
    publicHost: "GPU-4090.EXAMPLE.COM",
    sshPortStart: "22000",
    sshPortEnd: "22019",
    storagePath: "/var/lib",
    image: immutableImage,
  }, fixture.values);

  assert.equal(result.mode, "READ_ONLY");
  assert.equal(result.gpu.model, "RTX_4090");
  assert.equal(result.docker.nvidiaRuntime, true);
  assert.equal(result.capacity.availableStorageGiB, 100);
  assert.deepEqual(result.network, {
    publicHost: "gpu-4090.example.com",
    sshPortStart: 22_000,
    sshPortEnd: 22_019,
    localPortsAvailable: true,
    controlPlaneReachability: "PENDING",
  });
  assert.deepEqual(result.workloadImage, { status: "READY", image: immutableImage });
  assert.ok(fixture.calls.some((call) => call[0] === "ports" && call[1] === 22_000 && call[2] === 22_019));
  assert.ok(fixture.calls.some((call) => call[0] === "/usr/bin/docker" && call[1] === "image" && call.at(-1) === immutableImage));
});

test("preflight may run before an approved workload digest is available but never reports image readiness", async () => {
  const fixture = dependencies();
  const result = await runHostPreflight({ publicHost: "203.0.113.20", sshPortStart: 22000, sshPortEnd: 22000 }, fixture.values);
  assert.deepEqual(result.workloadImage, { status: "PENDING", image: null });
  assert.equal(fixture.calls.some((call) => call[0] === "/usr/bin/docker" && call[1] === "image"), false);
});

test("preflight selects one exact H100 UUID on an eight-GPU host", async () => {
  const rows = Array.from({ length: 8 }, (_, index) => `GPU-h100-${index}, NVIDIA H100 80GB HBM3, 95830, 580.173.02`).join("\n");
  const fixture = dependencies({
    runCommand: async (file, args) => file === "nvidia-smi" && args.length > 0
      ? { stdout: `${rows}\n` }
      : file === "nvidia-smi"
        ? { stdout: "NVIDIA-SMI 580.173.02 CUDA Version: 13.0\n" }
        : args[0] === "version" ? { stdout: "28.0.4\n" } : { stdout: '{"nvidia":{}}\n' },
  });
  await assert.rejects(runHostPreflight({ publicHost: "gpu.example.com", sshPortStart: 22000, sshPortEnd: 22019 }, fixture.values), (error) => error.code === "GPU_SELECTION_REQUIRED");
  const selected = await runHostPreflight({ publicHost: "gpu.example.com", sshPortStart: 22000, sshPortEnd: 22019, gpuUuid: "GPU-h100-6" }, fixture.values);
  assert.equal(selected.gpu.model, "H100_94GB");
  assert.equal(selected.gpu.memoryMiB, 95_830);
});

test("preflight rejects insufficient authority, user-scoped Node and mutable images before host mutation", async () => {
  const input = { publicHost: "gpu.example.com", sshPortStart: 22000, sshPortEnd: 22019 };
  await assert.rejects(runHostPreflight(input, dependencies({ effectiveUid: () => 1000 }).values), (error) => error.code === "ROOT_REQUIRED");
  await assert.rejects(runHostPreflight(input, dependencies({ nodeExecutable: "/home/user/.nvm/node" }).values), (error) => error.code === "NODE_INSTALLATION_UNSUPPORTED");
  await assert.rejects(runHostPreflight({ ...input, image: "ghcr.io/mandow123/kai-cloud-gpu-workload:latest" }, dependencies().values), (error) => error.code === "IMAGE_REFERENCE_INVALID");
});

test("preflight fails closed on unsupported GPU, absent NVIDIA runtime and occupied managed ports", async () => {
  const base = { publicHost: "gpu.example.com", sshPortStart: 22000, sshPortEnd: 22019 };
  await assert.rejects(runHostPreflight(base, dependencies({
    runCommand: async (file, args) => file === "nvidia-smi" && args.length > 0
      ? { stdout: "GPU-one, NVIDIA GeForce RTX 3090, 24576, 580.10\n" }
      : file === "nvidia-smi"
        ? { stdout: "NVIDIA-SMI 580.10 CUDA Version: 13.0\n" }
        : args[0] === "version" ? { stdout: "28.0.4\n" } : { stdout: '{"nvidia":{}}\n' },
  }).values), (error) => error.code === "GPU_MODEL_UNSUPPORTED");

  await assert.rejects(runHostPreflight(base, dependencies({
    runCommand: async (file, args) => file === "nvidia-smi" && args.length > 0
      ? { stdout: "GPU-real, NVIDIA GeForce RTX 4090, 24576, 580.10\n" }
      : file === "nvidia-smi"
        ? { stdout: "NVIDIA-SMI 580.10 CUDA Version: 13.0\n" }
        : args[0] === "version" ? { stdout: "28.0.4\n" } : { stdout: '{"runc":{}}\n' },
  }).values), (error) => error.code === "NVIDIA_RUNTIME_MISSING");

  await assert.rejects(runHostPreflight(base, dependencies({
    portChecker: async () => { const error = new Error("in use"); error.code = "MANAGED_PORT_UNAVAILABLE"; throw error; },
  }).values), (error) => error.code === "MANAGED_PORT_UNAVAILABLE");
});
