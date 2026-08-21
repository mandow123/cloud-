import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const contract = readFileSync("docs/contracts/kai-cloud-public-v1.openapi.yaml", "utf8");

function endpointSection(path) {
  const start = contract.indexOf(`  ${path}:`);
  assert.notEqual(start, -1, `missing ${path}`);
  const remainder = contract.slice(start);
  const boundary = remainder.search(/\n(?=  \/api\/public\/v1\/|webhooks:|components:)/u);
  return boundary === -1 ? remainder : remainder.slice(0, boundary);
}

test("public OpenAPI canonically separates OAuth, challenge, and signed-device authentication", () => {
  assert.match(contract, /\/api\/public\/v1\/oauth\/token:\s+post:\s+operationId: issuePartnerAccessToken\s+security: \[\]/u);
  assert.match(contract, /tokenUrl: https:\/\/sandbox-auth\.cloud\.kai\.com\/api\/public\/v1\/oauth\/token/u);
  assert.match(contract, /\/api\/public\/v1\/agent-challenges:\s+post:\s+operationId: createAgentChallenge\s+security: \[\{ oauthClient: \[agent:write\] \}\]/u);
  const register = endpointSection("/api/public/v1/devices/register");
  assert.match(register, /operationId: registerSignedDevice/u);
  assert.match(register, /security: \[\]/u);
  assert.doesNotMatch(register, /oauthClient/u);
  const heartbeat = endpointSection("/api/public/v1/devices/{deviceId}/heartbeats");
  assert.match(heartbeat, /operationId: recordSignedDeviceHeartbeat/u);
  assert.match(heartbeat, /security: \[\]/u);
  assert.doesNotMatch(heartbeat, /oauthClient/u);
  assert.match(heartbeat, /description: Authenticated by the registered device key and a monotonic sequence\./u);
});