import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const login = readFileSync(new URL("../components/account-login.tsx", import.meta.url), "utf8");

test("public login entry points only to the rebuilt KAI Identity service", () => {
  assert.match(login, /https:\/\/auth\.kai\.com\//u);
  assert.match(login, /https:\/\/auth\.kai\.com\/sign-up/u);
  assert.match(login, /由 auth\.kai\.com 安全完成/u);
  assert.match(login, /使用 KAI Identity 登录 \/ 注册/u);
  assert.doesNotMatch(login, /account\.kai\.com/u);
});
