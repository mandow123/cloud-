import { activityEnvironment, type ActivityR2 } from "@/lib/server/activity-env";
import { ActivityHttpError, activityErrorResponse, assertActivitySameOrigin, requireActivityIdentity } from "@/lib/server/activity-identity";
import { activityBytesHash, activityPayloadHash, createActivitySubmission } from "@/lib/server/activity-store";
import { ACTIVITY_UPLOAD_MAX_BYTES, ACTIVITY_UPLOAD_TYPES, inspectActivityImage } from "@/lib/server/activity-upload";

export const dynamic = "force-dynamic";
function bounded(form: FormData, name: string, maximum: number, minimum = 1) {
  const value = form.get(name);
  if (typeof value !== "string") throw new ActivityHttpError("ACTIVITY_FIELD_INVALID", 400, `${name} 字段无效。`);
  const normalized = value.trim();
  if (normalized.length < minimum || normalized.length > maximum) throw new ActivityHttpError("ACTIVITY_FIELD_INVALID", 400, `${name} 字段长度无效。`);
  return normalized;
}

export async function POST(request: Request) {
  let uploadedKey: string | null = null;
  let uploads: ActivityR2 | null = null;
  try {
    assertActivitySameOrigin(request);
    const [identity, env] = await Promise.all([requireActivityIdentity(request), activityEnvironment()]);
    uploads = env.UPLOADS;
    if (!request.headers.get("content-type")?.toLowerCase().startsWith("multipart/form-data;")) throw new ActivityHttpError("ACTIVITY_MULTIPART_REQUIRED", 400, "投稿请求必须使用表单上传。 ");
    const declaredLength = Number(request.headers.get("content-length"));
    if (!Number.isSafeInteger(declaredLength) || declaredLength < 1 || declaredLength > ACTIVITY_UPLOAD_MAX_BYTES + 64 * 1024) throw new ActivityHttpError("ACTIVITY_UPLOAD_TOO_LARGE", 413, "投稿请求大小无效或超过 10MB 限制。 ");
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File) || file.size < 1 || file.size > ACTIVITY_UPLOAD_MAX_BYTES || !ACTIVITY_UPLOAD_TYPES.has(file.type)) throw new ActivityHttpError("ACTIVITY_UPLOAD_INVALID", 400, "只支持 10MB 以内且文件内容有效的 JPG、PNG 或 WebP 图片。 ");
    const fileBuffer = await file.arrayBuffer();
    if (!inspectActivityImage(new Uint8Array(fileBuffer), file.type)) throw new ActivityHttpError("ACTIVITY_UPLOAD_INVALID", 400, "图片结构、尺寸或文件内容无效。 ");
    const campaignId = bounded(form, "campaignId", 80);
    if (!/^act_[a-z0-9_]{3,64}$/u.test(campaignId)) throw new ActivityHttpError("ACTIVITY_CAMPAIGN_INVALID", 400, "活动标识无效。 ");
    const title = bounded(form, "title", 80, 2);
    const description = bounded(form, "description", 500, 10);
    const promptExcerpt = bounded(form, "promptExcerpt", 500, 3);
    const idempotencyKey = request.headers.get("idempotency-key")?.trim() ?? "";
    if (!/^kai-[A-Za-z0-9._:-]{8,124}$/u.test(idempotencyKey)) throw new ActivityHttpError("ACTIVITY_IDEMPOTENCY_REQUIRED", 400, "投稿请求缺少有效的幂等键。 ");
    const fileHash = await activityBytesHash(fileBuffer);
    const payloadHash = await activityPayloadHash({ campaignId, title, description, promptExcerpt, contentType: file.type, size: file.size, fileHash });
    const extension = file.type === "image/jpeg" ? "jpg" : file.type.split("/")[1];
    uploadedKey = `activity/${campaignId}/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}.${extension}`;
    await env.UPLOADS.put(uploadedKey, fileBuffer, { httpMetadata: { contentType: file.type }, customMetadata: { owner: identity.id, campaignId } });
    try {
      const result = await createActivitySubmission(env.DB, { campaignId, author: identity, title, description, promptExcerpt, assetKey: uploadedKey, contentType: file.type, size: file.size, idempotencyKey, payloadHash });
      if (result.replayed) { await env.UPLOADS.delete(uploadedKey); uploadedKey = null; }
      return Response.json({ submissionId: result.submissionId, status: "PENDING" }, { status: result.replayed ? 200 : 201, headers: { "cache-control": "no-store", "idempotency-replayed": String(result.replayed) } });
    } catch (error) {
      if (uploadedKey) await env.UPLOADS.delete(uploadedKey).catch(() => undefined);
      uploadedKey = null;
      throw error;
    }
  } catch (error) {
    if (uploadedKey && uploads) await uploads.delete(uploadedKey).catch(() => undefined);
    return activityErrorResponse(error);
  }
}
