import type { CardHourStore } from "./card-hour-store.ts";
import type { QixiangQueryProtection } from "./qixiang-pay.ts";

const WINDOW_MS = 60_000;
const MAX_REQUESTS = 12;
const FAILURE_THRESHOLD = 3;
const CIRCUIT_OPEN_MS = 60_000;

export function createDurableQixiangQueryProtection(store: CardHourStore): QixiangQueryProtection {
  return {
    async acquire(credentialId, now) {
      const timestamp = Date.parse(now);
      if (!Number.isFinite(timestamp)) throw new Error("QIXIANG_QUERY_PROTECTION_TIME_INVALID");
      return store.acquireQixiangQueryPermit({
        credentialId,
        now,
        resetBefore: new Date(timestamp - WINDOW_MS).toISOString(),
        maxRequests: MAX_REQUESTS,
      });
    },
    async record(credentialId, outcome, now) {
      const timestamp = Date.parse(now);
      if (!Number.isFinite(timestamp)) throw new Error("QIXIANG_QUERY_PROTECTION_TIME_INVALID");
      await store.recordQixiangQueryOutcome({
        credentialId,
        outcome,
        now,
        failureThreshold: FAILURE_THRESHOLD,
        circuitOpenUntil: new Date(timestamp + CIRCUIT_OPEN_MS).toISOString(),
      });
    },
  };
}
