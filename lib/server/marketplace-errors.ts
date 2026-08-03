export class MarketplaceRateLimitError extends Error {
  constructor(public readonly retryAfterSeconds: number) {
    super("RATE_LIMITED");
    this.name = "MarketplaceRateLimitError";
  }
}

export class MarketplaceIdempotencyConflictError extends Error {
  constructor() {
    super("IDEMPOTENCY_CONFLICT");
    this.name = "MarketplaceIdempotencyConflictError";
  }
}

export class MarketplaceAccessError extends Error {
  constructor(public readonly code: "DEMAND_NOT_FOUND" | "DEMAND_NOT_AVAILABLE") {
    super(code);
    this.name = "MarketplaceAccessError";
  }
}

export class MarketplaceCsrfError extends Error {
  constructor(public readonly code: "ORIGIN_REJECTED" | "CSRF_REJECTED") {
    super(code);
    this.name = "MarketplaceCsrfError";
  }
}

export class MarketplacePayloadTooLargeError extends Error {
  constructor() {
    super("PAYLOAD_TOO_LARGE");
    this.name = "MarketplacePayloadTooLargeError";
  }
}

export class MarketplaceHttpsRequiredError extends Error {
  constructor() {
    super("HTTPS_REQUIRED");
    this.name = "MarketplaceHttpsRequiredError";
  }
}

export class MarketplaceStateConflictError extends Error {
  constructor() {
    super("STATE_CONFLICT");
    this.name = "MarketplaceStateConflictError";
  }
}

export type MarketplaceCapacityScope = "sessions" | "requests" | "quotes" | "drafts";

export class MarketplaceCapacityError extends Error {
  constructor(
    public readonly scope: MarketplaceCapacityScope,
    public readonly retryAfterSeconds = 15 * 60,
  ) {
    super("MARKETPLACE_CAPACITY_REACHED");
    this.name = "MarketplaceCapacityError";
  }
}

export class MarketplaceDemandQuoteLimitError extends Error {
  constructor(public readonly retryAfterSeconds = 24 * 60 * 60) {
    super("DEMAND_QUOTE_LIMIT_REACHED");
    this.name = "MarketplaceDemandQuoteLimitError";
  }
}
