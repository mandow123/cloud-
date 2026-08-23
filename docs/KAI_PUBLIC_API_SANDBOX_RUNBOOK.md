# KAI Cloud public verification sandbox

## Decision

Build small and validate in a non-production sandbox. The public API, Hosting V2 trading, billing, and production credentials remain disabled by default.

## Evidence status

- **Fact:** `ef656ce` contains the internal resource verification Store and signed Host Agent registration, heartbeat, and verification command flow.
- **Fact:** the implementation branch belongs to `codex/supplier-reference-catalog-100`; the current upstream base is `ac9d357`.
- **Fact:** the website routes use administrator or account sessions and are not partner API contracts.
- **Fact:** the public layer uses an independent OAuth client identity, organization binding, idempotency records, audit events, and webhook outbox.
- **Fact:** the sandbox pairing bundle points Agent 1.9.7 at its existing signed v2 registration transport; a server-side bridge links registration and heartbeats back to the owning public verification. The documented public signed-device routes remain available for direct contract validation.
- **Assumption:** the selected sandbox organization already has an approved supplier profile with immutable agreement and evidence digests.
- **Open question:** the owner must provide a non-production OAuth client, exact Webhook hostname, receiver, and disposable GPU node.

## Required environment

Keep secrets outside source control. `secretSha256` is the lowercase SHA-256 digest of the client secret; the signing secret and webhook secret are random values of at least 32 characters.

```text
KAI_PUBLIC_API_ENABLED=1
KAI_PUBLIC_API_ISSUER=kai-cloud-sandbox
KAI_PUBLIC_API_TOKEN_SIGNING_SECRET=<sandbox-only-random-secret>
KAI_PUBLIC_API_WEBHOOK_ALLOWED_HOSTS=<exact-zod-sandbox-hostname>
KAI_PUBLIC_API_CLIENTS=[{"clientId":"zod-sandbox-backend","secretSha256":"<64 lowercase hex>","organizationId":"<approved internal org id>","organizationReference":"<partner org reference>","accountId":"<service account id>","scopes":["resource:read","verification:write","agent:write"],"webhookUrl":"https://<exact-zod-sandbox-hostname>/api/internal/kai-cloud/webhooks/resource-verification","webhookSecret":"<sandbox-only-random-secret>"}]
KAI_HOSTING_V2=0
KAI_HOSTING_V2_SETUP=1
```

Production additionally requires an independently configured rate-limiting gateway and a trusted proxy that overwrites forwarding headers:

```text
KAI_PUBLIC_API_GATEWAY_RATE_LIMITED=1
KAI_TRUST_PROXY=1
```

The App receives none of these values. The pairing bundle contains only the short-lived challenge, nonce, minimum Agent version, expiry, and registration URL. The device generates and retains its own Ed25519 private key.

## Golden loop

1. Obtain a five-minute access token through `client_credentials`.
2. Create a resource verification with an idempotency key.
3. Create a short-lived Agent Challenge for the same resource reference.
4. Pair one disposable Host Agent through the signed registration endpoint returned by the Challenge.
5. Send signed, monotonically sequenced heartbeats; the first valid heartbeat queues the existing VERIFY command.
6. Let the Agent poll and complete VERIFY through the existing signed command channel.
7. Send the next heartbeat, query the verification until it is `passed`, and verify the signed webhook has the same version.
8. Change the inventory digest and confirm the public state no longer remains passed.
9. Stop heartbeats and confirm the device/verification fails closed as offline.
10. Revoke the verification and confirm replay is idempotent.

## Acceptance criteria

- Given a missing, expired, tampered, wrong-organization, or under-scoped token, when a partner route is called, then it returns 401/403/404 without disclosing another organization.
- Given two OAuth client authentication methods or duplicate parameters, when a token is requested, then it is rejected without indicating which credential field was wrong.
- Given an untrusted forwarded protocol, missing production gateway assertion, or Webhook hostname outside the exact allowlist, when the public API is used, then it fails closed.
- Given the same idempotency key and payload, when a mutation is repeated, then it returns the original result; a different payload returns 409.
- Given an expired/reused Challenge, invalid signature, stale proof, or out-of-order heartbeat, when the Agent request arrives, then it is rejected and no verified state is written.
- Given a passed device whose evidence expires or whose heartbeat is offline, when status is read, then it is not returned as passed.
- Given webhook delivery failure, when retryable, then the outbox retains it with bounded exponential delay; permanent unsafe targets are dead-lettered.

## Human gates

Authentication, organization isolation, proxy trust, egress policy, and the at-least-once Webhook receiver require security review. A real sandbox client, webhook receiver, and disposable GPU node are required before either upstream or consumer PR is marked ready. Production enablement, trading, billing, signing, deployment, and release are separate approvals.
