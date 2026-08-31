import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(path, "utf8");
const source = read("components/manual-commercial-orders.tsx");
const buyer = source.slice(source.indexOf("export function MemberManualCommercialOrders"), source.indexOf("export function SupplierManualCommercialOrders"));
const supplier = source.slice(source.indexOf("export function SupplierManualCommercialOrders"), source.indexOf("export function AdminManualCommercialOrders"));
const admin = source.slice(source.indexOf("export function AdminManualCommercialOrders"));

test("manual order surfaces stay behind a disabled-by-default server flag", () => {
  const feature = read("lib/server/manual-order-feature.ts");
  assert.match(feature, /KAI_MANUAL_ORDER_FLOW_V1\?\.trim\(\)==="1"/u);
  for (const path of ["app/member/purchases/page.tsx", "app/member/purchases/[demandId]/page.tsx", "app/supply/page.tsx", "app/admin/delivery/page.tsx"]) {
    const page = read(path);
    assert.match(page, /manualOrderFlowEnabled\(\)/u, `${path} must read the server-side order flag`);
    assert.match(page, /(?:manualOrderFlowEnabled\(\)|orderFlowEnabled) \?/u, `${path} must omit the order DOM when flag=0`);
  }
});

test("buyer uses only card hours and server-confirmed hold and acceptance actions", () => {
  assert.match(buyer, /\/api\/v1\/member\/manual-orders/u);
  for (const action of ["accept-offer", "confirm-connection", "accept-completion"]) assert.match(buyer, new RegExp(action, "u"));
  assert.match(buyer, /expectedVersion: record\.version/u);
  assert.match(buyer, /HELD[^\n]{0,80}尚未扣减/u);
  assert.match(buyer, /\/member\/card-hours/u);
  assert.match(buyer, /发起申诉/u);
  assert.match(buyer, /formatCardHourDisplayMicros/u);
  assert.doesNotMatch(buyer, /money\(|supplierReceivable|platformFee|payout/u);
  assert.doesNotMatch(buyer, /退款|自动交付|provider|bank|alipay|wxpay/iu);

  const purchaseDetail = read("components/member-purchase-intents.tsx");
  const detailPage = read("app/member/purchases/[demandId]/page.tsx");
  assert.match(detailPage, /orderFlowEnabled=\{orderFlowEnabled\}/u);
  assert.match(purchaseDetail, /record\.status === "AWAITING_BUYER_ACCEPTANCE" && !orderFlowEnabled/u);
  assert.match(purchaseDetail, /请在下方人工算力订单中确认连接可用/u);
});

test("supplier follows quote then fulfillment and shows receivable only after eligibility", () => {
  assert.match(supplier, /\/api\/v1\/supply\/manual-orders/u);
  assert.match(supplier, /expectedDeliveryStatusVersion: selectedDelivery\.statusVersion/u);
  assert.match(supplier, /quotedCardHourMicros/u);
  for (const action of ["prepare", "ready", "service-complete"]) assert.match(supplier, new RegExp(action, "u"));
  assert.match(supplier, /actualCardHourMicros/u);
  assert.match(supplier, /record\.settlement\.status === "ELIGIBLE"/u);
  assert.match(supplier, /copy\.receivable/u);
  assert.match(supplier, /copy\.payoutClosed/u);
  assert.match(supplier, /safeSupplierOrderError\(reason, copy\)/u);
  assert.doesNotMatch(supplier, /marketplaceErrorMessage/u);
  assert.doesNotMatch(supplier, /record\.delivery\.connection|accept-offer|accept-completion|退款/u);
  assert.doesNotMatch(supplier, /[\u3400-\u9fff]/u, "supplier order JSX must read visible copy from the locale dictionary");
  for (const locale of ['"zh-CN"', '"zh-TW"', "en:", "ja:", "ko:", "fr:", "th:", "vi:", "id:", "ms:"]) assert.match(source, new RegExp(locale, "u"));
});

test("administrator order oversight is read-only and cannot forge financial states", () => {
  assert.match(admin, /\/api\/v1\/admin\/manual-orders/u);
  assert.match(admin, /record\.status === "CANCELLED" \|\| record\.settlement\.status === "ELIGIBLE"/u);
  assert.match(admin, /管理员不能在这里伪造 HELD、扣减、结算或真实出款状态/u);
  assert.match(admin, />CLOSED</u);
  assert.doesNotMatch(admin, /adminPostAction|marketplacePost|onClick=\{\(\) => void mutate/u);
});
