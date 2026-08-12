import { AccountAuthError } from "@/lib/server/account-auth";
import { apiErrorResponse, beginApiRequest, jsonResponse, readJsonBody } from "@/lib/server/api-guard";
import { agentString, hostingAgentHttpError, parseAgentProof, requireHostingAgentTransport, verifyExistingDeviceProof } from "@/lib/server/hosting-agent-api";
import { hostingObject, requireHostingV2SetupEnabled } from "@/lib/server/hosting-v2-api";
import { isHostingV2Enabled } from "@/lib/server/hosting-v2-feature";
import { getHostingV2Store } from "@/lib/server/hosting-v2-store";
import { advanceExpiredHostingAcceptance } from "@/lib/server/hosting-contract-service";

export const dynamic = "force-dynamic";

export async function POST(request: Request, contextValue: { params: Promise<{ deviceId: string }> }) {
  const context = beginApiRequest(request);
  try {
    requireHostingV2SetupEnabled();
    requireHostingAgentTransport(request);
    const body = hostingObject(await readJsonBody(request));
    const { deviceId } = await contextValue.params;
    const store = await getHostingV2Store();
    const device = await store.getDevice(deviceId);
    if (!device) throw new AccountAuthError("AGENT_DEVICE_INVALID", 403, "设备凭据无效。 ");
    const proof = parseAgentProof(body);
    const requestNonce = agentString(body, "requestNonce", 16, 128);
    if (!/^[A-Za-z0-9_-]+$/u.test(requestNonce)) throw new AccountAuthError("AGENT_FIELD_INVALID", 400, "requestNonce 格式无效。 ");
    await verifyExistingDeviceProof(device, "POLL_COMMAND", { requestNonce }, proof);
    const now = new Date().toISOString();
    if (isHostingV2Enabled()) {
      try { await advanceExpiredHostingAcceptance(deviceId, now); }
      catch (error) {
        console.error(JSON.stringify({ level: "error", event: "hosting_auto_accept_failed", deviceId, errorCode: error instanceof Error && "code" in error ? String(error.code) : "UNKNOWN", occurredAt: now }));
      }
    }
    const allowedTypes = isHostingV2Enabled() ? undefined : ["VERIFY", "STOP", "CLEANUP"] as const;
    return jsonResponse({ command: await store.pollCommand(deviceId, now, allowedTypes) }, 200, undefined, context);
  } catch (error) {
    return apiErrorResponse(hostingAgentHttpError(error), undefined, context);
  }
}
