# KAI Cloud production readiness

- Objective: 前后端达到可上线质量，同时保持“仅演示数据、不做真实支付/合同/自动交付”的既定产品范围。
- Success: session-scoped writes and reads, supplier/buyer data boundaries, idempotent writes, bounded pagination, auditable workflow, migration/versioning, tested backup/restore, observable health, resilient scheduled update, frontend failure/retry states, full automated and independent verification.
- Constraints: do not modify unrelated Mandow work; no production mutation without explicit approval; no browser DOM or screenshot QA under the Sites skill; do not claim real-data safety without HTTPS and formal identity.
- Permissions: local source changes and local verification are authorized; production deployment/security/network changes require approval.
- Primary risk: anonymous public APIs currently expose all demo workflow records and accept global writes.
