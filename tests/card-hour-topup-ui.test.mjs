import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("card-hour assets are reachable from Account Console V2 and remain organization-gated", () => {
  const shell = readFileSync("components/account-console-shell.tsx", "utf8");
  const overview = readFileSync("components/account-console-overview.tsx", "utf8");
  const page = readFileSync("app/member/card-hours/page.tsx", "utf8");

  assert.match(shell, /href: "\/member\/card-hours", label: "卡时账户"/u);
  assert.match(overview, /href="\/member\/card-hours">进入我的资产 \/ 充值卡时/u);
  assert.match(page, /<AccountRequired purpose="管理卡时资产" redirectOnSignedOut>/u);
  assert.match(page, /<MemberCardHourAssets \/>/u);
});

test("legacy member mode can only hand off topup to the channel-aware asset page", () => {
  const memberPage = readFileSync("app/member/page.tsx", "utf8");
  const legacyPanel = readFileSync("components/card-hour-account-panel.tsx", "utf8");

  assert.match(memberPage, /if \(isAccountConsoleV2Enabled\(\)\)/u);
  assert.match(memberPage, /<CardHourAccountPanel \/>/u);
  assert.match(legacyPanel, /href="\/member\/card-hours">进入我的资产 \/ 充值卡时/u);
  assert.match(legacyPanel, /旧版个人中心不再直接创建付款单/u);
  assert.doesNotMatch(legacyPanel, /\/api\/v1\/member\/card-hours\/topups/u);
  assert.doesNotMatch(legacyPanel, /buyCardHours|card-hour-topup|createIdempotencyKey\("card-hour-topup"\)/u);
});

test("topup UI only offers backend-approved Alipay and WeChat channels", () => {
  const source = readFileSync("components/member-card-hour-assets.tsx", "utf8");

  assert.match(source, /type PaymentChannel = "ALIPAY" \| "WXPAY"/u);
  assert.match(source, /topupAvailability\.channels\.filter\(\(item\) => item\.ready\)/u);
  assert.match(source, /readyChannels\.map\(\(item\)/u);
  assert.match(source, /\{ cardHours, channel \}/u);
  assert.match(source, /前往安全支付页/u);
  assert.match(source, /创建付款单或从收银台返回，都不代表支付成功/u);
  assert.match(source, /url\.protocol !== "https:"/u);
  assert.match(source, /window\.location\.assign\(checkoutUrl\)/u);
  assert.doesNotMatch(source, /七相|企祥|merchant|KAI_QIXIANG_PAY_KEY|privateKey|secretKey/iu);
  for (const path of [
    "components/member-card-hour-assets.tsx",
    "components/card-hour-topup-return.tsx",
    "app/member/card-hours/page.tsx",
    "app/member/card-hours/topups/[orderId]/return/page.tsx",
  ]) assert.doesNotMatch(readFileSync(path, "utf8"), /七相|企祥|merchant/iu, `${path} must not expose an unconfirmed payment brand or merchant internals`);
});

test("payment return trusts only the service-side order state", () => {
  const page = readFileSync("app/member/card-hours/topups/[orderId]/return/page.tsx", "utf8");
  const source = readFileSync("components/card-hour-topup-return.tsx", "utf8");

  assert.match(page, /params: Promise<\{ orderId: string \}>/u);
  assert.match(page, /\^KAI_CH_/u);
  assert.match(page, /<AccountRequired purpose="查看卡时充值状态" redirectOnSignedOut>/u);
  assert.match(source, /status === "CAPTURED" && record\.credited === true/u);
  assert.match(source, /status === "CLOSED"/u);
  assert.match(source, /status === "RECONCILIATION_REQUIRED"/u);
  assert.match(source, /支付结果待人工核对/u);
  assert.match(source, /请勿重复付款，也不要重新发起充值/u);
  assert.match(source, /!reconciliationRequired \? <button/u);
  assert.match(source, /window\.setTimeout\(poll, 3_000\)/u);
  assert.match(source, /不读取浏览器回跳参数作为成功依据/u);
  assert.doesNotMatch(source, /useSearchParams|location\.search|trade_status|return_url|success=/u);
});

test("topup history names processing and reconciliation states without implying success", () => {
  const source = readFileSync("components/member-card-hour-assets.tsx", "utf8");

  assert.match(source, /PROCESSING: "付款单创建中"/u);
  assert.match(source, /RECONCILIATION_REQUIRED: "待人工核对"/u);
  assert.match(source, /CAPTURED: "已到账"/u);
});

test("card-hour assets stay usable on a 390px viewport", () => {
  const css = readFileSync("components/member-card-hour-assets.module.css", "utf8");

  assert.match(css, /min-height:\s*44px/u);
  assert.match(css, /@media \(max-width: 760px\)/u);
  assert.match(css, /\.grid,\s*\.metrics \{\s*grid-template-columns: 1fr/u);
  assert.match(css, /\.table \{\s*min-width: 0/u);
  assert.match(css, /\.table,\s*\.table tbody,\s*\.table tr,\s*\.table td \{\s*display: block/u);
});
