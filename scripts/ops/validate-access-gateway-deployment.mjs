#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { gatewayOptionsFromEnvironment } from "../../access-gateway/src/config.mjs";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

export function renderComposeTemplate(source, environment) {
  return source.replace(/\$\{([A-Z][A-Z0-9_]*)(?:(:-|:\?)([^}]*))?\}/gu, (_match, name, operator, operand = "") => {
    const value = environment[name];
    if (operator === ":?" && !value) throw new Error(`${name}: ${operand || "required Compose variable is missing"}`);
    if (operator === ":-" && !value) return operand;
    return value ?? "";
  });
}

function serviceBlock(source, name) {
  const match = new RegExp(`^  ${name}:\\n(?<body>[\\s\\S]*?)(?=^  [a-z0-9-]+:|^networks:|(?![\\s\\S]))`, "mu").exec(source);
  if (!match?.groups?.body) throw new Error(`Compose service ${name} is missing.`);
  return `  ${name}:\n${match.groups.body}`;
}

function nestedBlock(service, name) {
  const match = new RegExp(`^    ${name}:\\n(?<body>[\\s\\S]*?)(?=^    [a-z_][a-z0-9_-]*:|(?![\\s\\S]))`, "mu").exec(service);
  return match?.groups?.body ?? "";
}

export function gatewayValidationEnvironment(overrides = {}) {
  return {
    KAI_IMAGE: `registry.example.test/kai-cloud-market@sha256:${"a1b2".repeat(16)}`,
    KAI_RELEASE_SHA: "0123456789abcdef0123456789abcdef01234567",
    KAI_ACCESS_GATEWAY_CONTROL_TOKEN: "1f".repeat(32),
    KAI_GATEWAY_TICKET_PEPPER: "2e".repeat(32),
    KAI_GATEWAY_PUBLIC_HOST: "gateway.cloud.kai.com",
    KAI_GATEWAY_TUNNEL_PORT: "7443",
    KAI_GATEWAY_PUBLIC_PORT_START: "22000",
    KAI_GATEWAY_PUBLIC_PORT_END: "22999",
    KAI_GATEWAY_TLS_DIR: "/etc/kai-cloud/gateway-tls",
    KAI_STATE_ROOT: "/opt/kai-cloud-3051",
    ...overrides,
  };
}

