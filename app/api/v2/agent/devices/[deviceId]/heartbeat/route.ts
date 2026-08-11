import { AccountAuthError } from "@/lib/server/account-auth";
import { apiErrorResponse, beginApiRequest, jsonResponse, readJsonBody } from "@/lib/server/api-guard";
import { agentDigest, agentInteger, agentString, hostingAgentHttpError, parseAgentProof, requireHostingAgentTransport, verifyExistingDeviceProof } from "@/lib/server/hosting-agent-api";
import { hostingAgentDigest, hostingAgentTimestamp } from "@/lib/server/hosting-agent-crypto";
import { hostingObject, requireHostingV2Enabled } from "@/lib/server/hosting-v2-api";
import { getHostingV2Store } from "@/lib/server/hosting-v2-store";

export const dynamic = "force-dynamic";

export async function POST(request: Request, contextValue: { params: Promise<{ deviceId: string }> }) {
  const context = beginApiRequest(request);
  try {
    requireHostingV2Enabled();
    requireHostingAgentTransport(request);
    const body = hostingObject(await readJsonBody(request));
    const { deviceId } = await contextValue.params;
    const store = await getHostingV2Store();
    const device = await store.getDevice(deviceId);
    if (!device) throw new AccountAuthError("AGENT_DEVICE_INVALID", 403, "设备凭据无效。 ");
    const proof = parseAgentProof(body);
    const sequence = agentInteger(body, "sequence", 1, Number.MAX_SAFE_INTEGER);
    const inventoryDigest = agentDigest(body, "inventoryDigest");
    const capacityState = agentString(body, "capacityState", 4, 8);
    if (capacityState !== "ONLINE" && capacityState !== "BUSY" && capacityState !== "DRAINING" && capacityState !== "OFFLINE") throw new AccountAuthError("AGENT_FIELD_INVALID", 400, "capacityState 无效。 ");
    const observedAt = hostingAgentTimestamp(body.observedAt, "observedAt");
    if (Math.abs(Date.parse(observedAt) - Date.now()) > 5 * 60_000) throw new AccountAuthError("AGENT_PROOF_EXPIRED", 409, "心跳观测时间与服务端时间偏差过大。 ");
    const fields = { sequence, inventoryDigest, capacityState, observedAt };
    await verifyExistingDeviceProof(device, "HEARTBEAT", fields, proof);
    const record = await store.acceptHeartbeat(deviceId, { sequence, inventoryDigest, capacityState, observedAt }, {
      actorId: `agent:${deviceId}`,
      idempotencyKey: `heartbeat:${sequence}`,
      payloadHash: await hostingAgentDigest({ operation: "HEARTBEAT", deviceId, ...fields, issuedAt: proof.issuedAt, expiresAt: proof.expiresAt }),
      now: new Date().toISOString(),
    });
    return jsonResponse({ record }, 200, undefined, context);
  } catch (error) {
    return apiErrorResponse(hostingAgentHttpError(error), undefined, context);
  }
}
