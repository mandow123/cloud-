import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("the supplied KAI mark and custom Cloud lettering form one vector wordmark", async () => {
  const [brand, asset] = await Promise.all([
    read("components/kai-cloud-brand.tsx"),
    read("public/kai-cloud-wordmark.svg"),
  ]);
  assert.match(asset, /viewBox="0 0 304 64"/u);
  assert.match(asset, /#177777/u);
  assert.match(asset, /<title>KAI Cloud<\/title>/u);
  assert.match(asset, /purpose-drawn geometric wordmark/u);
  assert.match(asset, /<path/gmu);
  assert.doesNotMatch(asset, /<text\b/u);
  assert.match(brand, /src="\/kai-cloud-wordmark\.svg"/u);
  assert.match(brand, /aria-label="KAI Cloud"/u);
  assert.match(brand, /role="img"/u);
  assert.doesNotMatch(brand, />Cloud<\/span>/u);
});

test("public header, footer, and account console use the same KAI Cloud brand", async () => {
  const [header, footer, console] = await Promise.all([
    read("components/site-header.tsx"),
    read("components/site-footer.tsx"),
    read("components/account-console-shell.tsx"),
  ]);
  assert.match(header, /<KaiCloudBrand \/>/u);
  assert.match(footer, /<KaiCloudBrand size="footer" \/>/u);
  assert.match(console, /<KaiCloudBrand size="console" \/>/u);
  assert.doesNotMatch(header, /wordmark-kai|wordmark-cloud/u);
  assert.doesNotMatch(footer, />KAI Cloud<\/p>/u);
  assert.doesNotMatch(console, /<span>KAI Cloud<\/span>/u);
});
