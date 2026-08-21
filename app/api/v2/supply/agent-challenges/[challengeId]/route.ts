import { AccountAuthError } from "@/lib/server/account-auth";
import { apiErrorResponse, beginApiRequest, jsonResponse } from "@/lib/server/api-guard";
import { requireTradingAccountSession } from "@/lib/server/entity-ownership";
import { requireHostingV2SetupEnabled } from "@/lib/server/hosting-v2-api";
import { getHostingV2Store } from "@/lib/server/hosting-v2-store";

export const dynamic = "force-dynamic";

export async function GET(request: Request, contextValue: { params: Promise<{ challengeId: string }> }) {
  const context = beginApiRequest(request);
  try {
    const account = await requireTradingAccountSession(request);
    if (!account) throw new AccountAuthError("ACCOUNT_AUTH_REQUIRED", 401, "请先登录账户。 ");
    const { challengeId } = await contextValue.params;
    if (!/^hac_[a-z0-9]{8,80}$/u.test(challengeId)) throw new AccountAuthError("HOSTING_VALIDATION_ERROR", 400, "设备登记挑战编号无效。 ");
    const record = await (await getHostingV2Store()).getAgentRegistration(account.activeOrganization.id, challengeId);
    if (!record) throw new AccountAuthError("HOSTING_AGENT_CHALLENGE_NOT_FOUND", 404, "设备登记挑战不存在或不属于当前组织。 ");
    if (record.challenge.capabilityMode !== "TELEMETRY_ONLY") requireHostingV2SetupEnabled();
    return jsonResponse({ record: {
      challengeId: record.challenge.id,
      applicationId: record.challenge.applicationId,
      capabilityMode: record.challenge.capabilityMode,
      expiresAt: record.challenge.expiresAt,
      consumedAt: record.challenge.consumedAt,
      revokedAt: record.challenge.revokedAt,
      device: record.device ? {
        id: record.device.id,
        applicationId: record.device.applicationId,
        capabilityMode: record.device.capabilityMode,
        displayName: record.device.displayName,
        agentVersion: record.device.agentVersion,
        gpuModel: record.device.inventory.gpuModel,
        status: record.device.status,
        verificationStatus: record.device.verificationStatus,
        lastSequence: record.device.lastSequence,
        lastSeenAt: record.device.lastSeenAt,
      } : null,
    } }, 200, undefined, context);
  } catch (error) {
    return apiErrorResponse(error, undefined, context);
  }
}
