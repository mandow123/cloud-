import { parseHeartbeat } from "@/lib/server/supply-domain";
import { apiErrorResponse, beginApiRequest, jsonResponse, mutationHash, prepareWrite, readJsonBody, requireIdempotencyKey } from "@/lib/server/api-guard";
import { supplyWorkspaceRole } from "@/lib/server/supply-api"; import { getSupplyStore } from "@/lib/server/supply-store";
import { authorizeMarketplaceRequest, persistMarketplaceSession } from "@/lib/server/marketplace-auth"; import type { MarketplaceActor } from "@/lib/server/marketplace-actor";
export const dynamic = "force-dynamic";
export async function POST(request: Request, contextValue: { params: Promise<{ id: string }> }) { const context = beginApiRequest(request); let actor: MarketplaceActor | undefined; try {
  await supplyWorkspaceRole(request, ["supplier"]); const authorization = await authorizeMarketplaceRequest(request); actor = authorization.actor; prepareWrite(request, actor); await persistMarketplaceSession(authorization); const { id } = await contextValue.params; const input = parseHeartbeat(await readJsonBody(request));
  const result = await (await getSupplyStore()).heartbeat(id, { actorId: actor.id, idempotencyKey: requireIdempotencyKey(request), payloadHash: await mutationHash({ enrollmentId: id, ...input }) }, input); const headers = new Headers(actor.responseHeaders); headers.set("idempotency-replayed", String(result.replayed)); return jsonResponse(result, result.replayed ? 200 : 201, headers, context);
} catch (error) { return apiErrorResponse(error, actor?.responseHeaders, context); } }
