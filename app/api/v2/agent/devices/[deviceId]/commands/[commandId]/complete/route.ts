import { AccountAuthError } from "@/lib/server/account-auth";
import { apiErrorResponse, beginApiRequest, jsonResponse, readJsonBody } from "@/lib/server/api-guard";
import { agentDigest, agentString, hostingAgentHttpError, parseAgentProof, requireHostingAgentTransport, verifyExistingDeviceProof } from "@/lib/server/hosting-agent-api";
import { hostingAgentDigest } from "@/lib/server/hosting-agent-crypto";
import { verifyControlPlaneReachability } from "@/lib/server/hosting-agent-reachability";
import { hostingObject, requireHostingV2SetupEnabled } from "@/lib/server/hosting-v2-api";
import { isHostingV2Enabled } from "@/lib/server/hosting-v2-feature";
import { getHostingV2Store } from "@/lib/server/hosting-v2-store";
import { reconcileFailedHostingDelivery } from "@/lib/server/hosting-delivery-failure-service";

export const dynamic = "force-dynamic";

export async function POST(request: Request, contextValue: { params: Promise<{ deviceId: string; commandId: string }> }) {
  const context = beginApiRequest(request);
  try {
    requireHostingV2SetupEnabled();
    requireHostingAgentTransport(request);
    const body = hostingObject(await readJsonBody(request));
    const { deviceId, commandId } = await contextValue.params;
    const store = await getHostingV2Store();
    const device = await store.getDevice(deviceId);
    if (!device) throw new AccountAuthError("AGENT_DEVICE_INVALID", 403, "设备凭据无效。 ");
    const command = await store.getCommand(deviceId, commandId);
    if (!command) throw new AccountAuthError("AGENT_COMMAND_INVALID", 404, "设备任务不存在。 ");
    if (!isHostingV2Enabled() && command.type !== "VERIFY" && command.type !== "STOP" && command.type !== "CLEANUP") {
      throw new AccountAuthError("HOSTING_V2_TRADING_DISABLED", 503, "预上线配置模式不能完成新的开通或启动任务。 ");
    }
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
    const commandAlreadyTerminal = command.status === "SUCCEEDED" || command.status === "FAILED";
    if (commandAlreadyTerminal && command.status === "FAILED" && outcome === "SUCCEEDED" && command.errorCode?.startsWith("AGENT_PUBLIC_")) {
      const result = await store.completeCommand(deviceId, commandId, { outcome: "FAILED", evidenceDigest: command.evidenceDigest!, errorCode: command.errorCode }, {
        actorId: `agent:${deviceId}`,
        idempotencyKey: `command:${commandId}:FAILED`,
        payloadHash: await hostingAgentDigest({ operation: "CONTROL_PLANE_VERIFICATION_REPLAY", deviceId, commandId, evidenceDigest: command.evidenceDigest, errorCode: command.errorCode }),
        now: new Date().toISOString(),
      });
      return jsonResponse(result, 200, undefined, context);
    }
    if (commandAlreadyTerminal) {
      const result = await store.completeCommand(deviceId, commandId, { outcome, evidenceDigest, errorCode, details }, {
        actorId: `agent:${deviceId}`,
        idempotencyKey: `command:${commandId}:${outcome}`,
        payloadHash: await hostingAgentDigest({ operation: "TERMINAL_COMMAND_REPLAY", deviceId, commandId, outcome, evidenceDigest, errorCode }),
        now: new Date().toISOString(),
      });
      const recoveredAt = new Date().toISOString();
      const recovery = await reconcileFailedHostingDelivery(result.command, recoveredAt);
      return jsonResponse(recovery ? { ...result, contract: recovery.cleanup.contract, recovery: { billingStatus: String(recovery.refund.record.status), cleanupCommandId: recovery.cleanup.command.id } } : result, 200, undefined, context);
    }
    let controlPlaneReachabilityDigest: string | undefined;
    if (command.type === "VERIFY" && outcome === "SUCCEEDED") {
      try {
        controlPlaneReachabilityDigest = await verifyControlPlaneReachability(device, command);
      } catch (reachabilityError) {
        const controlPlaneErrorCode = reachabilityError instanceof AccountAuthError && reachabilityError.code.startsWith("AGENT_PUBLIC_")
          ? reachabilityError.code
          : "AGENT_PUBLIC_PORT_UNREACHABLE";
        const controlPlaneDetails = { protocolVersion: 1, commandType: "VERIFY", controlPlaneReachability: "FAILED", errorCode: controlPlaneErrorCode, observedAt: new Date().toISOString() };
        const controlPlaneEvidenceDigest = await hostingAgentDigest(controlPlaneDetails);
        const result = await store.completeCommand(deviceId, commandId, { outcome: "FAILED", evidenceDigest: controlPlaneEvidenceDigest, errorCode: controlPlaneErrorCode, details: controlPlaneDetails }, {
          actorId: `agent:${deviceId}`,
          idempotencyKey: `command:${commandId}:FAILED`,
          payloadHash: await hostingAgentDigest({ operation: "CONTROL_PLANE_VERIFICATION_FAILED", deviceId, commandId, agentEvidenceDigest: evidenceDigest, controlPlaneEvidenceDigest, errorCode: controlPlaneErrorCode }),
          now: controlPlaneDetails.observedAt,
        });
        return jsonResponse(result, 200, undefined, context);
      }
    }
    const completedAt = new Date().toISOString();
    const result = await store.completeCommand(deviceId, commandId, { outcome, evidenceDigest, errorCode, details, controlPlaneReachabilityDigest }, {
      actorId: `agent:${deviceId}`,
      idempotencyKey: `command:${commandId}:${outcome}`,
      payloadHash: await hostingAgentDigest({ operation: "COMPLETE_COMMAND", deviceId, ...fields, issuedAt: proof.issuedAt, expiresAt: proof.expiresAt }),
      now: completedAt,
    });
    const recovery = await reconcileFailedHostingDelivery(result.command, completedAt);
    return jsonResponse(recovery ? { ...result, contract: recovery.cleanup.contract, recovery: { billingStatus: String(recovery.refund.record.status), cleanupCommandId: recovery.cleanup.command.id } } : result, 200, undefined, context);
  } catch (error) {
    return apiErrorResponse(hostingAgentHttpError(error), undefined, context);
  }
}
