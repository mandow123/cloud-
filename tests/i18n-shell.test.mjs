import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  DEFAULT_LOCALE,
  localeOptions,
  normalizeLocale,
  supportedLocales,
  translate,
} from "../lib/i18n.ts";

test("global language registry covers the requested markets", () => {
  assert.equal(DEFAULT_LOCALE, "zh-CN");
  assert.deepEqual(supportedLocales, ["zh-CN", "zh-TW", "en", "ja", "ko", "fr", "th", "vi", "id", "ms"]);
  assert.equal(localeOptions.length, supportedLocales.length);
  assert.deepEqual(localeOptions.map((item) => item.value), [...supportedLocales]);
});

test("browser language values resolve to supported locales", () => {
  assert.equal(normalizeLocale("zh-Hant-HK"), "zh-TW");
  assert.equal(normalizeLocale("zh-SG"), "zh-CN");
  assert.equal(normalizeLocale("en-US"), "en");
  assert.equal(normalizeLocale("th-TH"), "th");
  assert.equal(normalizeLocale("vi-VN"), "vi");
  assert.equal(normalizeLocale("unknown"), "zh-CN");
});

test("every locale has usable shell translations", () => {
  for (const locale of supportedLocales) {
    for (const key of ["language", "languageScope", "theme", "buy", "request", "compute", "hosting", "guides", "disclaimer"]) {
      assert.ok(translate(locale, key).trim().length > 0, `${locale}.${key} is empty`);
    }
  }
});

