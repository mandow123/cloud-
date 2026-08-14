import { AccountAuthError } from "@/lib/server/account-auth";
import { apiErrorResponse, beginApiRequest, jsonResponse } from "@/lib/server/api-guard";
import { getCardHourStore } from "@/lib/server/card-hour-store";
import { requireTradingAccountSession } from "@/lib/server/entity-ownership";
import { requireHostingV2Enabled } from "@/lib/server/hosting-v2-api";
import { getHostingV2Store } from "@/lib/server/hosting-v2-store";

export const dynamic = "force-dynamic";

function safeLedgerEntry(value: Record<string, unknown>) {
  const operation = typeof value.operation === "string" ? value.operation : "UNKNOWN";
  const businessKey = typeof value.business_key === "string" ? value.business_key : "—";
  const side = value.side === "DEBIT" ? "DEBIT" : "CREDIT";
  const amountMicros = Number.isSafeInteger(value.amount_micros) ? Number(value.amount_micros) : 0;
  const balanceAfterMicros = value.balance_after_micros === null || value.balance_after_micros === undefined
    ? null
    : Number.isSafeInteger(value.balance_after_micros) ? Number(value.balance_after_micros) : null;
  const createdAt = typeof value.created_at === "string" ? value.created_at : "";
  return { operation, businessKey, side, amountMicros, balanceAfterMicros, createdAt };
}

export async function GET(request: Request) {
  const context = beginApiRequest(request);
  try {
    requireHostingV2Enabled();
    const account = await requireTradingAccountSession(request);
    if (!account) throw new AccountAuthError("ACCOUNT_AUTH_REQUIRED", 401, "请先登录账户。 ");
    const updatedAt = new Date().toISOString();
    const [cardHours, hosting] = await Promise.all([getCardHourStore(), getHostingV2Store()]);
    const [dashboard, feePreview, monthlySettlement] = await Promise.all([
      cardHours.dashboard(account.activeOrganization.id, updatedAt),
      hosting.supplierFeePreview(account.activeOrganization.id, updatedAt),
      hosting.supplierMonthlySettlement(account.activeOrganization.id, updatedAt),
    ]);
    return jsonResponse({ earnings: {
      assetCode: dashboard.assetCode,
      rate: { cardHours: dashboard.rate.cardHours, cny: dashboard.rate.cny },
      balance: { availableMicros: dashboard.balance.availableMicros, heldMicros: dashboard.balance.heldMicros },
      income: dashboard.income,
      referral: dashboard.referral,
      ledger: dashboard.ledger.map(safeLedgerEntry),
      feePreview,
      monthlySettlement,
      updatedAt,
    } }, 200, undefined, context);
  } catch (error) {
    return apiErrorResponse(error, undefined, context);
  }
}
