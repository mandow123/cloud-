import { AccountAuthError } from "@/lib/server/account-auth";
import { apiErrorResponse, beginApiRequest, jsonResponse, readJsonBody } from "@/lib/server/api-guard";
import { agentDigest, agentInteger, agentString, parseAgentProof, verifyExistingDeviceProof } from "@/lib/server/hosting-agent-api";
import { hostingAgentDigest, hostingAgentTimestamp } from "@/lib/server/hosting-agent-crypto";
import { requireHostingV2SetupEnabled } from "@/lib/server/hosting-v2-feature";
import { getHostingV2Store } from "@/lib/server/hosting-v2-store";
import { syncKaiPublicHeartbeat } from "@/lib/server/public-api-agent-bridge";
import { requireKaiPublicApiEnabled, requireKaiPublicApiHttps } from "@/lib/server/public-api-feature";
import { enforceKaiPublicApiRateLimit } from "@/lib/server/public-api-rate-limit";
import { kaiPublicDeviceView, kaiPublicId, kaiPublicObject } from "@/lib/server/public-api-service";

export const dynamic = "force-dynamic";

export async function POST(request: Request, contextValue: { params: Promise<{ deviceId: string }> }) {
  const context = beginApiRequest(request);
  try {
    requireKaiPublicApiEnabled();
    requireKaiPublicApiHttps(request);
    requireHostingV2SetupEnabled();
    const { deviceId: rawId } = await contextValue.params;
    const deviceId = kaiPublicId(rawId, "deviceId");
    enforceKaiPublicApiRateLimit(`device:${deviceId}`, Date.now(), 180);
    const body = kaiPublicObject(await readJsonBody(request));
    const hostingStore = await getHostingV2Store();
    const device = await hostingStore.getDevice(deviceId);
    if (!device || device.status === "REVOKED") throw new AccountAuthError("AGENT_DEVICE_INVALID", 403, "设备凭据无效。 ");
    const proof = parseAgentProof(body);
    const sequence = agentInteger(body, "sequence", 1, Number.MAX_SAFE_INTEGER);
    const inventoryDigest = agentDigest(body, "inventoryDigest");
    const capacityState = agentString(body, "capacityState", 4, 8);
    if (!["ONLINE", "BUSY", "DRAINING", "OFFLINE"].includes(capacityState)) throw new AccountAuthError("VALIDATION_ERROR", 400, "capacityState 无效。 ");
    const observedAt = hostingAgentTimestamp(body.observedAt, "observedAt");
    if (Math.abs(Date.parse(observedAt) - Date.now()) > 5 * 60_000) throw new AccountAuthError("AGENT_PROOF_EXPIRED", 409, "心跳观测时间与服务端时间偏差过大。 ");
    const fields = { sequence, inventoryDigest, capacityState: capacityState as "ONLINE" | "BUSY" | "DRAINING" | "OFFLINE", observedAt };
    await verifyExistingDeviceProof(device, "HEARTBEAT", fields, proof);
    const now = new Date().toISOString();
    const record = await hostingStore.acceptHeartbeat(deviceId, fields, { actorId: `agent:${deviceId}`, idempotencyKey: `heartbeat:${sequence}`, payloadHash: await hostingAgentDigest({ operation: "HEARTBEAT", deviceId, ...fields, issuedAt: proof.issuedAt, expiresAt: proof.expiresAt }), now });
    await syncKaiPublicHeartbeat(hostingStore, record, now);
    return jsonResponse({ record: { ...kaiPublicDeviceView(record), inventoryDigest: record.inventoryDigest, lastSequence: record.lastSequence } }, 202, undefined, context);
  } catch (error) {
    return apiErrorResponse(error, undefined, context);
  }
}
