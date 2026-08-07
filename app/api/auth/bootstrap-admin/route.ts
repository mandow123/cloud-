import { bootstrapFirstAdministrator } from "@/lib/server/account-auth-bootstrap";
import { accountAuthErrorResponse, accountAuthJson, assertAccountAuthSameOrigin } from "@/lib/server/account-auth";
import { accountSessionEnvelope, readAuthJson } from "@/lib/server/account-auth-http";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    assertAccountAuthSameOrigin(request);
    const body = await readAuthJson(request);
    const code = body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>).code : undefined;
    const issued = await bootstrapFirstAdministrator(request, code);
    const headers = new Headers();
    headers.append("set-cookie", issued.cookie);
    return accountAuthJson(await accountSessionEnvelope(issued.context), 200, headers);
  } catch (error) {
    return accountAuthErrorResponse(error);
  }
}
