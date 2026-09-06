/** One process owns queries for all three entrances: callback, member and timer.
 * The candidate must run as a single application instance. Persistent order
 * leases protect retries; boot cooldown prevents a restart resetting the budget.
 */
export class QixiangQueryDeferredError extends Error {
  constructor(message: string) { super(message); this.name = "QixiangQueryDeferredError"; }
}
export function createQixiangQueryExecutor(options: { now?: () => number; bootAt?: number; timeoutMs?: number } = {}) {
  const now = options.now ?? Date.now;
  const bootAt = options.bootAt ?? now();
  const states = new Map<string, { starts: number[]; pending: number; tail: Promise<void> }>();
  return {
    async run<T>(credentialId: string, operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
      if (now() < bootAt + 60_000) throw new QixiangQueryDeferredError("支付核对重启冷却中，请稍后重试。");
      let state = states.get(credentialId);
      if (!state) { state = { starts: [], pending: 0, tail: Promise.resolve() }; states.set(credentialId, state); }
      // Bound queue wait below the 120-second persistent claim lifetime.
      if (state.pending >= 6) throw new QixiangQueryDeferredError("支付核对队列已满，请稍后重试。");
      const queuedAt = performance.now();
      const previous = state.tail;
      let release!: () => void;
      state.tail = new Promise<void>((resolve) => { release = resolve; });
      state.pending += 1;
      try {
        await previous;
        // Queue wait consumes the same ten-second deadline, so a busy executor
        // cannot hold a worker lease beyond its scheduler interval.
        const remainingMs = (options.timeoutMs ?? 10_000) - (performance.now() - queuedAt);
        if (remainingMs <= 0) throw new QixiangQueryDeferredError("支付核对排队超时，请稍后重试。");
        const startedAt = now();
        state.starts = state.starts.filter((value) => value > startedAt - 60_000);
        if (state.starts.length >= 12) throw new QixiangQueryDeferredError("支付服务主动核对请求过于频繁，请稍后重试。");
        state.starts.push(startedAt); // Failed transport and retries also consume budget.
        const controller = new AbortController();
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          return await Promise.race([
            operation(controller.signal),
            new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new QixiangQueryDeferredError("支付服务查单超时，请稍后重试。")); }, remainingMs); }),
          ]);
        } finally { if (timer) clearTimeout(timer); }
      } finally { state.pending -= 1; release(); }
    },
  };
}
export type QixiangQueryExecutor = ReturnType<typeof createQixiangQueryExecutor>;
declare global { var __kaiQixiangQueryExecutor: QixiangQueryExecutor | undefined; }
// Eagerly initialize at application module load, never lazily at the first query.
globalThis.__kaiQixiangQueryExecutor ??= createQixiangQueryExecutor();
export function sharedQixiangQueryExecutor() { return globalThis.__kaiQixiangQueryExecutor!; }
