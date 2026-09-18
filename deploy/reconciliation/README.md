# Payment reconciliation candidate (not deployed)

This directory belongs to S3. New Qixiang checkout remains disabled (`KAI_QIXIANG_PAY_ENABLED=0`). Reconciliation uses existing merchant orders and the v6 / `0038` schema. It does not enable real-payment acceptance.

Before enabling the timer, require all of the following:

- Exactly one application process uses the production query credential; no other worker, canary, or predecessor process may query with it.
- Application port is bound to loopback. Every public proxy must reject `/api/internal/` before forwarding, including alternate origin hosts and IPv6. Request Host checks cannot prove socket peer identity.
- A dedicated random URL-safe 32–128 character `KAI_INTERNAL_RECONCILIATION_TOKEN` is supplied to the application and the external `0600` worker environment file; never put a real value in Git or command arguments.
- `KAI_QIXIANG_PAY_RECONCILIATION_ENABLED=1` and existing credential checks pass. This is independent of new-checkout enablement.
- Install the client and systemd files under the deployment's operations directory and explicitly verify the actual paths, service user, Node 24 runtime and permissions. Do not start this candidate timer during S1/S2.

The application scans at most 50 due rows per rolling minute. Each order is durably claimed before network access; claims can be taken over after 120 seconds. All active-query entrances share FIFO admission, at most 12 starts per credential in any 60 seconds, one concurrent query, a 10-second total queue-and-query deadline and 60-second process boot cooldown. Queue depth is six to keep wait below claim expiry. Every attempted transport consumes budget. Retries back off from 30 seconds to five minutes. Twelve unsuccessful claims create one existing-admin work item and audit event; the order remains unresolved and subsequent bounded reconciliation can still discover payment.

The client prints aggregate counters only. Timer failures or nonzero deferred counts must be collected by the operations monitoring added in the release workstream. Never acknowledge a callback as successful merely because work has been queued.

## Historical Supply Pilot recovery

Use Node 24 with `--experimental-transform-types`:

```
node --experimental-transform-types scripts/ops/supply-payment-recovery.mjs --source /protected/copy-or-live.sqlite --limit 100
```

Scanning opens the source read-only, does not initialize schemas and returns a cursor for the next page. Keep the result, which includes order IDs, in protected internal storage outside Git.

To rehearse one reviewed result, add `--copy-directory /protected/new-drill-directory --order-id REVIEWED_ORDER --fingerprint REVIEWED_SHA256 --operator APPROVED_OPERATOR`. The command refuses an existing destination, snapshots the source consistently into a new copy, then applies only to that copy. This candidate has no command that writes a live source database. A changed fingerprint requires a new scan. The rehearsal records integrity checks and an audit event.

Automatic completion requires a proven balanced immutable debit and intact reservation. Automatic compensating credit requires an expired, undelivered reservation and no vested/ambiguous rewards. Conflicting ownership, ledger, payment or delivery evidence enters a manual work item; original payment and ledger facts are retained. Real payments and live recovery remain gated by a separately accepted restore/reconciliation plan.
