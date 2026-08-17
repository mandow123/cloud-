import { AccountAuthError, assertAccountAuthSameOrigin } from "@/lib/server/account-auth";
import { apiErrorResponse, beginApiRequest, jsonResponse, readJsonBody } from "@/lib/server/api-guard";
import { requireTradingAccountSession } from "@/lib/server/entity-ownership";
import { hostingContractClientView, hostingMutationContext, hostingObject, requireHostingV2Enabled } from "@/lib/server/hosting-v2-api";
import { getHostingV2Store } from "@/lib/server/hosting-v2-store";
import { normalizeSshPublicKey } from "@/lib/server/ssh-public-key";
import { requireHostingV2TransactionCapability } from "@/lib/server/hosting-v2-transaction-gate";

export const dynamic = "force-dynamic";

export async function POST(request: Request, contextValue: { params: Promise<{ contractId: string }> }) {
  const context = beginApiRequest(request);
  try {
    requireHostingV2Enabled();
    await requireHostingV2TransactionCapability();
    assertAccountAuthSameOrigin(request);
    const account = await requireTradingAccountSession(request);
    if (!account) throw new AccountAuthError("ACCOUNT_AUTH_REQUIRED", 401, "请先登录账户。 ");
    const body = hostingObject(await readJsonBody(request));
    for (const field of ["actorId", "accountId", "organizationId", "fingerprint", "payloadHash", "status", "id"]) {
      if (field in body) throw new AccountAuthError("HOSTING_SERVER_FIELD_FORBIDDEN", 400, `${field} 只能由服务端生成。 `);
    }
    if (Object.keys(body).some((field) => field !== "publicKey")) throw new AccountAuthError("HOSTING_VALIDATION_ERROR", 400, "SSH 开通请求包含不支持的字段。 ");
    const { contractId } = await contextValue.params;
    const key = await normalizeSshPublicKey(body.publicKey);
    const mutation = await hostingMutationContext(request, account.account.id, { publicKey: key.publicKey, fingerprint: key.fingerprint });
    const result = await (await getHostingV2Store()).attachSshKey(account.activeOrganization.id, contractId, key, mutation);
    return jsonResponse({ record: hostingContractClientView(result.contract), provisioning: { commandId: result.command.id, status: result.command.status }, sshPublicKeyFingerprint: key.fingerprint }, 202, undefined, context);
  } catch (error) {
    return apiErrorResponse(error, undefined, context);
  }
}
