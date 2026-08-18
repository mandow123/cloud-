export const SUPPLIER_LISTING_PRICE_MULTIPLIER = 1.5;

export function applySupplierListingMarkup(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return value;
  return Math.round(amount * SUPPLIER_LISTING_PRICE_MULTIPLIER * 100) / 100;
}
