import { activityEnvironment } from "@/lib/server/activity-env";
import { ActivityHttpError, activityErrorResponse, assertActivitySameOrigin, requireActivityIdentity } from "@/lib/server/activity-identity";
import { createActivitySubmission } from "@/lib/server/activity-store";

export const dynamic = "force-dynamic";
const allowedTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/avif"]);

async function hasValidSignature(file: File) {
  const bytes = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  if (file.type === "image/png") return [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((value, index) => bytes[index] === value);
  if (file.type === "image/jpeg") return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (file.type === "image/webp") return String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
  if (file.type === "image/avif") return String.fromCharCode(...bytes.slice(4, 8)) === "ftyp" && ["avif", "avis", "mif1"].includes(String.fromCharCode(...bytes.slice(8, 12)));
  return false;
}

function bounded(form: FormData, name: string, maximum: number, minimum = 1) {
  const value = form.get(name);
  if (typeof value !== "string") throw new ActivityHttpError("ACTIVITY_FIELD_INVALID", 400, `${name} 字段无效。`);
  const normalized = value.trim();
  if (normalized.length < minimum || normalized.length > maximum) throw new ActivityHttpError("ACTIVITY_FIELD_INVALID", 400, `${name} 字段长度无效。`);
  return normalized;
}

export async function POST(request: Request) {
  let uploadedKey: string | null = null;
  try {
    assertActivitySameOrigin(request);
    const [identity, env] = await Promise.all([requireActivityIdentity(request), activityEnvironment()]);
    const declaredLength = Number(request.headers.get("content-length") ?? 0);
    if (Number.isFinite(declaredLength) && declaredLength > 11 * 1024 * 1024) throw new ActivityHttpError("ACTIVITY_UPLOAD_TOO_LARGE", 413, "作品文件不能超过 10MB。 ");
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File) || file.size < 1 || file.size > 10 * 1024 * 1024 || !allowedTypes.has(file.type) || !await hasValidSignature(file)) throw new ActivityHttpError("ACTIVITY_UPLOAD_INVALID", 400, "只支持 10MB 以内且文件内容有效的 JPG、PNG、WebP 或 AVIF 图片。 ");
    const campaignId = bounded(form, "campaignId", 80);
    const title = bounded(form, "title", 80, 2);
    const description = bounded(form, "description", 500, 10);
    const promptExcerpt = bounded(form, "promptExcerpt", 500, 3);
    const extension = file.type === "image/jpeg" ? "jpg" : file.type.split("/")[1];
    uploadedKey = `activity/${campaignId}/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}.${extension}`;
    await env.UPLOADS.put(uploadedKey, file.stream(), { httpMetadata: { contentType: file.type }, customMetadata: { owner: identity.id, campaignId } });
    try {
      const submissionId = await createActivitySubmission(env.DB, { campaignId, author: identity, title, description, promptExcerpt, assetKey: uploadedKey, contentType: file.type, size: file.size });
      return Response.json({ submissionId, status: "PENDING" }, { status: 201, headers: { "cache-control": "no-store" } });
    } catch (error) {
      await env.UPLOADS.delete(uploadedKey);
      uploadedKey = null;
      throw error;
    }
  } catch (error) { return activityErrorResponse(error); }
}
