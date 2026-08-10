import { AccountAuthError } from "@/lib/server/account-auth";
import { clearKaiIdentityTransactionCookie, completeKaiIdentityLogin } from "@/lib/server/kai-identity-oidc";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const completed = await completeKaiIdentityLogin(request);
    const headers = new Headers({ "cache-control": "no-store", location: completed.returnTo });
    headers.append("set-cookie", completed.issued.cookie);
    headers.append("set-cookie", completed.clearTransactionCookie);
    return new Response(null, { status: 303, headers });
  } catch (error) {
    const code = error instanceof AccountAuthError ? error.code : "KAI_IDENTITY_LOGIN_FAILED";
    const headers = new Headers({
      "cache-control": "no-store",
      location: `/login?authError=${encodeURIComponent(code)}`,
    });
    headers.append("set-cookie", clearKaiIdentityTransactionCookie(request));
    return new Response(null, { status: 303, headers });
  }
}
