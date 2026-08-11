export type ExchangeErrorCode =
  | "EXCHANGE_NOT_FOUND"
  | "EXCHANGE_ROLE_FORBIDDEN"
  | "EXCHANGE_OWNERSHIP_FORBIDDEN"
  | "EXCHANGE_VERIFICATION_REQUIRED"
  | "EXCHANGE_VERIFICATION_EXPIRED"
  | "EXCHANGE_CAPACITY_CONFLICT"
  | "EXCHANGE_UNIT_MISMATCH"
  | "EXCHANGE_AMOUNT_TOO_LARGE"
  | "EXCHANGE_VERSION_CONFLICT"
  | "EXCHANGE_WITHDRAWAL_INELIGIBLE"
  | "EXCHANGE_STATE_CONFLICT"
  | "HOSTING_IMAGE_POLICY_UNAVAILABLE"
  | "HOSTING_IMAGE_POLICY_INVALID"
  | "HOSTING_AGENT_UPGRADE_REQUIRED"
  | "EXCHANGE_PAYMENT_REVIEW_REQUIRED"
  | "EXCHANGE_PAYMENT_LATE_CAPTURE"
  | "EXCHANGE_PAYMENT_ORDER_NOT_FOUND"
  | "EXCHANGE_PAYMENT_ALREADY_CAPTURED"
  | "EXCHANGE_PAYMENT_STATE_CONFLICT"
  | "EXCHANGE_TEST_PAYMENT_UNAVAILABLE"
  | "EXCHANGE_DELIVERY_ALREADY_CLAIMED"
  | "EXCHANGE_DELIVERY_PACKAGE_EXPIRED"
  | "ADMIN_LAST_ROLE_ADMIN"
  | "ADMIN_ROOT_IMMUTABLE"
  | "ADMIN_ORGANIZATION_UNAVAILABLE"
  | "ADMIN_ACCOUNT_SUSPENDED"
  | "ADMIN_PRINCIPAL_EXISTS";

export class ExchangeInputError extends Error {
  readonly field?: string;

  constructor(message: string, field?: string) {
    super(message);
    this.name = "ExchangeInputError";
    this.field = field;
  }
}

export class ExchangeIdempotencyConflictError extends Error {
  constructor() {
    super("IDEMPOTENCY_CONFLICT");
    this.name = "ExchangeIdempotencyConflictError";
  }
}

export class ExchangeDomainError extends Error {
  readonly code: ExchangeErrorCode;
  readonly status: 400 | 403 | 404 | 409 | 410 | 422 | 503;

  constructor(
    code: ExchangeErrorCode,
    status: 400 | 403 | 404 | 409 | 410 | 422 | 503,
    message: string,
  ) {
    super(message);
    this.name = "ExchangeDomainError";
    this.code = code;
    this.status = status;
  }
}
