# Cloud stabilization release contract

## Ownership and status

GitHub `codex/cloud-stable` is the release source. GitLab mirrors the same SHA; it cannot independently promote divergent code. Old branches and immutable tags are preserved. Each PR includes independent review findings, their disposition and exact test results. CI must pass on the actual merged commit before deployment. No production secrets or data are available to public CI.

The sequence is S1 (membership and origin security), S2 (identity and market), S3 (payment candidate only). A merged PR is not deployment evidence. Keep release/acceptance status in each immutable release's separate append-only observation records. The initial baseline predates these fixes and is not an eligible unrestricted rollback target.

Operate the user's designated self-hosted server. Do not introduce Alibaba managed services or make an Alibaba console login a prerequisite. Verify the actual existing reverse proxy and ingress dependencies before changing listeners or DNS; historical edge templates are not evidence of the installed configuration.

Before S2 identity deployment, obtain trusted evidence linking historical issuer/subject identities to the root issuer. The identity developer console can provide that evidence when it exposes stable subject identifiers and application records; identity-server access is not inherently required. Preserve account, organization and membership IDs; ambiguous mappings block deployment and must never be resolved by email-based automatic merging.

## Immutable publication

Use `cloud-pc/YYYY.MM.DD.N` as the release identifier and Git tag. Pass it with `--release-id` to `ops:image:promote`. Publish only through the single production publisher with its fixed release-record directory. Never run concurrent publishers using alternate directories. Publication checks both existing local records and the remote SHA tag before building; an existing tag, uncertain registry response or publisher lock stops publication. A crashed publisher lock must be investigated before removal.

Create and push the unique protected Git release tag for the reviewed CI-passing commit before promotion. The local tag must resolve to HEAD and its release identifier must not already appear in a preserved release record. Verify the remote tag matches the same SHA; never move an existing tag to reuse its identifier.

Record the issue/PR, complete SHA, immutable image digest, configuration revision, schema markers, test evidence, backup manifest hash and verified rollback target. Real config stays outside Git; public records contain identifiers and booleans only. Environment and release records are write-once. Additional observations use new timestamped records, never overwrite old evidence.

Before any build/push, `--validation-evidence` must identify `releaseSha`, `schemaSha256`, `configurationSha256`, `restoreManifestSha256` and `testReportSha256`. Hash actual rehearsal schema, configuration revision, backup manifest and test report, keeping secret values outside Git. Inputs are parsed before publication. If publication was interrupted after push, reuse the existing digest after verifying its revision/platform and reconstruct evidence from the preserved inputs; never rebuild or move that tag.

`rollback.available` is false until evidence for that exact previous digest establishes current-database compatibility, suspended-member rejection, private origin and disabled new payments. Optional `--rollback-evidence` JSON includes `releaseSha`, `imageReference`, `candidateReleaseSha`, `testedAt`, the same four evidence hashes and four true assertions `currentDatabaseCompatible`, `suspendedMembershipDenied`, `originPrivate`, `newPaymentsDisabled`. It must match the candidate's evidence and be no older than twenty-four hours, never future-dated. Assertions come from actual rehearsal results. Rehearse again when schema/configuration or the recovery checkpoint changes.

## Mandatory deployment and rollback overlay

Apply `deploy/compose.stabilization.yml` after the base Compose for EVERY deployment and rollback. It fixes new Qixiang and Alipay checkout to zero and keeps a single application instance. Preserve the separate existing reconciliation configuration. Inspect the rendered Compose, running container environment booleans and every new-checkout API; a frontend-hidden button is insufficient. Confirm the base port is loopback-only at the actual Docker binding and external probe.

Origin hardening must use the verified current edge peer/health-check configuration. Do not copy historical 3054/AWS socket templates or trust client-supplied forwarding headers. Keep same-host services working; CloudPay's Cloud frontend proxy is also a potential path to the same application and must be included in the origin review. Internal scheduler routes must never be forwarded from any public virtual host.

## Rehearsal and maintenance

Use isolated database, Compose project, origin, cookies and synthetic identity/payment credentials. Block outbound production payment/notification calls and production timers/agents. Run schema, integrity, foreign-key and business checks on a restored copy before scheduling a cutover. The production table versions remain unchanged.

Pre-pull images and complete long checks before the window. Stop new writes, drain requests/background writers, account for pending callbacks, create a final consistent recovery point, stop the old writer and start the candidate. Decide by minute seven, reserving three minutes for the rehearsed fallback; if rehearsal cannot meet ten minutes, do not start. Never acknowledge an unpersisted callback as successful. Provider retries plus active reconciliation must be demonstrated, or outstanding callbacks must first be handled safely.

After any business write, retain the current database. Roll back only to a compatible security-fixed image with the mandatory overlay and origin restrictions. Otherwise close affected operations and fix forward. S1's initial fallback can serve only public read-only routes while private business routes are blocked. Never restore an older database over payments, ledger, orders, revoked access or audit records.

Observe each deployment for thirty minutes and at least twenty-four hours covering daily market updates and hourly backups. New payment remains disabled. S3 stays an isolated candidate until a separately selected database disaster-recovery design has been implemented and rehearsed; only then perform the existing controlled 5.01 CNY / 5 card-hour real-payment acceptance.

## Monitoring

The host records health events every minute. Three consecutive readiness failures, market age above 26 hours, backup age above 90 minutes and reconciliation incidents trigger events. The current Codex task checks every five minutes and reports only new incidents, recovery or required action. Local task delivery requires the computer and application running; after an offline period it checks persisted events and reports missed changes. No claim of offline real-time notification or completed offsite recovery is made.
