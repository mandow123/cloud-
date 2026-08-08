import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

const PUBLIC_BASELINE_RELEASE = "bb7fd3211fdff28a448af85f53e9f40839ffa843";
const DEVELOPMENT_BASELINE_RELEASE = "aa3394baf68c48be2352be71afcecc6356409359";

const baselineSha256 = Object.freeze({
  public: {
    "app/market/page.tsx": "cca6c78bacc8dac17dfb0f161b181d45312f2b528f0ee92ee4a80ff259a17202",
    "app/member/page.tsx": "97e6ce978cb5de39756c60b53007710acb4e7196a0a3d288452bee0796dac971",
    "app/partners/page.tsx": "5febf4f807871ea7df98ceecdd5608e983ef06e561e0e4f0711a1f10d1b58e8b",
  },
  development: {
    "app/market/page.tsx": "cca6c78bacc8dac17dfb0f161b181d45312f2b528f0ee92ee4a80ff259a17202",
    "app/member/page.tsx": "750abae102f9e2f44eb73bac73e57368c527c5af4e0dc42c3731d099906f2dd3",
    "app/partners/page.tsx": "40585f3f42bc64200dcf4e5f7314a5c8acbc892adb4e0dd8b75efbb8848bb38f",
  },
});

const approvedSlots = Object.freeze({
  "app/market/page.tsx": "market-standard-card-hour-v1",
  "app/member/page.tsx": "member-kai-hours-v1",
  "app/partners/page.tsx": "partners-supply-entry-v1",
});

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function committedSource(revision, path) {
  return execFileSync("git", ["show", `${revision}:${path}`], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
}

function withoutApprovedSlotSource(source, path) {
  let normalized = source
    .replace('import { KaiStandardSlot } from "@/components/kai-standard-slot";\n', "")
    .replace(/^[ \t]*<KaiStandardSlot slot="[^"]+" \/>\r?\n/gmu, "");
  if (path === "app/market/page.tsx") {
    normalized = normalized
      .replace(/^[ \t]*<>\r?\n/gmu, "")
      .replace(/^[ \t]*<\/>\r?\n/gmu, "")
      .replace(/(modelBoard=\{\r?\n)([\s\S]*?)(\r?\n      \})/u, (_match, opening, body, closing) => (
      opening + body.replace(/^  /gmu, "") + closing
      ));
  }
  return normalized;
}

async function renderWithSlots(pathname, enabled, cacheKey) {
  const previous = process.env.KAI_STANDARD_FRONTEND_SLOTS;
  try {
    if (enabled) process.env.KAI_STANDARD_FRONTEND_SLOTS = "1";
    else delete process.env.KAI_STANDARD_FRONTEND_SLOTS;
    const workerUrl = new URL("../dist/server/index.js", import.meta.url);
    workerUrl.searchParams.set("kai-standard-slots", cacheKey);
    const worker = (await import(workerUrl.href)).default;
    return await worker.fetch(
      new Request(`https://cloud.kai.com${pathname}`, {
        headers: { accept: "text/html", host: "cloud.kai.com" },
      }),
      { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
      { waitUntil() {}, passThroughOnException() {} },
    );
  } finally {
    if (previous === undefined) delete process.env.KAI_STANDARD_FRONTEND_SLOTS;
    else process.env.KAI_STANDARD_FRONTEND_SLOTS = previous;
  }
}

test("the public and development baselines are pinned separately and their known drift stays visible", () => {
  for (const path of Object.keys(approvedSlots)) {
    assert.equal(sha256(committedSource(PUBLIC_BASELINE_RELEASE, path)), baselineSha256.public[path], `${path} public baseline changed`);
    assert.equal(sha256(committedSource(DEVELOPMENT_BASELINE_RELEASE, path)), baselineSha256.development[path], `${path} development baseline changed`);
  }

  assert.equal(baselineSha256.public["app/market/page.tsx"], baselineSha256.development["app/market/page.tsx"]);
  assert.notEqual(baselineSha256.public["app/member/page.tsx"], baselineSha256.development["app/member/page.tsx"]);
  assert.notEqual(baselineSha256.public["app/partners/page.tsx"], baselineSha256.development["app/partners/page.tsx"]);
});

test("the three owned pages differ from the development baseline only by their approved slot insertion", () => {
  for (const [path, slot] of Object.entries(approvedSlots)) {
    const source = readFileSync(path, "utf8");
    assert.equal(source.match(new RegExp(`<KaiStandardSlot slot="${slot}" \\/>`, "gu"))?.length, 1, `${path} must insert ${slot} exactly once`);
    assert.equal((source.match(/<KaiStandardSlot slot=/gu) ?? []).length, 1, `${path} must contain only one slot node`);
    assert.equal(sha256(withoutApprovedSlotSource(source, path)), baselineSha256.development[path], `${path} changed outside its approved slot`);
  }
});

test("the slot feature fails closed and each enabled page server-renders exactly one approved link", async () => {
  const cases = [
    ["/market", "market-standard-card-hour-v1", "/market/card-hour", "查看 KAI 标准卡时"],
    ["/member", "member-kai-hours-v1", "/member/kai-hours", "查看我的 KAI 卡时"],
    ["/partners", "partners-supply-entry-v1", "/supply", "进入资源上架"],
  ];

  for (const [pathname, slot, href, label] of cases) {
    const disabled = await renderWithSlots(pathname, false, `disabled-${slot}-${Date.now()}`);
    assert.equal(disabled.status, 200, `${pathname} disabled render failed`);
    assert.doesNotMatch(await disabled.text(), /data-kai-slot=/u, `${pathname} must render no slot when disabled`);

    const enabled = await renderWithSlots(pathname, true, `enabled-${slot}-${Date.now()}`);
    assert.equal(enabled.status, 200, `${pathname} enabled render failed`);
    const html = await enabled.text();
    assert.equal((html.match(/data-kai-slot=/gu) ?? []).length, 1, `${pathname} rendered more than one slot`);
    assert.match(html, new RegExp(`data-kai-slot="${slot}"`, "u"));
    assert.match(html, new RegExp(`href="${href.replaceAll("/", "\\/")}"`, "u"));
    assert.match(html, new RegExp(`>${label}<\\/a>`, "u"));
  }
});

test("the server component recognizes only the explicit value 1 and returns one Link node", () => {
  const source = readFileSync("components/kai-standard-slot.tsx", "utf8");
  assert.match(source, /process\.env\[SLOT_FLAG\] === "1"/u);
  assert.match(source, /if \(!kaiStandardFrontendSlotsEnabled\(\)\) return null;/u);
  assert.equal((source.match(/<Link\b/gu) ?? []).length, 1);
  assert.equal((source.match(/data-kai-slot=/gu) ?? []).length, 1);
});

test("no frozen public surface or shared stylesheet is touched by the slot implementation", () => {
  const forbiddenImports = [
    "app/page.tsx",
    "components/nav-links.tsx",
    "components/site-header.tsx",
    "components/site-footer.tsx",
    "app/resources/page.tsx",
    "app/request/page.tsx",
    "app/methodology/page.tsx",
    "app/globals.css",
    "app/kai-cloud.css",
  ];
  for (const path of forbiddenImports) {
    assert.doesNotMatch(readFileSync(path, "utf8"), /KaiStandardSlot|data-kai-slot/u, `${path} must remain outside the slot surface`);
  }
});
