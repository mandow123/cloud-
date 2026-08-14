export const CARD_HOUR_ASSET_CODE = "KAI_CREDIT_HOUR" as const;
export const CARD_HOUR_MICROS = 1_000_000;
export const CARD_HOUR_TOPUP_BLOCK_MICROS = 5 * CARD_HOUR_MICROS;
export const CARD_HOUR_TOPUP_BLOCK_CENTS = 501;
export const CARD_HOUR_MAX_TOPUP = Math.floor(100_000_000 / CARD_HOUR_TOPUP_BLOCK_CENTS) * 5;

export function formatCardHourMicros(value: number) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("CARD_HOUR_AMOUNT_INVALID");
  const whole = Math.floor(value / CARD_HOUR_MICROS);
  const fraction = String(value % CARD_HOUR_MICROS).padStart(6, "0").replace(/0+$/u, "");
  return fraction ? `${whole}.${fraction}` : String(whole);
}

export function parseTopupCardHours(value: unknown) {
  const text = typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
  if (!/^\d{1,8}(?:\.0{1,6})?$/u.test(text)) throw new Error("CARD_HOUR_TOPUP_INVALID");
  const whole = Number(text.split(".")[0]);
  if (!Number.isSafeInteger(whole) || whole < 5 || whole > CARD_HOUR_MAX_TOPUP || whole % 5 !== 0) throw new Error("CARD_HOUR_TOPUP_INVALID");
  return whole * CARD_HOUR_MICROS;
}

export function topupAmountCents(cardHourMicros: number) {
  if (!Number.isSafeInteger(cardHourMicros) || cardHourMicros < CARD_HOUR_TOPUP_BLOCK_MICROS || cardHourMicros % CARD_HOUR_TOPUP_BLOCK_MICROS !== 0) {
    throw new Error("CARD_HOUR_TOPUP_INVALID");
  }
  return (cardHourMicros / CARD_HOUR_TOPUP_BLOCK_MICROS) * CARD_HOUR_TOPUP_BLOCK_CENTS;
}

export function cnyCentsToCardHourMicros(cents: number) {
  if (!Number.isSafeInteger(cents) || cents < 1 || cents > 100_000_000) throw new Error("CARD_HOUR_PRICE_INVALID");
  const numerator = BigInt(cents) * 10n * BigInt(CARD_HOUR_MICROS);
  const value = Number((numerator + 1001n) / 1002n);
  if (!Number.isSafeInteger(value)) throw new Error("CARD_HOUR_PRICE_INVALID");
  return value;
}
