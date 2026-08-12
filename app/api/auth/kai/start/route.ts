import { AccountAuthError } from "@/lib/server/account-auth";
import { beginKaiIdentityLogin, clearKaiIdentityTransactionCookie } from "@/lib/server/kai-identity-oidc";

export const dynamic = "force-dynamic";

function safeReturnTo(request: Request) {
  const value = new URL(request.url).searchParams.get("returnTo");
  return value?.startsWith("/") && !value.startsWith("//") && !value.includes("\\") ? value : "/member";
}

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
    const code = error instanceof AccountAuthError ? error.code : "KAI_IDENTITY_LOGIN_FAILED";
    const location = `/login?${new URLSearchParams({ returnTo: safeReturnTo(request), authError: code })}`;
    return new Response(null, {
      status: 303,
      headers: {
        "cache-control": "no-store",
        location,
        "set-cookie": clearKaiIdentityTransactionCookie(request),
      },
    });
  }
}
