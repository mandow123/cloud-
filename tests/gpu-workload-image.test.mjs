import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("GPU workload uses a pinned CUDA base and the Host Agent runtime contract", () => {
  const dockerfile = readFileSync("workload/Dockerfile", "utf8");
  assert.match(dockerfile, /^FROM nvidia\/cuda:12\.8\.1-runtime-ubuntu24\.04@sha256:[a-f0-9]{64}$/mu);
  assert.match(dockerfile, /USER 1000:1000/u);
  assert.match(dockerfile, /install -d -o root -g root -m 0755 \/run\/sshd/u);
  assert.match(dockerfile, /sshd -t -f \/etc\/ssh\/sshd_config -h \/tmp\/kai-build-host-key/u);
  assert.doesNotMatch(dockerfile, /\|\| true/u);
  assert.match(dockerfile, /WORKDIR \/workspace/u);
  assert.match(dockerfile, /EXPOSE 2222/u);
  assert.doesNotMatch(dockerfile, /(?:^|\s)(?:latest|sudo)(?:\s|$)/u);

  const entrypoint = readFileSync("workload/entrypoint.sh", "utf8");
  assert.match(entrypoint, /authorized_keys/u);
  assert.match(entrypoint, /nvidia-smi --query-gpu=uuid,name,memory\.total/u);
  assert.match(entrypoint, /requires exactly one GPU/u);
  assert.match(entrypoint, /ssh-keygen -q -t ed25519/u);

  const sshd = readFileSync("workload/sshd_config", "utf8");
  for (const rule of ["Port 2222", "PasswordAuthentication no", "PermitRootLogin no", "AuthenticationMethods publickey", "AllowUsers kai", "PermitUserEnvironment no"]) assert.match(sshd, new RegExp(rule, "u"));
});

test("workload publication is manual, least-privilege and immutable", () => {
  const workflow = readFileSync(".github/workflows/publish-gpu-workload.yml", "utf8");
  assert.match(workflow, /workflow_dispatch:/u);
  assert.doesNotMatch(workflow, /\bpush:/u);
  assert.match(workflow, /contents: read/u);
  assert.match(workflow, /packages: write/u);
  assert.match(workflow, /actions\/checkout@[a-f0-9]{40}/u);
  assert.match(workflow, /--tag "\$image:\$GITHUB_SHA"/u);
  assert.match(workflow, /image="ghcr\.io\/\$owner\/kai-cloud-gpu-workload"/u);
  assert.match(workflow, /RepoDigests/u);
  assert.doesNotMatch(workflow, /:latest/u);
});
