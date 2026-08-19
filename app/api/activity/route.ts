import { activityEnvironment } from "@/lib/server/activity-env";
import { activityErrorResponse, resolveActivityIdentity } from "@/lib/server/activity-identity";
import { readActivitySnapshot } from "@/lib/server/activity-store";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const [{ DB }, viewer] = await Promise.all([activityEnvironment(), resolveActivityIdentity(request)]);
    return Response.json(await readActivitySnapshot(DB, viewer), { headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } });
  } catch (error) { return activityErrorResponse(error); }
}
