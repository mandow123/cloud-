import { AccountAuthError } from "@/lib/server/account-auth";
import { apiErrorResponse, beginApiRequest, jsonResponse, readJsonBody, requireIdempotencyKey } from "@/lib/server/api-guard";
import { agentDigest, agentString, agentVersionAtLeast, parseAgentProof, parseHostingDeviceInventory } from "@/lib/server/hosting-agent-api";
import { hostingAgentDigest, hostingAgentKeyId, verifyHostingAgentSignature } from "@/lib/server/hosting-agent-crypto";
import { requireHostingV2SetupEnabled } from "@/lib/server/hosting-v2-feature";
import { getHostingV2Store } from "@/lib/server/hosting-v2-store";
import { kaiPublicApiClients } from "@/lib/server/public-api-auth";
import { requireKaiPublicApiEnabled, requireKaiPublicApiHttps } from "@/lib/server/public-api-feature";
import { enforceKaiPublicApiRateLimit } from "@/lib/server/public-api-rate-limit";
import { getKaiPublicApiStore } from "@/lib/server/public-api-store";
import { kaiPublicDeviceView, kaiPublicObject } from "@/lib/server/public-api-service";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const context = beginApiRequest(request);
  try {
    requireKaiPublicApiEnabled();
    requireKaiPublicApiHttps(request);
    requireHostingV2SetupEnabled();
    const body = kaiPublicObject(await readJsonBody(request));
    const challengeId = agentString(body, "challengeId", 20, 100);
    enforceKaiPublicApiRateLimit(`challenge:${challengeId}`, Date.now(), 20);
    const publicStore = await getKaiPublicApiStore();
    let owner = null;
    let binding = null;
    for (const client of kaiPublicApiClients()) {
      const candidate = await publicStore.getChallengeBinding(client.clientId, challengeId);
      if (candidate) { owner = client; binding = candidate; break; }
    }
    if (!owner || !binding) throw new AccountAuthError("AGENT_CHALLENGE_INVALID", 409, "设备登记挑战不存在或已失效。 ");
    const hostingStore = await getHostingV2Store();
    const challenge = await hostingStore.getAgentChallenge(challengeId);
    if (!challenge || challenge.organizationId !== owner.organizationId) throw new AccountAuthError("AGENT_CHALLENGE_INVALID", 409, "设备登记挑战不存在或已失效。 ");
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
    const record = await hostingStore.registerDevice(challengeId, { displayName, deviceKeyId, devicePublicKey, agentVersion, inventory, inventoryDigest }, {
      actorId: `agent:${deviceKeyId}`, idempotencyKey: requireIdempotencyKey(request), payloadHash: await hostingAgentDigest(signedPayload), now,
    });
    await publicStore.bindDevice(owner.clientId, challengeId, record.id, now);
    return jsonResponse({ record: { ...kaiPublicDeviceView(record), inventoryDigest: record.inventoryDigest, lastSequence: record.lastSequence } }, 201, undefined, context);
  } catch (error) {
    return apiErrorResponse(error, undefined, context);
  }
}