test("the global shell boots from the server cookie and mounts the language control", async () => {
  const [layout, provider, control, serverLocale, header, nav, footer, mobile] = await Promise.all([
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/locale-provider.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/language-control.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/server/request-locale.ts", import.meta.url), "utf8"),
    readFile(new URL("../components/site-header.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/nav-links.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/site-footer-view.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/mobile-demand-cta.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(layout, /getRequestLocale\(\)/u);
  assert.match(layout, /<LocaleProvider initialLocale=\{locale\}>/u);
  assert.match(layout, /<html lang=\{locale\}/u);
  assert.match(provider, /initialLocale/u);
  assert.match(provider, /window\.addEventListener\("storage"/u);
  assert.match(provider, /latestLocaleRef\.current/u);
  assert.doesNotMatch(provider, /dirtyFormRef|if \([^)]*dirty[^)]*\) return/u);
  assert.match(provider, /useTransition\(\)/u);
  assert.match(provider, /refreshInFlightRef\.current/u);
  assert.match(provider, /refreshQueuedRef\.current/u);
  assert.match(provider, /startRefreshTransition\(\(\) => router\.refresh\(\)\)/u);
  assert.match(provider, /if \(refreshPending \|\| !refreshInFlightRef\.current\) return/u);
  assert.match(provider, /try \{/u);
  assert.doesNotMatch(provider, /navigator\.language/u);
  assert.match(serverLocale, /await cookies\(\)/u);
  assert.match(serverLocale, /normalizeLocale/u);
  assert.match(control, /setLocale\(nextLocale\)/u);
  assert.match(control, /aria-haspopup="dialog"/u);
  assert.match(control, /language-market-panel/u);
  assert.match(control, /type: "currency"/u);
  assert.match(control, /算力交易统一使用 KAI 标准卡时；法币仅用于充值卡时/u);
  assert.match(control, /\{ code: "CNY", label: "人民币", enabled: true \}/u);
  assert.match(control, /\{ code: "USD", label: "美元", enabled: false \}/u);
  assert.doesNotMatch(control, /setCurrency\(|exchangeRate|convertCurrency/u);
  assert.match(header, /<LanguageControl \/>/);
  assert.match(header, /t\("buy"\)/);
  assert.match(nav, /t\(group\.label\)/);
  assert.match(footer, /t\("disclaimer"\)/);
  assert.match(mobile, /t\("request"\)/);
});

test("global language switching never rewrites React-owned DOM text", async () => {
  const sources = await Promise.all([
    readFile(new URL("../components/locale-provider.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/language-control.tsx", import.meta.url), "utf8"),
  ]);
  const implementation = sources.join("\n");
  assert.doesNotMatch(implementation, /MutationObserver|TreeWalker|textContent\s*=|innerHTML\s*=/u);
});

test("primary workspaces translate fixed UI at render time", async () => {
  const [home, buy, account, admin, login] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/buy-workspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/account-console-shell.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/admin-shell.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/account-login.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(home, /getRequestLocale/u);
  for (const source of [buy, account, admin, login]) assert.match(source, /useLocale/u);
  for (const source of [home, buy, account, admin, login]) {
    for (const locale of supportedLocales) assert.ok(source.includes(locale), `primary workspace is missing ${locale}`);
  }
});

test("member overview and card-hour purchase flow cover every locale without rewriting business records", async () => {
  const [memberPage, overview, cardHourPage, cardHours] = await Promise.all([
    readFile(new URL("../app/member/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/account-console-overview.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/member/card-hours/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/member-card-hour-assets.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(memberPage, /getRequestLocale/u);
  assert.match(cardHourPage, /getRequestLocale/u);
  assert.match(overview, /useLocale/u);
  assert.match(cardHours, /useLocale/u);
  for (const source of [memberPage, overview, cardHourPage, cardHours]) {
    for (const locale of supportedLocales) assert.ok(source.includes(locale), `member flow is missing ${locale}`);
  }
  assert.match(overview, /record\.resourceTitle/u);
  assert.match(overview, /record\.supplierName/u);
  assert.match(cardHours, /item\.name/u);
  assert.match(cardHours, /item\.description/u);
  assert.match(cardHours, /record\.channel \?\? copy\.historical/u);
  assert.doesNotMatch(overview, /error\?\.message|reason\.message/u);
  assert.doesNotMatch(cardHours, /error\?\.message|marketplaceErrorMessage/u);
});

test("public market surfaces localize fixed UI without rewriting quote data", async () => {
  const [marketPage, dashboard, liveBoard, priceBoard] = await Promise.all([
    readFile(new URL("../app/market/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/market-dashboard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/live-model-price-board.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/model-price-board.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(marketPage, /getRequestLocale/u);
  for (const source of [dashboard, liveBoard, priceBoard]) assert.match(source, /useLocale/u);
  for (const source of [marketPage, dashboard, liveBoard, priceBoard]) {
    for (const locale of supportedLocales) assert.ok(source.includes(locale), `public market is missing ${locale}`);
  }

  assert.match(dashboard, /activeSeries\.label/u);
  assert.match(dashboard, /activeSeries\.updatedAt/u);
  assert.match(priceBoard, /quote\.vendor/u);
  assert.match(priceBoard, /quote\.model/u);
  assert.match(priceBoard, /quote\.sourceName/u);
  assert.match(priceBoard, /quote\.originalCurrency/u);
  assert.doesNotMatch(liveBoard, /error\?\.message|reason\.message|payload\?\.error\?\.message/u);
  assert.doesNotMatch(priceBoard, /error\?\.message|reason\.message|payload\?\.error\?\.message/u);
  const nonEnglishFallback = /(?:"zh-TW"|ja|ko|fr|th|vi|id|ms): \{ \.\.\.EN/u;
  assert.doesNotMatch(dashboard, nonEnglishFallback);
  assert.doesNotMatch(priceBoard, nonEnglishFallback);
});

test("public guides localize at render time while preserving host commands and configuration keys", async () => {
  const [guides, hostAgent] = await Promise.all([
    readFile(new URL("../app/guides/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/guides/host-agent/page.tsx", import.meta.url), "utf8"),
  ]);
  for (const source of [guides, hostAgent]) {
    assert.match(source, /getRequestLocale/u);
    assert.match(source, /generateMetadata/u);
    assert.match(source, /localizeNode/u);
    for (const locale of supportedLocales) assert.ok(source.includes(locale), `public guide is missing ${locale}`);
    assert.doesNotMatch(source, /MutationObserver|TreeWalker|innerHTML\s*=|textContent\s*=/u);
  }
  for (const stableValue of [
    "nvidia-smi --query-gpu=uuid,name,memory.total --format=csv,noheader",
    "KAI_HOSTING_APPROVED_IMAGES",
    "KAI_HOST_GPU_UUID",
    "/etc/kai-host-actuator.env",
    "--pairing-file /var/lib/kai-host-agent/pairing.json",
  ]) assert.ok(hostAgent.includes(stableValue), `host guide changed ${stableValue}`);
  for (const nativeHeading of [
    "最初の GPU を借りる", "첫 GPU 대여", "Louer son premier GPU", "เช่า GPU เครื่องแรก",
    "Thuê GPU đầu tiên", "Sewa GPU pertama", "Sewa GPU pertama",
  ]) assert.ok(guides.includes(nativeHeading), `guide navigation is missing ${nativeHeading}`);
  for (const nativeHeading of [
    "パッケージを検証", "패키지를 검증", "Vérifiez le paquet", "ตรวจสอบแพ็กเกจ",
    "Xác minh gói", "Verifikasi paket", "Sahkan pakej",
  ]) assert.ok(hostAgent.includes(nativeHeading), `host guide is missing ${nativeHeading}`);
});

test("legacy member overview localizes fixed UI and keeps business records untouched", async () => {
  const [personal, cardHours, workspace] = await Promise.all([
    readFile(new URL("../components/personal-center-overview.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/card-hour-account-panel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/member-workspace.tsx", import.meta.url), "utf8"),
  ]);
  for (const source of [personal, cardHours, workspace]) {
    assert.match(source, /useLocale/u);
    for (const locale of supportedLocales) assert.ok(source.includes(locale), `legacy member UI is missing ${locale}`);
  }
  assert.match(personal, /item\.title/u);
  assert.match(personal, /item\.region/u);
  assert.match(workspace, /request\.title/u);
  assert.match(workspace, /request\.region/u);
  assert.match(workspace, /response\.unitPrice/u);
  assert.doesNotMatch(cardHours, /marketplaceErrorMessage/u);
  assert.doesNotMatch(workspace, /marketplaceErrorMessage/u);
});
