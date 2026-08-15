import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("public Host Agent guide uses verified downloads and never recommends piping code to root", () => {
  const guide = readFileSync("app/guides/host-agent/page.tsx", "utf8");
  assert.match(guide, /\/downloads\/\$\{ARCHIVE\}/u);
  assert.match(guide, /\/downloads\/\$\{ARCHIVE\}\.sha256/u);
  assert.match(guide, /sha256sum --check/u);
  assert.match(guide, /less release-manifest\.json/u);
  assert.match(guide, /sudo node \.\/src\/preflight\.mjs/u);
  assert.match(guide, /nvidia-smi --query-gpu=uuid,name,memory\.total/u);
  assert.match(guide, /--gpu-uuid/u);
  assert.match(guide, /controlPlaneReachability: PENDING/u);
  assert.match(guide, /sudo -u kai-host-agent -- kai-host-agent doctor/u);
  assert.match(guide, /sudo -u kai-host-agent -- kai-host-agent pair/u);
  assert.match(guide, /--pairing-file \/var\/lib\/kai-host-agent\/pairing\.json/u);
  assert.match(guide, /kai-host-agent check-connection/u);
  assert.match(guide, /connection\.verified/u);
  assert.match(guide, /OFFLINE 状态/u);
  assert.doesNotMatch(guide, /< \/var\/lib\/kai-host-agent\/pairing\.json/u);
  assert.match(guide, /`latest`、普通 tag 和任意第三方仓库都会被拒绝/u);
  assert.doesNotMatch(guide, /curl[^\n|]*\||wget[^\n|]*\||ghcr\.io\/[A-Za-z0-9._/-]+:latest/u);
});

test("personal GPU entry points use the independent guide route instead of the old listing anchor", () => {
  const sources = [
    "app/hosting/page.tsx",
    "app/hosting/personal-gpu/page.tsx",
    "components/gpu-cloud-lab.tsx",
    "components/nav-links.tsx",
    "components/supply-resource-registration.tsx",
    "host-agent/kai-host-agent.service",
  ].map((path) => readFileSync(path, "utf8")).join("\n");
  assert.match(sources, /\/guides\/host-agent/u);
  assert.doesNotMatch(sources, /\/guides#list-4090/u);
});
