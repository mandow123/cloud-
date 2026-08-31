import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  MarketplaceApiError,
  marketplaceErrorMessage,
  safeMarketplaceErrorMessage,
} from "../lib/client/marketplace-client.ts";

test("marketplace error formatting never exposes arbitrary server messages", () => {
  const error = new MarketplaceApiError({
    code: "INTERNAL_FAILURE",
    message: "postgres://internal-user:secret@db/private-table",
    requestId: "REQ-safe-1",
    status: 500,
  });
  const safe = safeMarketplaceErrorMessage(error, "Service is temporarily unavailable.", { requestIdLabel: "Request ID" });
  assert.equal(safe, "Service is temporarily unavailable. (Request ID: REQ-safe-1)");
  assert.doesNotMatch(safe, /postgres|secret|private-table/u);
  assert.doesNotMatch(marketplaceErrorMessage(error, "Safe fallback"), /postgres|secret|private-table/u);
});

test("only explicitly allowlisted business codes may select a specific message", () => {
  const allowed = new MarketplaceApiError({ code: "BALANCE_INSUFFICIENT", message: "do not expose", status: 409 });
  const unknown = new MarketplaceApiError({ code: "SOME_NEW_CODE", message: "do not expose", status: 409 });
  const options = { allowlistedMessages: { BALANCE_INSUFFICIENT: "Top up card-hours first." } };
  assert.equal(safeMarketplaceErrorMessage(allowed, "Action failed.", options), "Top up card-hours first.");
  assert.equal(safeMarketplaceErrorMessage(unknown, "Action failed.", options), "Action failed.");
});

test("critical member and payment paths use locale-safe errors and ignore response messages", () => {
  for (const path of [
    "components/manual-commercial-orders.tsx",
    "components/member-purchase-intents.tsx",
    "components/card-hour-topup-return.tsx",
    "components/card-hour-topup-appeal-form.tsx",
  ]) {
    const source = readFileSync(path, "utf8");
    assert.match(source, /safeMarketplaceErrorMessage/u, path);
    assert.doesNotMatch(source, /reason\.message|error\.message|payload\?\.error\?\.message/u, path);
  }
});

test("managed GPU and top-up appeal readers ignore arbitrary server messages", () => {
  const managed = readFileSync("lib/managed-gpu-client.ts", "utf8");
  const appeal = readFileSync("components/card-hour-topup-appeal-form.tsx", "utf8");
  const locales = ["zh-CN", "zh-TW", "en", "ja", "ko", "fr", "th", "vi", "id", "ms"];

  assert.match(managed, /MANAGED_GPU_ERROR_CODES/u);
  assert.match(managed, /managedGpuSafeErrorMessage/u);
  assert.match(managed, /safeRequestId/u);
  assert.doesNotMatch(managed, /body\?\.error\?\.message|error:\s*\{\s*message/u);

  assert.match(appeal, /safeMarketplaceErrorMessage/u);
  assert.match(appeal, /allowlistedMessages/u);
  assert.match(appeal, /safeRequestId/u);
  assert.doesNotMatch(appeal, /payload\?\.error\?\.message|reason\.message|marketplaceErrorMessage/u);

  const managedCopy = managed.slice(managed.indexOf("const MANAGED_GPU_ERROR_COPY"), managed.indexOf("const MANAGED_GPU_ERROR_CODES"));
  const appealCopy = appeal.slice(appeal.indexOf("const APPEAL_ERROR_COPY"), appeal.indexOf("function safeRequestId"));
  for (const locale of locales) {
    const marker = locale.includes("-") ? `\"${locale}\":` : `${locale}:`;
    assert.ok(managedCopy.includes(marker), `managed GPU safe copy is missing ${locale}`);
    assert.ok(appealCopy.includes(marker), `appeal safe copy is missing ${locale}`);
  }
});
