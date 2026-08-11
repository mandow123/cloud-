import { AccountAuthError } from "@/lib/server/account-auth";
import { apiErrorResponse, beginApiRequest, jsonResponse, readJsonBody } from "@/lib/server/api-guard";
import { agentDigest, agentString, hostingAgentHttpError, parseAgentProof, requireHostingAgentTransport, verifyExistingDeviceProof } from "@/lib/server/hosting-agent-api";
import { hostingAgentDigest } from "@/lib/server/hosting-agent-crypto";
import { hostingObject, requireHostingV2Enabled } from "@/lib/server/hosting-v2-api";
import { getHostingV2Store } from "@/lib/server/hosting-v2-store";

export const dynamic = "force-dynamic";

export async function POST(request: Request, contextValue: { params: Promise<{ deviceId: string; commandId: string }> }) {
  const context = beginApiRequest(request);
  try {
    requireHostingV2Enabled();
    requireHostingAgentTransport(request);
    const body = hostingObject(await readJsonBody(request));
    const { deviceId, commandId } = await contextValue.params;
    const store = await getHostingV2Store();
    const device = await store.getDevice(deviceId);
    if (!device) throw new AccountAuthError("AGENT_DEVICE_INVALID", 403, "设备凭据无效。 ");
    const proof = parseAgentProof(body);
    const outcome = agentString(body, "outcome", 6, 9);
    if (outcome !== "SUCCEEDED" && outcome !== "FAILED") throw new AccountAuthError("AGENT_FIELD_INVALID", 400, "outcome 无效。 ");
    const evidenceDigest = agentDigest(body, "evidenceDigest");
    const errorCode = body.errorCode == null || body.errorCode === "" ? null : agentString(body, "errorCode", 3, 80);
    if (errorCode && !/^[A-Z0-9_:-]+$/u.test(errorCode)) throw new AccountAuthError("AGENT_FIELD_INVALID", 400, "errorCode 格式无效。 ");
    if (outcome === "FAILED" && !errorCode) throw new AccountAuthError("AGENT_FIELD_INVALID", 400, "失败结果必须包含 errorCode。 ");
    if (outcome === "SUCCEEDED" && errorCode) throw new AccountAuthError("AGENT_FIELD_INVALID", 400, "成功结果不能包含 errorCode。 ");
    const details = body.details == null ? {} : hostingObject(body.details);
    if (await hostingAgentDigest(details) !== evidenceDigest) throw new AccountAuthError("AGENT_EVIDENCE_DIGEST_MISMATCH", 400, "任务证据摘要与结果内容不一致。 ");
    const fields = { commandId, outcome, evidenceDigest, errorCode, details };
    await verifyExistingDeviceProof(device, "COMPLETE_COMMAND", fields, proof);
    const result = await store.completeCommand(deviceId, commandId, { outcome, evidenceDigest, errorCode, details }, {
      actorId: `agent:${deviceId}`,
      idempotencyKey: `command:${commandId}:${outcome}`,
      payloadHash: await hostingAgentDigest({ operation: "COMPLETE_COMMAND", deviceId, ...fields, issuedAt: proof.issuedAt, expiresAt: proof.expiresAt }),
      now: new Date().toISOString(),
    });
    return jsonResponse(result, 200, undefined, context);
  } catch (error) {
    return apiErrorResponse(hostingAgentHttpError(error), undefined, context);
  }
}
