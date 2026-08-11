import { AccountAuthError } from "@/lib/server/account-auth";
import { apiErrorResponse, beginApiRequest, jsonResponse, readJsonBody } from "@/lib/server/api-guard";
import { agentString, hostingAgentHttpError, parseAgentProof, requireHostingAgentTransport, verifyExistingDeviceProof } from "@/lib/server/hosting-agent-api";
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
    const requestNonce = agentString(body, "requestNonce", 16, 128);
    if (!/^[A-Za-z0-9_-]+$/u.test(requestNonce)) throw new AccountAuthError("AGENT_FIELD_INVALID", 400, "requestNonce 格式无效。 ");
    await verifyExistingDeviceProof(device, "POLL_COMMAND", { requestNonce }, proof);
    return jsonResponse({ command: await store.pollCommand(deviceId, new Date().toISOString()) }, 200, undefined, context);
  } catch (error) {
    return apiErrorResponse(hostingAgentHttpError(error), undefined, context);
  }
}
