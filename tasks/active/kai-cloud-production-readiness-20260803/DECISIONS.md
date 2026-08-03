# Decisions

## 2026-08-03 — candidate mechanisms

1. Keep the current anonymous global demo API and add disclaimers only.
2. Add an anonymous signed session with per-session ownership and public anonymized demand discovery.
3. Use platform-authenticated identity on Sites and a separate demo-session fallback for direct Node hosting.
4. Add a full public account system with external OAuth.
5. Make the workflow read-only and accept inquiries outside the product.
6. Split public market data from a private, authenticated member API.

Prototype candidates: (2), (3), and (6). Selection must use actual adapter/test evidence. A disclaimer-only path cannot satisfy server-side authorization. Full OAuth exceeds the accepted v1 scope unless the user expands it.

## 2026-08-03 — feedback-driven selection

- Selected a split public/private architecture: public market demand projection, buyer-owned normalized quotes, supplier-owned raw quotes, and owner-only drafts.
- Selected a server-persisted 256-bit demo session for direct Node and Sites. Platform identity headers are ignored by default and accepted only behind an explicitly trusted header-stripping proxy.
- Rejected a shared quote DTO after independent review showed that an optional raw-price field could be serialized accidentally. Buyer and supplier DTOs and Store queries are now separate.
- Rejected the first cookie-only prototype after review showed it had no server-side expiry or CSRF binding. The revised prototype adds a sessions table, sliding server expiry, strict same-origin checks, a session-derived CSRF header, and an HTTPS write gate.
- Retained the original product boundary: all records remain fictional demo workflow data; this is not an account, payment, contract, or provisioning system.
