import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const locales = ["zh-CN", "zh-TW", "en", "ja", "ko", "fr", "th", "vi", "id", "ms"];

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("resource detail and inquiry checkout provide fixed copy for every supported locale", () => {
  const detail = source("app/resources/[id]/page.tsx");
  const checkout = source("app/checkout/[resourceId]/page.tsx");
  const purchase = source("components/catalog-purchase.tsx");
  const actions = source("components/resource-detail-actions.tsx");

  assert.match(detail, /getRequestLocale\(\)/u);
  assert.match(checkout, /getRequestLocale\(\)/u);
  assert.match(purchase, /useLocale\(\)/u);
  assert.match(actions, /useLocale\(\)/u);
  for (const locale of locales) {
    for (const [path, text] of [["detail", detail], ["checkout", checkout], ["purchase", purchase], ["actions", actions]]) {
      assert.ok(text.includes(locale), `${path} is missing ${locale}`);
    }
  }
});

test("checkout localization leaves resource facts, user input, and API payload unchanged", () => {
  const detail = source("app/resources/[id]/page.tsx");
  const purchase = source("components/catalog-purchase.tsx");

  for (const field of ["resource.title", "resource.supplierName", "resource.region", "resource.id", "resource.capacity", "resource.sla", "resource.deliveryForm", "resource.summary", "resource.quote.scopeNote"]) {
    assert.match(`${detail}\n${purchase}`, new RegExp(field.replaceAll(".", "\\."), "u"));
  }
  assert.match(purchase, /resourceId:\s*resource\.id,[\s\S]*quantity:\s*quantityNumber,[\s\S]*durationHours:\s*usesDuration \? durationNumber : null,[\s\S]*deliveryDate,[\s\S]*note,[\s\S]*sshPublicKey:/u);
  assert.match(purchase, /value=\{quantity\}[\s\S]*setQuantity\(event\.target\.value\)/u);
  assert.match(purchase, /value=\{durationHours\}[\s\S]*setDurationHours\(event\.target\.value\)/u);
  assert.match(purchase, /value=\{note\}[\s\S]*setNote\(event\.target\.value\)/u);
  assert.match(purchase, /value=\{sshPublicKey\}[\s\S]*setSshPublicKey\(event\.target\.value\)/u);
});

test("checkout errors are localized fail-safe messages with request ID only", () => {
  const purchase = source("components/catalog-purchase.tsx");

  assert.match(purchase, /submitError instanceof MarketplaceApiError \? submitError\.requestId : undefined/u);
  assert.match(purchase, /copy\.safeError/u);
  assert.match(purchase, /copy\.requestId/u);
  assert.doesNotMatch(purchase, /submitError\.message|marketplaceErrorMessage/u);
});
