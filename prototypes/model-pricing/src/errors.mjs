export class PricingPrototypeError extends Error {
  constructor(code, message, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = "PricingPrototypeError";
    this.code = code;
    this.retryable = Boolean(options.retryable);
  }
}
export function fail(code, message, options) {
  throw new PricingPrototypeError(code, message, options);
}
