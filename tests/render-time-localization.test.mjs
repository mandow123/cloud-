import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BusinessValue, localizeNode } from "../components/render-time-localization.ts";

const translate = (value) => value === "购买申请" ? "Purchase requests" : value;

test("render-time localization preserves a business value that collides with fixed copy", () => {
  const collision = "购买申请";
  const localized = localizeNode(
    createElement("div", { "aria-label": "购买申请" },
      "购买申请",
      createElement(BusinessValue, null, collision),
    ),
    translate,
  );

  assert.equal(
    renderToStaticMarkup(localized),
    '<div aria-label="Purchase requests">Purchase requests购买申请</div>',
  );
});

test("only fixed-copy props are translated and form business values remain byte-for-byte stable", () => {
  const collision = "购买申请";
  const localized = localizeNode(
    createElement("input", { placeholder: "购买申请", readOnly: true, value: collision }),
    translate,
  );
  const html = renderToStaticMarkup(localized);

  assert.match(html, /placeholder="Purchase requests"/u);
  assert.match(html, /value="购买申请"/u);
});

test("member surfaces put API and user-derived children behind the BusinessValue boundary", () => {
  const workspace = readFileSync(new URL("../components/member-workspace.tsx", import.meta.url), "utf8");
  const personal = readFileSync(new URL("../components/personal-center-overview.tsx", import.meta.url), "utf8");

  for (const expression of [
    "listing.title", "listing.region", "listing.deliveryForm",
    "request.id", "request.title", "request.status", "request.summary", "request.region",
    "quote.demandTitle", "quote.id", "quote.deliveryWindow", "quote.status",
    "draft.id", "draft.title", "draft.status", "draft.capacity",
    "response.id", "response.demandTitle", "response.leadTime", "response.status",
  ]) {
    assert.match(workspace, new RegExp(`<BusinessValue>[^<]*\\{${expression.replaceAll(".", "\\.")}`, "u"), `${expression} is missing its business-value boundary`);
  }

  for (const expression of [
    "summary.profile.displayName", "summary.profile.maskedEmail", "summary.profile.organizationName",
    "summary.payment.reason", "item.title", "item.region", "item.deliveryForm",
  ]) {
    assert.match(personal, new RegExp(`<BusinessValue>[^<]*\\{${expression.replaceAll(".", "\\.")}`, "u"), `${expression} is missing its business-value boundary`);
  }

  assert.match(workspace, /value=\{values\.title\}/u);
  assert.match(workspace, /value=\{values\.capacity\}/u);
  assert.match(workspace, /value=\{values\.unitPrice\}/u);
  assert.match(workspace, /value=\{values\.scopeNote\}/u);
});

test("card-hour API status can collide with fixed copy without being translated", () => {
  const collision = "状态";
  const localized = localizeNode(
    createElement("div", null,
      createElement("span", null, "状态"),
      createElement(BusinessValue, null, collision),
    ),
    (value) => value === "状态" ? "Status" : value,
  );

  assert.equal(renderToStaticMarkup(localized), "<div><span>Status</span>状态</div>");
});

test("card-hour panel marks API records and leaves the referral input value outside fixed-copy props", () => {
  const source = readFileSync(new URL("../components/card-hour-account-panel.tsx", import.meta.url), "utf8");

  for (const expression of [
    "item.orderId", "item.status", "item.business_key", "item.operation",
    "dashboard.referral.code", "dashboard.referral.invitedOrganizations",
  ]) {
    assert.match(source, new RegExp(`<BusinessValue>[^<]*\\{${expression.replaceAll(".", "\\.")}`, "u"), `${expression} is missing its business-value boundary`);
  }
  assert.match(source, /value=\{referralCode\}/u);
  assert.match(source, /localizeNode as localizeFixedNode/u);
  assert.doesNotMatch(source, /Children|cloneElement|isValidElement/u);
});
