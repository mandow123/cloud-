import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const page = await readFile(new URL("../app/activity/page.tsx", import.meta.url), "utf8");
const hub = await readFile(new URL("../components/activity-hub.tsx", import.meta.url), "utf8");
const styles = await readFile(new URL("../components/activity-hub.module.css", import.meta.url), "utf8");
const nav = await readFile(new URL("../components/nav-links.tsx", import.meta.url), "utf8");
const community = await readFile(new URL("../components/activity-community.tsx", import.meta.url), "utf8");

test("activity route is public and discoverable from primary navigation", () => {
  assert.match(page, /<ActivityHub \/>/);
  assert.match(nav, /href: "\/activity", label: "创作活动"/);
});

test("activity hub offers original participation mechanics", () => {
  assert.match(hub, /先选一个创作阵营/);
  assert.match(hub, /领取创作任务/);
  assert.match(hub, /积攒能量/);
  assert.match(hub, /setFilter/);
  assert.match(hub, /toggleJoin/);
  assert.match(hub, /<ActivityCommunity \/>/);
  assert.match(community, /\/api\/activity\/submissions/);
});

test("activity layout includes responsive desktop and mobile treatments", () => {
  assert.match(styles, /grid-template-columns:repeat\(2,1fr\)/);
  assert.match(styles, /@media\(max-width:650px\)/);
  assert.match(styles, /prefers-reduced-motion|@keyframes float/);
});
