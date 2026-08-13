import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";

const scriptPath = "scripts/ops/run-local-host-agent-acceptance.mjs";

test("local acceptance Agent can resume one existing device identity without re-pairing", () => {
  const source = readFileSync(scriptPath, "utf8");
  assert.match(source, /KAI_HOSTING_LOCAL_STATE_FILE/u);
  assert.match(source, /await readState\(stateFile\)/u);
  assert.match(source, /event: "local_agent\.resumed"/u);
  assert.match(source, /if \(directory\) await rm\(directory/u);
  assert.equal((source.match(/pairingBundle = await stdinJson\(\)/gu) ?? []).length, 1);
});

test("local acceptance Agent refuses production and arbitrary identity paths", () => {
  const production = spawnSync(process.execPath, [scriptPath], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: { ...process.env, NODE_ENV: "production", KAI_ENVIRONMENT: "LOCAL", KAI_HOSTING_LOCAL_ACCEPTANCE: "1" },
  });
  assert.notEqual(production.status, 0);
  assert.match(production.stderr, /LOCAL_HOST_AGENT_ACCEPTANCE_FORBIDDEN/u);

  const arbitraryPath = spawnSync(process.execPath, [scriptPath], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      NODE_ENV: "test",
      KAI_ENVIRONMENT: "LOCAL",
      KAI_HOSTING_LOCAL_ACCEPTANCE: "1",
      KAI_HOSTING_LOCAL_STATE_FILE: "/Users/kai/.ssh/id_ed25519",
    },
  });
  assert.notEqual(arbitraryPath.status, 0);
  assert.match(arbitraryPath.stderr, /LOCAL_AGENT_STATE_FILE_FORBIDDEN/u);
});
