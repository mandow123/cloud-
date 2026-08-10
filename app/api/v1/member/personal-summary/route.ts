import { accountAuthErrorResponse, accountAuthJson } from "@/lib/server/account-auth";
import { memberPersonalSummary } from "@/lib/server/member-personal-summary";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    return accountAuthJson(await memberPersonalSummary(request));
  } catch (error) {
    return accountAuthErrorResponse(error);
  }
}
