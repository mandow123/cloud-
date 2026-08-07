import { beginApiRequest, jsonResponse } from "@/lib/server/api-guard";

export const dynamic = "force-dynamic";

/** The former operations-token refund path is retired; only an approved admin refund case can execute. */
export async function POST(request: Request) {
  const context = beginApiRequest(request);
  return jsonResponse({ error: {
    code: "REFUND_APPROVAL_REQUIRED",
    message: "Refunds require a finance request and independent administrator approval.",
    requestId: context.requestId,
  } }, 410, { "cache-control": "no-store" }, context);
}
