import { AccountAuthError, accountAuthErrorResponse, accountAuthJson, assertAccountAuthSameOrigin } from "@/lib/server/account-auth";
import { createAdminPasswordSession } from "@/lib/server/admin-auth-password";
import { accountSessionEnvelope, readAuthJson } from "@/lib/server/account-auth-http";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    assertAccountAuthSameOrigin(request);
    const body = await readAuthJson(request);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new AccountAuthError("AUTH_JSON_INVALID", 400, "请求正文不是有效的认证数据。 ");
    }
    const input = body as Record<string, unknown>;
    const issued = await createAdminPasswordSession(request, { username: input.username, password: input.password });
    const headers = new Headers();
    headers.append("set-cookie", issued.cookie);
    return accountAuthJson(await accountSessionEnvelope(issued.context), 200, headers);
  } catch (error) {
    return accountAuthErrorResponse(error);
  }
}
