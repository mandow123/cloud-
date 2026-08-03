import { parseCreateDraft } from "@/lib/marketplace";
import { apiErrorResponse, jsonResponse, prepareWrite, readJsonBody } from "@/lib/server/api-guard";
import { getMarketplaceStore } from "@/lib/server/marketplace-store";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const store = await getMarketplaceStore();
    const items = await store.listDrafts();
    return jsonResponse({ items, count: items.length, updatedAt: new Date().toISOString() });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    prepareWrite(request);
    const input = parseCreateDraft(await readJsonBody(request));
    const store = await getMarketplaceStore();
    const record = await store.createDraft(input);
    return jsonResponse({ record }, 201);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
