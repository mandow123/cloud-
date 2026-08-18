import { join } from "node:path";
import { tmpdir } from "node:os";
import { GpuLabEngine, type GpuLabCheckoutInput, type GpuLabPublishInput } from "@/lib/server/gpu-lab-engine";
import { assertAccountAuthSameOrigin } from "@/lib/server/account-auth";
import { requireAdminPermission } from "@/lib/server/admin-auth";
import { requireLegacyGpuMutationSimulation } from "@/lib/server/legacy-gpu-mutation-gate";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

declare global {
  var __kaiGpuLabEngine: GpuLabEngine | undefined;
}

function enabled() {
  return process.env.KAI_GPU_LAB_ENABLED === "1"
    && process.env.KAI_ENVIRONMENT === "LOCAL";
}

function json(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      "cache-control": "no-store",
      "x-kai-environment": "LOCAL_TEST",
    },
  });
}

function lab() {
  if (!enabled()) throw new Error("GPU_LAB_DISABLED");
  const databasePath = process.env.KAI_GPU_LAB_DB_PATH ?? join(tmpdir(), "kai-cloud-gpu-lab-v1.sqlite");
  globalThis.__kaiGpuLabEngine ??= new GpuLabEngine(databasePath);
  return globalThis.__kaiGpuLabEngine;
}

function errorResponse(error: unknown) {
  if (error instanceof Error && error.message === "GPU_LAB_DISABLED") {
    return json({ error: { code: "GPU_LAB_DISABLED", message: "本地闭环预览未启用。" } }, 404);
  }
  const candidate = error as { code?: string; status?: number; message?: string; field?: string };
  return json({
    error: {
      code: candidate.code ?? "GPU_LAB_FAILED",
      message: candidate.message ?? "本地闭环操作失败。",
      field: candidate.field,
    },
  }, Number.isInteger(candidate.status) ? candidate.status : 500);
}

export async function GET(request: Request) {
  try {
    if (!enabled()) throw new Error("GPU_LAB_DISABLED");
    await requireAdminPermission(request, ["ADMIN_PANEL_READ"]);
    return json({ snapshot: await lab().snapshot() });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    if (!enabled()) throw new Error("GPU_LAB_DISABLED");
    requireLegacyGpuMutationSimulation("LAB");
    assertAccountAuthSameOrigin(request);
    await requireAdminPermission(request, ["FULFILLMENT_OPERATE"]);
    const body = await request.json() as Record<string, unknown>;
    const action = body.action;
    if (action === "seed") return json({ snapshot: await lab().seedDemoInventory() }, 201);
    if (action === "publish") return json(await lab().publish(body.input as GpuLabPublishInput), 201);
    if (action === "checkout") return json(await lab().checkout(body.input as GpuLabCheckoutInput), 201);
    if (action === "start" && typeof body.orderId === "string") return json(await lab().start(body.orderId));
    if (action === "complete" && typeof body.orderId === "string") return json(await lab().complete(body.orderId));
    if (action === "accept" && typeof body.orderId === "string") return json(await lab().accept(body.orderId));
    if (action === "settle" && typeof body.orderId === "string") return json(await lab().settle(body.orderId));
    return json({ error: { code: "GPU_LAB_ACTION_INVALID", message: "不支持的本地闭环操作。" } }, 422);
  } catch (error) {
    return errorResponse(error);
  }
}
