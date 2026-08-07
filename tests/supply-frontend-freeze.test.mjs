import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const FROZEN_FRONTEND_SHA256 = Object.freeze({
  "app/market/page.tsx": "cca6c78bacc8dac17dfb0f161b181d45312f2b528f0ee92ee4a80ff259a17202",
  "components/market-dashboard.tsx": "cf1670f7be6a5fb4a2a91c850be82116afde203556183c80d9fbef8f171efc01",
  "app/resources/page.tsx": "7e446378067b7600810f743495ab414edcef17ab153263f92c37496c93a96aae",
  "components/resource-explorer.tsx": "64c0baa5cd6ea51ce1f64cc9debbda57498d8f1fc3059c6a5265a4bbe68f8bd7",
  "app/member/page.tsx": "750abae102f9e2f44eb73bac73e57368c527c5af4e0dc42c3731d099906f2dd3",
  "components/member-workspace.tsx": "6edbc2bde57ac1568c6c36326d6772e7fa0ccb968a18e54729df6e66cf6bcbd9",
  "app/request/page.tsx": "31c01f8f49b653bc02ddfbb39c2635eebd5ce1bb9b1c70bf8f9dd258c085af00",
  "components/request-workbench.tsx": "e6b9ed373caa179a934371a2efb79c9a94fa366ac53bdc52ddba09d0af7b6b80",
  "app/methodology/page.tsx": "c2c2aa9feea6d4b76cc4bfc82bd01af4baa223108bd350a3b4b964044193c1f6",
  "app/globals.css": "119aa290e58389d5a0f02adadfccc6e7ec50571b17edec30a4c9c59169b2024f",
  "app/kai-cloud.css": "9e55101fed6578adfccc83ce5552d0e2135af0aca35f12834b729d7b71d4cfcf",
});

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function sha256Text(source) {
  return createHash("sha256").update(source).digest("hex");
}

test("legacy frontend remains frozen outside the approved supply and formal-account changes", () => {
  const changed = [];
  for (const [path, expectedDigest] of Object.entries(FROZEN_FRONTEND_SHA256)) {
    const actualDigest = sha256(path);
    if (actualDigest !== expectedDigest) changed.push({ path, expectedDigest, actualDigest });
  }
  assert.deepEqual(changed, [], "legacy frontend files changed outside the approved supply-pilot surface");
});

test("the approved /supply page exists", () => {
  assert.ok(existsSync("app/supply/page.tsx"), "planned /supply route is missing");
});

test("the approved homepage change only redirects the existing 登记出售 action to /supply", () => {
  const source = readFileSync("app/page.tsx", "utf8");
  const approvedLine = '  { code: "03", title: "登记出售", copy: "供应方登记可供容量并响应市场需求", href: "/supply" },';
  const originalLine = '  { code: "03", title: "登记出售", copy: "供应方登记可供容量并响应市场需求", href: "/member?role=supplier#supply-register" },';
  assert.equal(source.split(approvedLine).length - 1, 1, "homepage must contain exactly one approved supply redirect");
  assert.equal(
    sha256Text(source.replace(approvedLine, originalLine)),
    "04dea41ed1c17d11aaf4e7fd550456395a29cff0f9b1ab803d82379463951181",
    "app/page.tsx changed beyond the approved href-only redirect",
  );
});

test("the approved global navigation change links to /supply", () => {
  assert.match(readFileSync("components/nav-links.tsx", "utf8"), /href:\s*["']\/supply["']/u);
});

test("the approved supplier-cooperation change links to /supply", () => {
  assert.match(readFileSync("app/partners/page.tsx", "utf8"), /href=["']\/supply["']/u);
});

test("the supply page does not make balance, principal-guarantee, withdrawal, or live-stock claims", () => {
  assert.ok(existsSync("app/supply/page.tsx"), "planned /supply route is missing");
  const source = readFileSync("app/supply/page.tsx", "utf8");
  assert.doesNotMatch(source, /保本|保收益|收益率|现金取出|提现|卡时余额|实时库存/u);
});

test("the isolated buyer order page exposes LIVE payment and SSH key actions only behind readiness gates", () => {
  const source = readFileSync("components/supply-order-workspace.tsx", "utf8");
  assert.match(source, /createAlipayPaymentIntent/u);
  assert.match(source, /submitSshPublicKey/u);
  assert.match(source, /disabled=\{!alipayReady/u);
  assert.match(source, /disabled=\{!sshReady/u);
  assert.match(source, /返回页不会直接把订单改成支付成功/u);
  assert.match(source, /私钥不得上传/u);
});
