import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const locales = ["zh-CN", "zh-TW", "ja", "ko", "fr", "th", "vi", "id", "ms"];

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function block(source, start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  assert.notEqual(from, -1, `missing ${start}`);
  assert.notEqual(to, -1, `missing ${end}`);
  return source.slice(from, to);
}

function localeLine(source, locale) {
  const marker = locale.includes("-") ? `  "${locale}":` : `  ${locale}:`;
  const line = source.split("\n").find((value) => value.startsWith(marker));
  assert.ok(line, `missing complete copy for ${locale}`);
  return line;
}

function stringValue(line, key) {
  const match = line.match(new RegExp(`(?:^|[,{]\\s*)${escapeRegExp(key)}:\\s*"([^"]+)"`));
  assert.ok(match, `missing ${key}`);
  return match[1];
}

function assertLocalizedCore(file, completionName, nextName, keys, englishName = "EN") {
  const source = readFileSync(new URL(`../components/${file}`, import.meta.url), "utf8");
  const completion = block(source, `const ${completionName}`, nextName.startsWith("function ") ? nextName : `const ${nextName}`);
  const englishLine = source.split("\n").find((line) => line.startsWith(`const ${englishName}:`));
  assert.ok(englishLine, `${file}: missing English baseline`);

  for (const locale of locales) {
    const line = localeLine(completion, locale);
    for (const key of keys) {
      const localized = stringValue(line, key);
      const english = stringValue(englishLine, key);
      assert.notEqual(localized, english, `${file}: ${locale}.${key} still falls back to English`);
    }
  }
}

test("account overview core copy is localized for every non-English locale", () => {
  assertLocalizedCore(
    "account-console-overview.tsx",
    "ACCOUNT_CORE_COPY",
    "COPY",
    ["balanceNote", "snapshot", "pendingNote", "ledger", "quote", "compareNote", "managedNote", "loadSafe"],
  );
});

test("card-hour asset core copy is localized for every non-English locale", () => {
  assertLocalizedCore(
    "member-card-hour-assets.tsx",
    "CARD_HOUR_CORE_COPY",
    "COPY",
    ["paymentTruth", "boundary", "amountHelp", "pilot", "channelPending", "paymentNotice", "noHistory", "loadSafe", "invalidSelection", "createFailed", "unsafeCheckout"],
  );
});

test("payment return core copy is localized for every non-English locale", () => {
  assertLocalizedCore(
    "card-hour-topup-return.tsx",
    "TOPUP_RETURN_COPY",
    "function money",
    ["creditedTitle", "closedTitle", "reviewTitle", "waitingTitle", "creditedDetail", "closedDetail", "reviewDetail", "waitingDetail", "checking", "reviewNotice", "pendingNotice", "recheck", "appeal", "back", "appealAt"],
    "RETURN_EN",
  );
});
