import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("card-hour assets are reachable from Account Console V2 and remain organization-gated", () => {
  const shell = readFileSync("components/account-console-shell.tsx", "utf8");
  const overview = readFileSync("components/account-console-overview.tsx", "utf8");
  const page = readFileSync("app/member/card-hours/page.tsx", "utf8");

  assert.match(shell, /href: "\/member\/card-hours", labelKey: "cardHours"/u);
  assert.match(shell, /cardHours: "卡时账户"/u);
  assert.match(overview, /href="\/member\/card-hours">\{text\.topup\}/u);
  assert.match(page, /<AccountRequired purpose=\{copy\[locale\]\[2\]\} redirectOnSignedOut>/u);
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
  assert.match(source, /topupAvailability\.channels\.map\(\(item\)/u);
  assert.match(source, /disabled=\{submitting \|\| !item\.ready\}/u);
  assert.match(source, /topupAvailability\.packages\.map/u);
  assert.match(source, /套餐充值/u);
  assert.match(source, /自定义充值/u);
  assert.match(source, /当前为小额生产验收，仅支持充值 5\.00 卡时/u);
  assert.match(source, /\{ cardHours, channel \}/u);
  assert.match(source, /确认并前往支付/u);
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

test("topup catalog and checkout enforce the same five-card-hour production pilot", () => {
  const catalogRoute = readFileSync("app/api/v1/member/card-hours/route.ts", "utf8");
  const checkoutRoute = readFileSync("app/api/v1/member/card-hours/topups/route.ts", "utf8");

  assert.match(catalogRoute, /qixiangPayPilotAccess\(account\.activeOrganization\.id\)/u);
  assert.match(catalogRoute, /pilot\.ready\s*\? \[\{ code: "PRODUCTION_ACCEPTANCE"[\s\S]*cardHours: 5, amountCents: 501/u);
  assert.match(catalogRoute, /code: "STARTER"[\s\S]*cardHours: 100, amountCents: 10_020/u);
  assert.match(catalogRoute, /code: "STANDARD"[\s\S]*cardHours: 500, amountCents: 50_100/u);
  assert.match(catalogRoute, /code: "TEAM"[\s\S]*cardHours: 1_000, amountCents: 100_200/u);
  assert.match(checkoutRoute, /qixiangPayPilotAccess\(account\.activeOrganization\.id\)/u);
  assert.match(checkoutRoute, /channel !== pilot\.channel \|\| cardHourMicros !== pilot\.cardHours \* 1_000_000/u);
  assert.match(checkoutRoute, /CARD_HOUR_TOPUP_PILOT_RESTRICTED/u);
  assert.match(checkoutRoute, /获准渠道充值 5\.00 卡时/u);
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
  assert.match(source, /reconciliationRequired \? copy\.review : copy\.processing/u);
  assert.match(source, /支付结果待人工核对/u);
  assert.match(source, /请勿重复付款，也不要重新发起充值/u);
  assert.match(source, /!checking && !credited && !closed \? <button/u);
  assert.match(source, /window\.setTimeout\(poll, 3_000\)/u);
  assert.match(source, /正在通过平台服务端核对支付结果/u);
  assert.match(source, /重新核对支付结果/u);
  assert.match(source, /const reconcile = useCallback/u);
  assert.match(source, /marketplacePost<TopupDetail/u);
  assert.match(source, /充值遇到问题／发起申诉/u);
  assert.match(source, /appealEligibility\.canAppeal/u);
  assert.match(source, /支付仍在正常确认时间内/u);
  assert.match(source, /不读取浏览器回跳参数作为成功依据/u);
  assert.doesNotMatch(source, /fetch\([^\n]*api\.payqixiang|fetch\([^\n]*mapi\.php|fetch\([^\n]*api\.php/u);
  assert.doesNotMatch(source, /useSearchParams|location\.search|trade_status|return_url|success=/u);
});

test("disabled payment blocks both member reconciliation and callback-side provider queries", () => {
  const memberRoute = readFileSync("app/api/v1/member/card-hours/topups/[orderId]/route.ts", "utf8");
  const notifyRoute = readFileSync("app/api/v1/payments/qixiang-pay/notify/route.ts", "utf8");
  const provider = readFileSync("lib/server/qixiang-pay.ts", "utf8");

  assert.match(memberRoute, /if \(!qixiangPayReconciliationReadiness\(\)\.canReconcilePayment\)/u);
  assert.match(memberRoute, /CARD_HOUR_TOPUP_RECONCILIATION_DISABLED/u);
  assert.match(memberRoute, /registerTopupReconciliationRequest/u);
  assert.match(memberRoute, /requireIdempotencyKey\(request\)/u);
  assert.match(memberRoute, /mutationHash\(\{ action: "RECONCILE_QIXIANG_TOPUP", orderId \}\)/u);
  assert.match(notifyRoute, /if \(!qixiangPayReconciliationReadiness\(\)\.canReconcilePayment\) return notifyResponse\("failure", 503\)/u);
  assert.match(provider, /const config = activeOrderQueryConfiguration\(environment\)/u);
});

test("topup problems create an organization-bound appeal and expose a separate admin queue", () => {
  const memberPage = readFileSync("app/member/card-hours/topups/[orderId]/appeal/page.tsx", "utf8");
  const memberComponent = readFileSync("components/card-hour-topup-appeal-form.tsx", "utf8");
  const memberRoute = readFileSync("app/api/v1/member/card-hours/topups/[orderId]/appeal/route.ts", "utf8");
  const adminComponent = readFileSync("components/admin-card-hour-topup-appeals.tsx", "utf8");
  const adminRoute = readFileSync("app/api/v1/admin/card-hour-topup-appeals/route.ts", "utf8");
  const readRoute = readFileSync("app/api/v1/member/card-hours/topups/[orderId]/appeal/read/route.ts", "utf8");
  const migration = readFileSync("drizzle/0036_card_hour_topup_appeals.sql", "utf8");

  assert.match(memberPage, /<AccountRequired purpose="提交充值异常申诉" redirectOnSignedOut>/u);
  assert.match(memberComponent, /充值遇到问题/u);
  assert.match(memberComponent, /topupOrderId/u);
  assert.match(memberComponent, /不会因为提交申诉自动退款、自动入账或修改支付状态/u);
  assert.match(memberComponent, /if \(!topup\) return/u);
  assert.match(memberComponent, /支付结果仍在正常确认时间内/u);
  assert.match(memberComponent, /appeal\/read/u);
  assert.match(readRoute, /acknowledgeTopupAppeal/u);
  assert.match(memberRoute, /getTopupForOrganization\(account\.activeOrganization\.id, orderId\)/u);
  assert.match(memberRoute, /createTopupAppeal/u);
  assert.match(adminComponent, /按付款单人工核对/u);
  assert.match(adminComponent, /不提供修改支付状态、手工入账或自动退款能力/u);
  assert.match(adminRoute, /\["PAYMENT_READ", "APPEAL_READ"\]/u);
  assert.match(adminRoute, /\["PAYMENT_READ", "OFFLINE_REFUND_RECORD"\]/u);
  assert.match(adminRoute, /pageSizeText/u);
  assert.match(adminRoute, /Number\(pageSizeText\) > 50/u);
  assert.match(adminComponent, /应用筛选/u);
  assert.match(adminComponent, /上一页/u);
  assert.match(adminComponent, /下一页/u);
  assert.match(migration, /FOREIGN KEY \(topup_order_id\) REFERENCES card_hour_topup_orders\(id\)/u);
  assert.doesNotMatch(migration, /UPDATE card_hour_topup_orders|UPDATE card_hour_wallets|INSERT INTO card_hour_ledger/u);
});

test("topup history names processing and reconciliation states without implying success", () => {
  const source = readFileSync("components/member-card-hour-assets.tsx", "utf8");

  assert.match(source, /PROCESSING: "付款单创建中"/u);
  assert.match(source, /RECONCILIATION_REQUIRED: "待人工核对"/u);
  assert.match(source, /CAPTURED: "已到账"/u);
  assert.match(source, /充值申诉进展/u);
  assert.match(source, /申诉有新进展/u);
  assert.match(source, /unreadAppealCount/u);
});

test("card-hour assets stay usable on a 390px viewport", () => {
  const css = readFileSync("components/member-card-hour-assets.module.css", "utf8");

  assert.match(css, /min-height:\s*44px/u);
  assert.match(css, /@media \(max-width: 760px\)/u);
  assert.match(css, /\.grid,\s*\.metrics \{\s*grid-template-columns: 1fr/u);
  assert.match(css, /\.table \{\s*min-width: 0/u);
  assert.match(css, /\.table,\s*\.table tbody,\s*\.table tr,\s*\.table td \{\s*display: block/u);
});
