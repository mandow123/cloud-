import { isIP } from "node:net";
import { isAbsolute } from "node:path";

const PLACEHOLDER = /(?:replace|change|example|placeholder|secret|password|token)/iu;

function required(environment, name) {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function secret(environment, name) {
  const value = required(environment, name);
  if (value.length < 32 || PLACEHOLDER.test(value)) throw new Error(`${name} must contain at least 32 non-placeholder characters.`);
  return value;
}

function integer(environment, name, fallback, minimum, maximum) {
  const raw = environment[name]?.trim() || String(fallback);
  if (!/^(?:0|[1-9][0-9]*)$/u.test(raw)) throw new Error(`${name} is invalid.`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new Error(`${name} is outside its allowed range.`);
  return value;
}

function absolutePath(environment, name) {
  const value = required(environment, name);
  if (!isAbsolute(value) || value === "/") throw new Error(`${name} must be an absolute non-root path.`);
  return value;
}

function bindHost(environment, name, fallback) {
  const value = environment[name]?.trim() || fallback;
  if (isIP(value) === 0) throw new Error(`${name} must be an IPv4 or IPv6 bind address.`);
  return value;
}

function publicHost(environment) {
  const value = required(environment, "KAI_GATEWAY_PUBLIC_HOST").toLowerCase();
  if (isIP(value) === 6) throw new Error("KAI_GATEWAY_PUBLIC_HOST does not support an unbracketed IPv6 buyer endpoint.");
  if (isIP(value) === 4) return value;
  if (value.length > 253 || !value.includes(".") || value.split(".").some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(label))) {
    throw new Error("KAI_GATEWAY_PUBLIC_HOST must be a fully-qualified DNS name or IPv4 address.");
  }
  return value;
}

export function gatewayOptionsFromEnvironment(environment = process.env) {
  const controlToken = secret(environment, "KAI_GATEWAY_CONTROL_TOKEN");
  const ticketPepper = secret(environment, "KAI_GATEWAY_TICKET_PEPPER");
  if (controlToken === ticketPepper) throw new Error("KAI_GATEWAY_CONTROL_TOKEN and KAI_GATEWAY_TICKET_PEPPER must be different secrets.");
  const publicPortStart = integer(environment, "KAI_GATEWAY_PUBLIC_PORT_START", 22000, 1024, 65535);
  const publicPortEnd = integer(environment, "KAI_GATEWAY_PUBLIC_PORT_END", 22999, publicPortStart, 65535);
  if (publicPortEnd - publicPortStart > 9999) throw new Error("KAI_GATEWAY_PUBLIC_PORT range cannot contain more than 10000 ports.");
  const controlPort = integer(environment, "KAI_GATEWAY_CONTROL_PORT", 7080, 1, 65535);
  const tunnelPort = integer(environment, "KAI_GATEWAY_TUNNEL_PORT", 7443, 1, 65535);
  if (controlPort === tunnelPort || (controlPort >= publicPortStart && controlPort <= publicPortEnd) || (tunnelPort >= publicPortStart && tunnelPort <= publicPortEnd)) {
    throw new Error("Gateway control, tunnel and buyer ports must not overlap.");
  }
  const tlsCertPath = absolutePath(environment, "KAI_GATEWAY_TLS_CERT");
  const tlsKeyPath = absolutePath(environment, "KAI_GATEWAY_TLS_KEY");
  if (tlsCertPath === tlsKeyPath) throw new Error("KAI_GATEWAY_TLS_CERT and KAI_GATEWAY_TLS_KEY must be different files.");
  return {
    dbPath: absolutePath(environment, "KAI_GATEWAY_DB_PATH"),
    controlToken,
    ticketPepper,
    publicHost: publicHost(environment),
    controlHost: bindHost(environment, "KAI_GATEWAY_CONTROL_HOST", "127.0.0.1"),
    controlPort,
    tunnelHost: bindHost(environment, "KAI_GATEWAY_TUNNEL_HOST", "0.0.0.0"),
    tunnelPort,
    buyerHost: bindHost(environment, "KAI_GATEWAY_BUYER_HOST", "0.0.0.0"),
    publicPortStart,
    publicPortEnd,
    tlsCertPath,
    tlsKeyPath,
  };
}
