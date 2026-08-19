type D1Result<T = unknown> = { results?: T[]; meta?: { changes?: number } };
export type D1Statement = { bind(...values: unknown[]): D1Statement; run<T = unknown>(): Promise<D1Result<T>>; all<T = unknown>(): Promise<D1Result<T>>; first<T = unknown>(): Promise<T | null> };
export type ActivityD1 = { prepare(sql: string): D1Statement; batch<T = unknown>(statements: D1Statement[]): Promise<D1Result<T>[]> };
export type ActivityR2Object = { body: ReadableStream; httpEtag: string; size: number; httpMetadata?: { contentType?: string } };
export type ActivityR2 = { put(key: string, value: ReadableStream | ArrayBuffer | Blob, options?: { httpMetadata?: { contentType?: string }; customMetadata?: Record<string, string> }): Promise<unknown>; get(key: string): Promise<ActivityR2Object | null>; delete(key: string): Promise<void> };

declare global {
  var __KAI_ACTIVITY_ENV__: { DB: ActivityD1; UPLOADS: ActivityR2 } | undefined;
}

export type ActivitySecurityEnv = {
  KAI_TRUST_OPENAI_IDENTITY_HEADERS?: string;
  KAI_ACTIVITY_ADMIN_EMAILS?: string;
};

async function cloudflareEnvironment(): Promise<Record<string, unknown>> {
  try {
    const cloudflare = await import("cloudflare:workers");
    return cloudflare.env as unknown as Record<string, unknown>;
  } catch {
    return typeof process === "undefined" ? {} : process.env;
  }
}

export async function activitySecurityEnvironment(override?: ActivitySecurityEnv): Promise<ActivitySecurityEnv> {
  if (override) return override;
  const env = await cloudflareEnvironment();
  return {
    KAI_TRUST_OPENAI_IDENTITY_HEADERS: typeof env.KAI_TRUST_OPENAI_IDENTITY_HEADERS === "string" ? env.KAI_TRUST_OPENAI_IDENTITY_HEADERS : undefined,
    KAI_ACTIVITY_ADMIN_EMAILS: typeof env.KAI_ACTIVITY_ADMIN_EMAILS === "string" ? env.KAI_ACTIVITY_ADMIN_EMAILS : undefined,
  };
}

export async function activityEnvironment(): Promise<{ DB: ActivityD1; UPLOADS: ActivityR2 }> {
  if (globalThis.__KAI_ACTIVITY_ENV__) return globalThis.__KAI_ACTIVITY_ENV__;
  const env = await cloudflareEnvironment() as { DB?: ActivityD1; UPLOADS?: ActivityR2 };
  if (env.DB && env.UPLOADS) return { DB: env.DB, UPLOADS: env.UPLOADS };
  throw new Error("ACTIVITY_BINDINGS_UNAVAILABLE");
}
