import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = join(import.meta.dirname, "..");
const ownedFiles = [
  "app/market/card-hour/page.tsx",
  "app/member/kai-hours/page.tsx",
  "components/kai-standard-market.tsx",
  "components/kai-standard-account.tsx",
  "components/kai-standard-equivalent-line.tsx",
  "components/kai-standard-state.tsx",
  "components/kai-standard-pages.module.css",
];
const source = Object.fromEntries(ownedFiles.map((file) => [file, readFileSync(join(root, file), "utf8")]));
const pageText = Object.entries(source).filter(([file]) => !file.endsWith(".css")).map(([, value]) => value).join("\n");

test("isolated pages read only their approved service endpoints", () => {
  assert.match(source["components/kai-standard-market.tsx"], /fetch\("\/api\/v1\/standardization\/quotes"/u);
  assert.match(source["components/kai-standard-account.tsx"], /fetch\("\/api\/v1\/member\/kai-hours"/u);
  assert.match(pageText, /credentials:\s*"same-origin"/u);
  assert.match(pageText, /cache:\s*"no-store"/u);
});

test("pages expose loading, empty, error, unavailable and stale or expired states", () => {
  for (const text of ["正在读取", "当前没有", "暂时无法读取", "UNAVAILABLE", "STALE", "已经过期"]) assert.ok(pageText.includes(text), `missing state copy: ${text}`);
  assert.match(pageText, /重新读取/u);
});

test("native capacity, KAI equivalents and CNY settlement remain distinct in user copy", () => {
  for (const text of ["原生容量", "KAI 市场等值", "人民币结算", "市场等值", "订单锁定与交付依据", "不作“随时变现”承诺"]) assert.ok(pageText.includes(text), `missing boundary copy: ${text}`);
  assert.doesNotMatch(pageText, /钱包|充值|提现|保本/u);
});

test("new pages use only their local CSS module and contain no decorative effects", () => {
  for (const file of ownedFiles.filter((item) => item.endsWith(".tsx"))) {
    assert.doesNotMatch(source[file], /globals\.css|kai-cloud\.css|admin\.css/u, `${file} imported a shared stylesheet`);
  }
  const css = source["components/kai-standard-pages.module.css"];
  assert.doesNotMatch(css, /gradient|backdrop-filter|box-shadow/u);
  assert.match(css, /var\(--(?:canvas|surface|ink|text|accent|border)/u);
  assert.match(css, /@media \(max-width:/u);
});

test("wide data tables are keyboard focusable at enlarged zoom", () => {
  assert.match(source["components/kai-standard-market.tsx"], /className=\{styles\.tableWrap\}\s+tabIndex=\{0\}\s+aria-label=/u);
  assert.match(source["components/kai-standard-account.tsx"], /className=\{styles\.tableWrap\}\s+tabIndex=\{0\}\s+aria-label=/u);
  assert.match(source["components/kai-standard-pages.module.css"], /\.tableWrap:focus-visible/u);
});
