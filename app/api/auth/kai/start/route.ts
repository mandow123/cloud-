import { accountAuthErrorResponse } from "@/lib/server/account-auth";
import { beginKaiIdentityLogin } from "@/lib/server/kai-identity-oidc";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const started = await beginKaiIdentityLogin(request);
    return new Response(null, {
      status: 302,
      headers: {
        "cache-control": "no-store",
        location: started.location,
        "set-cookie": started.transactionCookie,
      },
    });
  } catch (error) {
    return accountAuthErrorResponse(error);
  }
}
