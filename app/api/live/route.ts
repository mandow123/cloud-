import { beginApiRequest, jsonResponse } from "@/lib/server/api-guard";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const context = beginApiRequest(request);
  return jsonResponse({
    status: "ok",
    check: "live",
    service: "kai-cloud-marketplace",
    release: typeof process !== "undefined" ? (process.env.KAI_RELEASE_SHA ?? "development") : "worker",
  }, 200, undefined, context);
}
