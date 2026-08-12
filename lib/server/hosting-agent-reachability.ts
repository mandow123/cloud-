import { lookup } from "node:dns/promises";
import { BlockList, connect, isIP } from "node:net";
import { AccountAuthError } from "./account-auth.ts";
import { hostingAgentDigest } from "./hosting-agent-crypto.ts";
import type { HostingAgentCommand, HostingDevice } from "../hosting-v2.ts";

const blocked = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
  ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24],
  ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) blocked.addSubnet(network, prefix, "ipv4");
for (const [network, prefix] of [
  ["::", 128], ["::1", 128], ["::ffff:0:0", 96], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8], ["2001:db8::", 32],
] as const) blocked.addSubnet(network, prefix, "ipv6");

function error(code: string, message: string) {
  return new AccountAuthError(code, 409, message);
}

async function publicAddresses(host: string) {
  const literal = host.replace(/^\[|\]$/gu, "");
  let records;
  try {
    records = isIP(literal) ? [{ address: literal, family: isIP(literal) }] : await lookup(literal, { all: true, verbatim: true });
  } catch {
    throw error("AGENT_PUBLIC_HOST_UNRESOLVED", "Cloud 控制面无法解析设备公网入口。 ");
  }
  const unique = [...new Map(records.map((record) => [`${record.family}:${record.address}`, record])).values()];
  if (unique.length === 0 || unique.some((record) => blocked.check(record.address, record.family === 4 ? "ipv4" : "ipv6"))) {
    throw error("AGENT_PUBLIC_HOST_NOT_GLOBAL", "设备入口必须只解析到可公开路由的公网地址。 ");
  }
  return unique;
}

async function readChallenge(address: string, family: number, port: number, expected: string) {
  await new Promise<void>((resolve, reject) => {
    const socket = connect({ host: address, family, port });
    let body = "";
    let settled = false;
    const finish = (failure?: Error) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (failure) reject(failure); else resolve();
    };
    socket.setEncoding("utf8");
    socket.setTimeout(8_000, () => finish(error("AGENT_PUBLIC_PORT_TIMEOUT", "Cloud 控制面无法在时限内连接设备公网端口。 ")));
    socket.on("data", (chunk) => {
      body += chunk;
      if (body.length > 256) return finish(error("AGENT_PUBLIC_CHALLENGE_INVALID", "设备公网端口返回了无效挑战。 "));
      if (body.includes("\n")) finish(body === expected ? undefined : error("AGENT_PUBLIC_CHALLENGE_INVALID", "设备公网端口未返回本次一次性挑战。 "));
    });
    socket.once("end", () => finish(body === expected ? undefined : error("AGENT_PUBLIC_CHALLENGE_INVALID", "设备公网端口未返回本次一次性挑战。 ")));
    socket.once("error", () => finish(error("AGENT_PUBLIC_PORT_UNREACHABLE", "Cloud 控制面无法连接设备公网端口，请检查 NAT 和防火墙。 ")));
  });
}

export async function verifyControlPlaneReachability(device: HostingDevice, command: HostingAgentCommand, {
  resolveAddresses = publicAddresses,
  readResponse = readChallenge,
} = {}) {
  const challenge = typeof command.payload.reachabilityChallenge === "string" ? command.payload.reachabilityChallenge : "";
  if (!/^[a-f0-9]{32}$/u.test(challenge)) throw error("AGENT_REACHABILITY_CHALLENGE_INVALID", "验真任务缺少有效的一次性公网挑战。 ");
  const port = device.inventory.sshPortStart;
  const expected = `KAI-HOST-VERIFY/1 ${challenge}\n`;
  const addresses = await resolveAddresses(device.inventory.publicHost);
  let lastError: unknown;
  for (const record of addresses) {
    try {
      await readResponse(record.address, record.family, port, expected);
      return hostingAgentDigest({ protocolVersion: 1, deviceId: device.id, commandId: command.id, publicHost: device.inventory.publicHost, publicPort: port, challenge });
    } catch (caught) { lastError = caught; }
  }
  throw lastError ?? error("AGENT_PUBLIC_PORT_UNREACHABLE", "Cloud 控制面无法连接设备公网端口。 ");
}
