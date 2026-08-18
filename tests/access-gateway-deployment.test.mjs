import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { gatewayOptionsFromEnvironment } from "../access-gateway/src/config.mjs";
import {
  gatewayValidationEnvironment,
  renderComposeTemplate,
  validateAccessGatewayDeployment,
} from "../scripts/ops/validate-access-gateway-deployment.mjs";

const composeSource = readFileSync(new URL("../deploy/compose.production.yml", import.meta.url), "utf8");
const environmentSource = readFileSync(new URL("../deploy/kai-cloud-app.env.example", import.meta.url), "utf8");

function cliEnvironment(overrides = {}) {
  return {
    KAI_GATEWAY_DB_PATH: "/var/lib/kai-access-gateway/gateway.sqlite",
    KAI_GATEWAY_CONTROL_TOKEN: "1f".repeat(32),
    KAI_GATEWAY_TICKET_PEPPER: "2e".repeat(32),
    KAI_GATEWAY_PUBLIC_HOST: "gateway.cloud.kai.com",
    KAI_GATEWAY_CONTROL_HOST: "127.0.0.1",
    KAI_GATEWAY_CONTROL_PORT: "7080",
    KAI_GATEWAY_TUNNEL_HOST: "0.0.0.0",
    KAI_GATEWAY_TUNNEL_PORT: "7443",
    KAI_GATEWAY_BUYER_HOST: "0.0.0.0",
    KAI_GATEWAY_PUBLIC_PORT_START: "22000",
    KAI_GATEWAY_PUBLIC_PORT_END: "22999",
    KAI_GATEWAY_TLS_CERT: "/etc/kai-gateway/tls.crt",
    KAI_GATEWAY_TLS_KEY: "/etc/kai-gateway/tls.key",
    ...overrides,
  };
}

test("Gateway CLI startup parameters reject placeholders, ambiguous endpoints and overlapping ports", () => {
  const valid = gatewayOptionsFromEnvironment(cliEnvironment());
  assert.equal(valid.controlPort, 7080);
  assert.equal(valid.tunnelPort, 7443);
  assert.equal(valid.publicHost, "gateway.cloud.kai.com");
  assert.throws(() => gatewayOptionsFromEnvironment(cliEnvironment({ KAI_GATEWAY_CONTROL_TOKEN: "replace-with-a-long-control-token-value" })), /non-placeholder/u);
  assert.throws(() => gatewayOptionsFromEnvironment(cliEnvironment({ KAI_GATEWAY_TICKET_PEPPER: "1f".repeat(32) })), /different secrets/u);
  assert.throws(() => gatewayOptionsFromEnvironment(cliEnvironment({ KAI_GATEWAY_PUBLIC_HOST: "https://gateway.cloud.kai.com/path" })), /fully-qualified DNS/u);
  assert.throws(() => gatewayOptionsFromEnvironment(cliEnvironment({ KAI_GATEWAY_TUNNEL_PORT: "22000" })), /must not overlap/u);
  assert.throws(() => gatewayOptionsFromEnvironment(cliEnvironment({ KAI_GATEWAY_DB_PATH: "relative/gateway.sqlite" })), /absolute non-root path/u);
  assert.throws(() => gatewayOptionsFromEnvironment(cliEnvironment({ KAI_GATEWAY_PUBLIC_PORT_END: "99999" })), /allowed range/u);
});

test("Docker-independent Compose rendering enforces required values and applies defaults", () => {
  assert.equal(renderComposeTemplate("port=${PORT:-7443}", {}), "port=7443");
  assert.equal(renderComposeTemplate("port=${PORT:-7443}", { PORT: "8443" }), "port=8443");
  assert.throws(() => renderComposeTemplate("token=${TOKEN:?token required}", {}), /TOKEN: token required/u);
});

test("production Gateway profile renders with isolated control networking and no inherited app command", () => {
  const rendered = validateAccessGatewayDeployment({ composeSource, environmentSource, environment: gatewayValidationEnvironment() });
  assert.deepEqual(rendered, {
    status: "ok",
    service: "kai-access-gateway",
    publicHost: "gateway.cloud.kai.com",
    controlPortPublished: false,
    tunnelPort: 7443,
    buyerPortStart: 22000,
    buyerPortEnd: 22999,
  });
  assert.throws(
    () => validateAccessGatewayDeployment({ composeSource, environmentSource, environment: gatewayValidationEnvironment({ KAI_GATEWAY_TUNNEL_PORT: "22000" }) }),
    /must not overlap/u,
  );
});
