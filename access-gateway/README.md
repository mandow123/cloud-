# KAI Access Gateway

KAI Access Gateway gives an order a temporary public SSH endpoint without exposing the supplier host. The Host Agent opens an outbound TLS 1.3 connection to the gateway; the buyer connects to a contract-specific gateway port and still authenticates with the public key installed inside the isolated workload container.

Security boundaries:

- the gateway never receives the supplier host SSH key;
- the buyer never reaches the host SSH daemon;
- every lease is bound to one device, one contract, one public port and an expiry;
- Agent tickets and short-lived buyer tokens are random 256-bit values and only domain-separated HMAC digests are persisted;
- a buyer must send the JSON-line token handshake before an Agent slot is selected, so scans and unauthenticated sockets cannot consume delivery capacity;
- pending authentication, active connections and per-source attempts are bounded per lease;
- revocation closes the public listener, waiting Agent slots and active streams;
- the control API binds to loopback by default and requires a separate bearer token;
- production Agent transport requires TLS 1.3.

The service is intentionally separate from the web application so TCP forwarding cannot weaken the web container. The Hosting control plane creates the lease before the contract can become `READY`, returns the one-time Agent bundle only to the signed Host Agent, issues a separate short-lived buyer token to the authenticated buyer, and revokes the same contract lease before cancellation, failed delivery, cleanup or a terminal transition.

The buyer TCP preface is one UTF-8 JSON line followed by the proxied protocol bytes:

```json
{"version":1,"leaseId":"hgw_…","token":"short-lived-secret"}
```

`KAI_ACCESS_GATEWAY_CONTROL_URL` and `KAI_ACCESS_GATEWAY_CONTROL_TOKEN` are required for NAT-closed-loop readiness. With either value missing or invalid, readiness reports `natClosedLoop: false`; the platform must not advertise NAT hosting as available.
