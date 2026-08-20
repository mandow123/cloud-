import { requiresManualSshPublicKey } from "@/lib/manual-delivery";
import type { ResourceListing, Supplier } from "@/lib/types";

export type BuyCatalogClassification = "PRIMARY_INQUIRY" | "REFERENCE_LEAD" | "EXCLUDED";

export type BuyCatalogExclusionReason =
  | "REFERENCE_LEAD"
  | "NOT_SUPPLIER_QUOTE"
  | "NOT_GPU"
  | "SUPPLIER_UNRESOLVED"
  | "SUPPLIER_IDENTITY_MISMATCH"
  | "QUOTE_INVALID"
  | "QUOTE_EXPIRED"
  | "NOT_MANUAL_SSH_DELIVERY";

type SupplierIdentity = Pick<Supplier, "id" | "name">;
type ClockValue = number | string | Date;

function timestamp(value: ClockValue) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value;
  return Date.parse(value);
}

function quoteIsPositiveAndConsistent(listing: ResourceListing) {
  const { rangeMin, median, rangeMax } = listing.quote;
  return [rangeMin, median, rangeMax].every((value) => Number.isFinite(value) && value > 0)
    && rangeMin <= median
    && median <= rangeMax;
}

/**
 * One shared, deterministic boundary for the public buy catalog.
 *
 * Supplier workbook rows stay discoverable as reference leads, but only a
 * current, attributable supplier GPU quote that can enter the manual SSH
 * fulfillment intake is allowed to create a purchase intent.
 */
export function buyCatalogExclusionReason(
  listing: ResourceListing,
  supplierDirectory: readonly SupplierIdentity[],
  now: ClockValue = Date.now(),
): BuyCatalogExclusionReason | null {
  if (listing.source?.kind === "USER_PROVIDED_WORKBOOK_REFERENCE") return "REFERENCE_LEAD";
  if (listing.source?.kind !== "SUPPLIER_PROVIDED_QUOTE" || listing.source.verificationStatus !== "SUPPLIER_PROVIDED") {
    return "NOT_SUPPLIER_QUOTE";
  }
  if (listing.category !== "gpu") return "NOT_GPU";

  const supplier = supplierDirectory.find((candidate) => candidate.id === listing.supplierId);
  if (!supplier) return "SUPPLIER_UNRESOLVED";
  if (supplier.name !== listing.supplierName || supplier.name !== listing.source.supplierName) {
    return "SUPPLIER_IDENTITY_MISMATCH";
  }
  if (!quoteIsPositiveAndConsistent(listing)) return "QUOTE_INVALID";

  const nowMs = timestamp(now);
  const validUntilMs = Date.parse(listing.quote.validUntil);
  if (!Number.isFinite(nowMs) || !Number.isFinite(validUntilMs) || validUntilMs <= nowMs) return "QUOTE_EXPIRED";
  if (!requiresManualSshPublicKey(listing)) return "NOT_MANUAL_SSH_DELIVERY";
  return null;
}

export function classifyBuyCatalogListing(
  listing: ResourceListing,
  supplierDirectory: readonly SupplierIdentity[],
  now: ClockValue = Date.now(),
): BuyCatalogClassification {
  const reason = buyCatalogExclusionReason(listing, supplierDirectory, now);
  if (reason === "REFERENCE_LEAD") return "REFERENCE_LEAD";
  return reason === null ? "PRIMARY_INQUIRY" : "EXCLUDED";
}

export function isPrimaryInquiryListing(
  listing: ResourceListing,
  supplierDirectory: readonly SupplierIdentity[],
  now: ClockValue = Date.now(),
) {
  return classifyBuyCatalogListing(listing, supplierDirectory, now) === "PRIMARY_INQUIRY";
}

export function partitionBuyCatalog(
  listings: readonly ResourceListing[],
  supplierDirectory: readonly SupplierIdentity[],
  now: ClockValue = Date.now(),
) {
  const primary: ResourceListing[] = [];
  const referenceLeads: ResourceListing[] = [];
  const excluded: ResourceListing[] = [];

  for (const listing of listings) {
    const classification = classifyBuyCatalogListing(listing, supplierDirectory, now);
    if (classification === "PRIMARY_INQUIRY") primary.push(listing);
    else if (classification === "REFERENCE_LEAD") referenceLeads.push(listing);
    else excluded.push(listing);
  }
  return { primary, referenceLeads, excluded } as const;
}
