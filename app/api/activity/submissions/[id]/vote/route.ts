import { activityEnvironment } from "@/lib/server/activity-env";
import { ActivityHttpError, activityErrorResponse, assertActivitySameOrigin, requireActivityIdentity } from "@/lib/server/activity-identity";
import { setActivityVote } from "@/lib/server/activity-store";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertActivitySameOrigin(request);
    const [{ id }, voter, { DB }] = await Promise.all([params, requireActivityIdentity(request), activityEnvironment()]);
    if (!/^sub_[0-9a-f-]{36}$/u.test(id)) throw new ActivityHttpError("ACTIVITY_SUBMISSION_INVALID", 400, "作品标识无效。 ");
    if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) throw new ActivityHttpError("ACTIVITY_JSON_REQUIRED", 400, "投票请求必须使用 JSON。 ");
    const length = Number(request.headers.get("content-length"));
    if (!Number.isSafeInteger(length) || length < 1 || length > 1024) throw new ActivityHttpError("ACTIVITY_VOTE_PAYLOAD_INVALID", 413, "投票请求正文大小无效。 ");
    const body = await request.json() as Record<string, unknown>;
    if (typeof body.voted !== "boolean") throw new ActivityHttpError("ACTIVITY_VOTE_INVALID", 400, "投票状态无效。 ");
    return Response.json(await setActivityVote(DB, id, voter, body.voted), { headers: { "cache-control": "no-store" } });
  } catch (error) { return activityErrorResponse(error); }
}
