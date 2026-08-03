# Evidence

- Existing direct deployment is reachable at `http://43.198.97.0:3050/` and stores workflow data in SQLite.
- Existing Sites deployment uses D1 and private owner-only access.
- Prior tests verified basic request → quote → buyer visibility and persistence after restart.
- Current store interfaces list all requests, quotes, and drafts globally and do not accept an actor/session context.
- Independent live audit reproduced anonymous reads of request and raw quote records on the current production endpoint.
- Independent operations audit found HTTP-only public exposure, no consistent SQLite backup, no migration ledger, shared DB/market write mount, mutable updater image, and no valid data-compatible rollback evidence.
- Independent frontend audit found all-or-nothing loading, seeded data mixed with backend truth, no timeout/idempotency client, wrong duration semantics for non-hour units, incomplete URL state, and raw quotes rendered as buyer output.
- Security review invalidated the initial trusted-header and shared-DTO ideas; both were revised before verification.
- Frontend now uses larger readable type/control scales, explicit visual hierarchy, mobile-safe primary actions, URL-shareable filters, and real marketplace API states instead of seeded member records.
- Marketplace APIs now use server-persisted anonymous demo sessions, CSRF, exact-origin checks, idempotency, durable write limits, signed actor-bound cursors, 32 KiB streaming limits, and split supplier/buyer projections.
- Readiness now rejects bundled, stale, future-dated, secret-invalid, and database-unhealthy deployments while liveness remains independent.
- Fresh schema-only migration executes on an empty SQLite database; a separate runtime legacy import preserves old requests, quotes, and drafts while stripping supplier free text from the buyer projection.
- Migration SQL byte checksum is locked to `d74de64ac6ae258827f09dec9e5f2edf2e4c45b9a9d90749e8e72856d90889b5`; repository attributes enforce LF for Linux and migration assets.
- Local release gates passed on 2026-08-03: production build, 44/44 automated tests, full ESLint, TypeScript no-emit, dependency audit with zero vulnerabilities, diff check, backup/restore self-test, and deployment configuration validation.
- Independent verifier repeated the complete gate and returned PASS for the source release candidate with no remaining P0/P1 code blocker.
- Production-mode local preview is live on loopback at `http://localhost:3011/`; liveness, readiness, home SSR, anonymous session, CSRF-protected request creation, persistence, and owner-scoped read all returned success.
- The target Ubuntu host, DNS/TLS, firewall, timer execution, immutable image, and off-host backup have not been changed or claimed as verified; these remain explicit production cutover gates.