export function validateAccessGatewayDeployment({ composeSource, environmentSource, environment = gatewayValidationEnvironment() }) {
  const rawGateway = serviceBlock(composeSource, "access-gateway");
  const gateway = renderComposeTemplate(rawGateway, environment);
  const app = serviceBlock(composeSource, "app");
  const ports = nestedBlock(gateway, "ports");
  const networks = nestedBlock(gateway, "networks");
  const tunnelPort = Number(environment.KAI_GATEWAY_TUNNEL_PORT || 7443);
  const publicPortStart = Number(environment.KAI_GATEWAY_PUBLIC_PORT_START || 22000);
  const publicPortEnd = Number(environment.KAI_GATEWAY_PUBLIC_PORT_END || 22999);

  gatewayOptionsFromEnvironment({
    KAI_GATEWAY_DB_PATH: "/app/gateway/kai-access-gateway.sqlite",
    KAI_GATEWAY_CONTROL_TOKEN: environment.KAI_ACCESS_GATEWAY_CONTROL_TOKEN,
    KAI_GATEWAY_TICKET_PEPPER: environment.KAI_GATEWAY_TICKET_PEPPER,
    KAI_GATEWAY_PUBLIC_HOST: environment.KAI_GATEWAY_PUBLIC_HOST,
    KAI_GATEWAY_CONTROL_HOST: "0.0.0.0",
    KAI_GATEWAY_CONTROL_PORT: "7080",
    KAI_GATEWAY_TUNNEL_HOST: "0.0.0.0",
    KAI_GATEWAY_TUNNEL_PORT: String(tunnelPort),
    KAI_GATEWAY_BUYER_HOST: "0.0.0.0",
    KAI_GATEWAY_PUBLIC_PORT_START: String(publicPortStart),
    KAI_GATEWAY_PUBLIC_PORT_END: String(publicPortEnd),
    KAI_GATEWAY_TLS_CERT: "/run/kai-gateway-tls/tls.crt",
    KAI_GATEWAY_TLS_KEY: "/run/kai-gateway-tls/tls.key",
  });

  assert(!gateway.includes("${"), "rendered access-gateway service contains an unresolved Compose variable");
  assert(gateway.includes('profiles: ["gateway"]'), "access-gateway must remain behind the explicit gateway profile");
  assert(gateway.includes(`image: "${environment.KAI_IMAGE}"`), "access-gateway must use the rendered immutable application image");
  assert(gateway.includes('entrypoint: ["node", "access-gateway/src/cli.mjs"]') && gateway.includes("command: []"), "access-gateway must not inherit the application server command");
  assert(gateway.includes("read_only: true") && gateway.includes('user: "1000:1000"'), "access-gateway must run non-root with a read-only root filesystem");
  assert(gateway.includes("- ALL") && gateway.includes("- no-new-privileges:true"), "access-gateway must drop capabilities and prevent privilege escalation");
  assert(gateway.includes("KAI_GATEWAY_CONTROL_HOST: 0.0.0.0") && gateway.includes('KAI_GATEWAY_CONTROL_PORT: "7080"'), "access-gateway control listener must use its fixed internal port");
  assert(ports.includes(`- "${tunnelPort}:${tunnelPort}"`), "access-gateway tunnel port mapping is missing or asymmetric");
  assert(ports.includes(`- "${publicPortStart}-${publicPortEnd}:${publicPortStart}-${publicPortEnd}"`), "access-gateway buyer port range mapping is missing or asymmetric");
  assert(!/^      - .*7080.*$/mu.test(ports), "access-gateway control port must never be published on the host");
  assert(gateway.includes("http://127.0.0.1:7080/health"), "access-gateway healthcheck must use the internal health endpoint");
  assert(gateway.includes("target: /app/gateway") && gateway.includes("target: /run/kai-gateway-tls") && gateway.includes("read_only: true"), "access-gateway must persist its database and mount TLS material read-only");
  assert(networks.includes("- gateway-control") && !networks.includes("- default"), "access-gateway must attach only to the isolated control network");
  assert(app.includes("KAI_ACCESS_GATEWAY_CONTROL_URL: \"${KAI_ACCESS_GATEWAY_CONTROL_URL:-}\"") && app.includes("- gateway-control"), "app must reach the Gateway only through the isolated Compose network");
  assert(/^networks:\n  gateway-control:\n    internal: true$/mu.test(composeSource), "gateway-control network must be internal");
  for (const variable of [
    "KAI_ACCESS_GATEWAY_CONTROL_URL", "KAI_ACCESS_GATEWAY_CONTROL_TOKEN", "KAI_GATEWAY_TICKET_PEPPER",
    "KAI_GATEWAY_PUBLIC_HOST", "KAI_GATEWAY_TUNNEL_PORT", "KAI_GATEWAY_PUBLIC_PORT_START",
    "KAI_GATEWAY_PUBLIC_PORT_END", "KAI_GATEWAY_TLS_DIR",
  ]) assert(new RegExp(`^${variable}=`, "mu").test(environmentSource), `environment example is missing ${variable}`);

  return {
    status: "ok",
    service: "kai-access-gateway",
    publicHost: environment.KAI_GATEWAY_PUBLIC_HOST,
    controlPortPublished: false,
    tunnelPort,
    buyerPortStart: publicPortStart,
    buyerPortEnd: publicPortEnd,
  };
}

async function main() {
  const projectRoot = resolve(import.meta.dirname, "../..");
  const [composeSource, environmentSource] = await Promise.all([
    readFile(resolve(projectRoot, "deploy/compose.production.yml"), "utf8"),
    readFile(resolve(projectRoot, "deploy/kai-cloud-app.env.example"), "utf8"),
  ]);
  return validateAccessGatewayDeployment({ composeSource, environmentSource });
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  main()
    .then((result) => process.stdout.write(`${JSON.stringify(result)}\n`))
    .catch((error) => { process.stderr.write(`ACCESS_GATEWAY_DEPLOYMENT_INVALID: ${error.message}\n`); process.exitCode = 1; });
}
