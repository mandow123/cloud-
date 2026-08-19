import { activityEnvironment } from "@/lib/server/activity-env";
import { activityErrorResponse, resolveActivityIdentity } from "@/lib/server/activity-identity";
import { readActivityAssetRecord } from "@/lib/server/activity-store";
import { authenticateAdminRequest } from "@/lib/server/admin-auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const [{ id }, viewer, env, admin] = await Promise.all([params, resolveActivityIdentity(request), activityEnvironment(), authenticateAdminRequest(request).catch(() => null)]);
    const record = await readActivityAssetRecord(env.DB, id, viewer?.id, Boolean(admin));
    if (!record) return new Response("Not found", { status: 404 });
    const object = await env.UPLOADS.get(record.key);
    if (!object) return new Response("Not found", { status: 404 });
    return new Response(object.body, { headers: { "content-type": record.contentType, "cache-control": "public, max-age=3600, stale-while-revalidate=86400", etag: object.httpEtag, "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; sandbox" } });
  } catch (error) { return activityErrorResponse(error); }
}
