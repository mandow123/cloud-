import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("local preview login is development-only and keeps the return path server-sanitized", () => {
  const page = readFileSync("app/login/page.tsx", "utf8");
  const component = readFileSync("components/local-preview-login.tsx", "utf8");
  assert.match(page, /process\.env\.KAI_ADMIN_LOCAL_AUTH === "1"/u);
  assert.match(page, /process\.env\.KAI_LOCAL_PREVIEW_UI === "1"/u);
  assert.match(page, /safeReturnTo\(params\.returnTo\)/u);
  assert.match(component, /credentials: "same-origin"/u);
  assert.match(component, /window\.location\.assign\(returnTo\)/u);
  assert.match(component, /buyer\.localhost/u);
  assert.match(component, /supplier\.localhost/u);
  assert.match(component, /window\.location\.hostname/u);
  assert.doesNotMatch(component, /root\.localhost|finance\.localhost|localStorage|sessionStorage|document\.cookie|LOCAL_SECRET|local-auth-secret/u);
});
