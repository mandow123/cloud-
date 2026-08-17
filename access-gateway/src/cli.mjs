#!/usr/bin/env node
import { KaiAccessGateway } from "./gateway.mjs";

const required = (name) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
};
const integer = (name, fallback) => {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value)) throw new Error(`${name} is invalid.`);
  return value;
};

const gateway = new KaiAccessGateway({
  dbPath: required("KAI_GATEWAY_DB_PATH"),
  controlToken: required("KAI_GATEWAY_CONTROL_TOKEN"),
  ticketPepper: required("KAI_GATEWAY_TICKET_PEPPER"),
  publicHost: required("KAI_GATEWAY_PUBLIC_HOST"),
  controlHost: process.env.KAI_GATEWAY_CONTROL_HOST?.trim() || "127.0.0.1",
  controlPort: integer("KAI_GATEWAY_CONTROL_PORT", 7080),
  tunnelHost: process.env.KAI_GATEWAY_TUNNEL_HOST?.trim() || "0.0.0.0",
  tunnelPort: integer("KAI_GATEWAY_TUNNEL_PORT", 7443),
  buyerHost: process.env.KAI_GATEWAY_BUYER_HOST?.trim() || "0.0.0.0",
  publicPortStart: integer("KAI_GATEWAY_PUBLIC_PORT_START", 22000),
  publicPortEnd: integer("KAI_GATEWAY_PUBLIC_PORT_END", 22999),
  tlsCertPath: required("KAI_GATEWAY_TLS_CERT"),
  tlsKeyPath: required("KAI_GATEWAY_TLS_KEY"),
  logger: (entry) => process.stdout.write(`${JSON.stringify(entry)}\n`),
});

await gateway.start();
const shutdown = async () => { await gateway.stop(); process.exit(0); };
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
