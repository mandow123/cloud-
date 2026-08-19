import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const page = await readFile(new URL("../app/activity/page.tsx", import.meta.url), "utf8");
const hub = await readFile(new URL("../components/activity-hub.tsx", import.meta.url), "utf8");
const styles = await readFile(new URL("../components/activity-hub.module.css", import.meta.url), "utf8");
const nav = await readFile(new URL("../components/nav-links.tsx", import.meta.url), "utf8");
const community = await readFile(new URL("../components/activity-community.tsx", import.meta.url), "utf8");
const communityStyles = await readFile(new URL("../components/activity-community.module.css", import.meta.url), "utf8");
const admin = await readFile(new URL("../components/activity-admin.tsx", import.meta.url), "utf8");
const adminStyles = await readFile(new URL("../app/admin/admin.css", import.meta.url), "utf8");

test("activity route is public and discoverable from primary navigation", () => {
  assert.match(page, /<ActivityHub \/>/);
  assert.match(nav, /href: "\/activity", label: "创作活动"/);
});

test("activity hub offers original participation mechanics", () => {
  assert.match(hub, /先选一个创作阵营/);
  assert.match(hub, /加入任务清单/);
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

test("activity choices make browser-only and account-backed state explicit", () => {
  assert.match(hub, /kai-activity-squad/);
  assert.match(hub, /kai-activity-joined/);
  assert.match(hub, /保存在当前浏览器/);
  assert.match(hub, /投稿、投票与奖励会安全保存到登录账户/);
  assert.match(hub, /aria-live="polite"/);
  assert.match(hub, /aria-pressed=\{joined\.includes/);
});

test("submission and voting UI validates uploads and exposes resilient feedback", () => {
  assert.match(community, /MAX_UPLOAD_BYTES = 10 \* 1024 \* 1024/);
  assert.match(community, /ALLOWED_UPLOAD_TYPES/);
  assert.match(community, /URL\.createObjectURL/);
  assert.match(community, /仅本机预览/);
  assert.match(community, /activityFetch/);
  assert.match(community, /请求超时/);
  assert.match(community, /withVote/);
  assert.match(community, /aria-busy=/);
  assert.match(community, /重新加载/);
  assert.match(community, /正在确认账户/);
  assert.match(communityStyles, /focus-visible/);
});

test("activity moderation UI supports filtering, localized state, and destructive confirmation", () => {
  assert.match(admin, /搜索投稿/);
  assert.match(admin, /全部状态/);
  assert.match(admin, /待审核/);
  assert.match(admin, /admin-confirm/);
  assert.match(admin, /我已核对作品与账户/);
  assert.match(admin, /aria-selected/);
  assert.match(admin, /activity-admin-preview/);
  assert.match(admin, /adminErrorMessage/);
  assert.match(adminStyles, /activity-admin-filters/);
  assert.match(adminStyles, /@media \(max-width: 560px\)/);
});
