type D1Result<T = unknown> = { results?: T[]; meta?: { changes?: number } };
export type D1Statement = { bind(...values: unknown[]): D1Statement; run<T = unknown>(): Promise<D1Result<T>>; all<T = unknown>(): Promise<D1Result<T>>; first<T = unknown>(): Promise<T | null> };
export type ActivityD1 = { prepare(sql: string): D1Statement; batch<T = unknown>(statements: D1Statement[]): Promise<D1Result<T>[]> };
export type ActivityR2Object = { body: ReadableStream; httpEtag: string; size: number; httpMetadata?: { contentType?: string } };
export type ActivityR2 = { put(key: string, value: ReadableStream | ArrayBuffer | Blob, options?: { httpMetadata?: { contentType?: string }; customMetadata?: Record<string, string> }): Promise<unknown>; get(key: string): Promise<ActivityR2Object | null>; delete(key: string): Promise<void> };

export async function activityEnvironment(): Promise<{ DB: ActivityD1; UPLOADS: ActivityR2 }> {
  try {
    const cloudflare = await import("cloudflare:workers");
    const env = cloudflare.env as unknown as { DB?: ActivityD1; UPLOADS?: ActivityR2 };
    if (env.DB && env.UPLOADS) return { DB: env.DB, UPLOADS: env.UPLOADS };
  } catch { /* direct Node deployments do not expose Cloudflare bindings */ }
  throw new Error("ACTIVITY_BINDINGS_UNAVAILABLE");
}
