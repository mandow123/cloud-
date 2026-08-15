import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("components/account-required.tsx", "utf8");

test("account gate times out visibly instead of spinning forever or redirecting on network failure", () => {
  assert.match(source, /window\.setTimeout\(\(\) => controller\.abort\(\), 12_000\)/u);
  assert.match(source, /if \(response\.status === 401 \|\| response\.status === 403\) return \{ authenticated: false \}/u);
  assert.match(source, /if \(!cancelled\) setLoadError\(true\)/u);
  assert.match(source, /暂时无法确认登录状态/u);
  assert.match(source, /重新检查登录状态/u);

  const catchBlock = source.slice(source.indexOf(".catch(() =>"), source.indexOf(".finally(() =>"));
  assert.doesNotMatch(catchBlock, /redirectToLogin|authenticated: false/u);
});
