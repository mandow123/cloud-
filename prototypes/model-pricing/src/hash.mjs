import { createHash } from "node:crypto";
import { fail } from "./errors.mjs";

export function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function canonicalizePricingRegion(html) {
  if (typeof html !== "string" || html.length === 0) {
    fail("EMPTY_RESPONSE", "Pricing page returned no content", { retryable: true });
  }
  const match = html.match(/<main\b[^>]*\bdata-kai-pricing-root(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?(?=[\s>])[^>]*>([\s\S]*?)<\/main>/i);
  if (!match) {
    fail("PAGE_MARKER_MISSING", "Reviewed pricing region marker was not found");
  }
  return match[1]
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/>\s+</g, "><")
    .replace(/\s+/g, " ")
    .trim();
}

export function reviewedRegionHash(html) {
  return sha256(canonicalizePricingRegion(html));
}
