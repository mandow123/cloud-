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
    for (const key of ["language", "theme", "buy", "request", "compute", "hosting", "guides", "disclaimer"]) {
      assert.ok(translate(locale, key).trim().length > 0, `${locale}.${key} is empty`);
    }
  }
});

test("the global shell mounts the locale provider and language control", async () => {
  const [layout, header, nav, footer, mobile] = await Promise.all([
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/site-header.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/nav-links.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/site-footer-view.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/mobile-demand-cta.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(layout, /<LocaleProvider>/);
  assert.match(header, /<LanguageControl \/>/);
  assert.match(header, /t\("buy"\)/);
  assert.match(nav, /t\(group\.label\)/);
  assert.match(footer, /t\("disclaimer"\)/);
  assert.match(mobile, /t\("request"\)/);
});
