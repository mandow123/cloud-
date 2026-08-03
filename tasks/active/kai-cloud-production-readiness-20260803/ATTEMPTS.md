# Attempts

- Prototype 1: anonymous random cookie hashed directly to an owner id. Rejected as incomplete because it lacked a persisted expiry/session record and CSRF binding.
- Prototype 2: optional platform email header plus cookie fallback. Revised after review: forwarded identity is disabled unless an explicitly trusted proxy boundary is configured; forwarded protocol is ignored.
- Prototype 3: shared quote DTO with an optional supplier raw price. Rejected after review because a serializer regression could leak raw data. Replaced with distinct raw and normalized DTOs and Store queries.
