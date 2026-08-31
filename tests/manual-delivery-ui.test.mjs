import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("administrator manual delivery controls follow the versioned lifecycle", () => {
  const component = read("components/admin-manual-delivery-intakes.tsx");
  assert.match(component, /supplier-candidates/u);
  assert.match(component, /<select value=\{supplierOrganizationId\}/u);
  assert.doesNotMatch(component, /<input[^>]+value=\{supplierOrganizationId\}/u);
  for (const action of ["assign", "start", "mark-delivered", "cancel", "revoke"]) assert.match(component, new RegExp(`"${action}"`, "u"));
  assert.match(component, /expectedVersion: selected\.statusVersion/u);
  assert.match(component, /connection: \{ host: host\.trim\(\), port: Number\(port\), username: username\.trim\(\), hostKeyFingerprint:/u);
  assert.match(component, /!hostKeyFingerprint\.trim\(\)/u);
  assert.match(component, /\["AWAITING_BUYER_ACCEPTANCE", "COMPLETED"\]\.includes\(status\)/u);
  assert.doesNotMatch(component, /\["AWAITING_BUYER_ACCEPTANCE", "COMPLETED", "CANCELLED"\]/u);
});

test("buyer sees structured SSH delivery and can confirm only from awaiting acceptance", () => {
  const component = read("components/member-purchase-intents.tsx");
  assert.match(component, /record\.status !== "AWAITING_BUYER_ACCEPTANCE"/u);
  assert.match(component, /confirm-delivery/u);
  assert.match(component, /expectedVersion: record\.statusVersion/u);
  assert.match(component, /record\.connection && \["AWAITING_BUYER_ACCEPTANCE", "COMPLETED"\]\.includes\(record\.status\)/u);
  assert.match(component, /ssh -p \{record\.connection\.port\} \{record\.connection\.username\}@\{record\.connection\.host\}/u);
  assert.match(component, /record\.status === "ACCESS_REVOKED"/u);
  assert.match(component, /平台已分配供应商/u);
  assert.match(component, /平台完成分配/u);
  assert.doesNotMatch(component, /供应商已接收/u);
  assert.match(component, /KAI 标准卡时 \/ 套·小时/u);
  assert.doesNotMatch(component, /卡时 \/ \{record\.pricing\.pricingUnit\}/u);
  assert.doesNotMatch(component, /canonicalSshPublicKey|privateKey|password/u);
});

test("supplier manual delivery task list is organization scoped and contains no buyer secrets", () => {
  const component = read("components/supplier-manual-deliveries.tsx");
  const visible = component.slice(component.indexOf("export function SupplierManualDeliveries"));
  const page = read("app/supply/page.tsx");
  assert.match(component, /\/api\/v1\/supply\/manual-deliveries/u);
  assert.match(component, /分配给本组织的人工交付/u);
  assert.match(component, /record\.sshPublicKeyFingerprint/u);
  assert.match(component, /safeDeliveryError\(reason, copy\)/u);
  assert.doesNotMatch(component, /marketplaceErrorMessage/u);
  assert.doesNotMatch(visible, /[\u3400-\u9fff]/u, "supplier delivery JSX must read visible copy from the locale dictionary");
  assert.doesNotMatch(component, /buyerEmail|buyerDisplayName|buyerAccountId|canonicalSshPublicKey|internalNote|record\.connection|record\.pricing|询价参考/u);
  assert.match(page, /<SupplierManualDeliveries appealsEnabled=\{manualAppealsEnabled\(\)\} \/>/u);
  assert.match(page, /import \{ manualAppealsEnabled \} from "@\/lib\/server\/manual-appeals"/u);
});
