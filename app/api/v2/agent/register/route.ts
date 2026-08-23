import { AccountAuthError } from "@/lib/server/account-auth";
import { apiErrorResponse, beginApiRequest, jsonResponse, readJsonBody, requireIdempotencyKey } from "@/lib/server/api-guard";
import {
  agentDigest,
  agentString,
  agentVersionAtLeast,
  hostingAgentHttpError,
  parseAgentProof,
  parseHostingDeviceInventory,
  requireHostingAgentTransport,
} from "@/lib/server/hosting-agent-api";
import { hostingAgentDigest, hostingAgentKeyId, verifyHostingAgentSignature } from "@/lib/server/hosting-agent-crypto";
import { bindKaiPublicDevice } from "@/lib/server/public-api-agent-bridge";
import { hostingObject, requireHostingV2SetupEnabled } from "@/lib/server/hosting-v2-api";
import { getHostingV2Store } from "@/lib/server/hosting-v2-store";
import { isAgentTelemetryV1Enabled } from "@/lib/server/agent-telemetry-feature";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const context = beginApiRequest(request);
  try {
    requireHostingAgentTransport(request);
    const body = hostingObject(await readJsonBody(request));
    const allowedFields = ["agentVersion", "challengeId", "devicePublicKey", "displayName", "expiresAt", "inventory", "inventoryDigest", "issuedAt", "nonce", "operation", "signature"];
    if (Object.keys(body).sort().join(",") !== allowedFields.join(",")) throw new AccountAuthError("AGENT_FIELD_INVALID", 400, "设备登记字段不完整或包含未支持字段。 ");
    if (body.operation !== "REGISTER_DEVICE") throw new AccountAuthError("AGENT_FIELD_INVALID", 400, "设备登记 operation 无效。 ");
    const challengeId = agentString(body, "challengeId", 20, 100);
    const challenge = await (await getHostingV2Store()).getAgentChallenge(challengeId);
    if (!challenge) throw new AccountAuthError("AGENT_CHALLENGE_INVALID", 409, "设备登记挑战不存在或已失效。 ");
    if (body.nonce !== challenge.nonce) throw new AccountAuthError("AGENT_CHALLENGE_INVALID", 409, "设备登记 nonce 与服务端挑战不匹配。 ");
    if (challenge.capabilityMode === "TELEMETRY_ONLY") {
      if (!isAgentTelemetryV1Enabled()) throw new AccountAuthError("HOSTING_TELEMETRY_DISABLED", 404, "设备遥测接入尚未开放。 ");
    } else requireHostingV2SetupEnabled();
    const proof = parseAgentProof(body);
    const displayName = agentString(body, "displayName", 2, 80);
    const devicePublicKey = agentString(body, "devicePublicKey", 43, 43);
    const agentVersion = agentString(body, "agentVersion", 5, 40);
    if (!agentVersionAtLeast(agentVersion, challenge.minimumAgentVersion)) throw new AccountAuthError("AGENT_VERSION_UNSUPPORTED", 409, `Host Agent 版本不得低于 ${challenge.minimumAgentVersion}。 `);
    const inventory = parseHostingDeviceInventory(body.inventory);
    const inventoryDigest = agentDigest(body, "inventoryDigest");
    if (await hostingAgentDigest(inventory) !== inventoryDigest) throw new AccountAuthError("AGENT_INVENTORY_DIGEST_MISMATCH", 400, "硬件清单摘要与提交内容不一致。 ");
    const signedPayload = { operation: "REGISTER_DEVICE", challengeId, nonce: challenge.nonce, displayName, devicePublicKey, agentVersion, inventory, inventoryDigest, issuedAt: proof.issuedAt, expiresAt: proof.expiresAt };
    await verifyHostingAgentSignature(devicePublicKey, signedPayload, proof.signature);
    const deviceKeyId = await hostingAgentKeyId(devicePublicKey);
    const now = new Date().toISOString();
    const record = await (await getHostingV2Store()).registerDevice(challengeId, { displayName, deviceKeyId, devicePublicKey, agentVersion, inventory, inventoryDigest }, {
      actorId: `agent:${deviceKeyId}`,
      idempotencyKey: requireIdempotencyKey(request),
      payloadHash: await hostingAgentDigest(signedPayload),
      now,
    });
    await bindKaiPublicDevice(challengeId, record, now);
    return jsonResponse({ record }, 201, undefined, context);
  } catch (error) {
    return apiErrorResponse(hostingAgentHttpError(error), undefined, context);
  }
}
