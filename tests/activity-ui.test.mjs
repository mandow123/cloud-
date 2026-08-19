import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const home = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const page = await readFile(new URL("../app/activity/page.tsx", import.meta.url), "utf8");
const detailPage = await readFile(new URL("../app/activity/[slug]/page.tsx", import.meta.url), "utf8");
const catalog = await readFile(new URL("../lib/activity-catalog.ts", import.meta.url), "utf8");
const hub = await readFile(new URL("../components/activity-hub.tsx", import.meta.url), "utf8");
const styles = await readFile(new URL("../components/activity-hub.module.css", import.meta.url), "utf8");
const detail = await readFile(new URL("../components/activity-detail.tsx", import.meta.url), "utf8");
const detailStyles = await readFile(new URL("../components/activity-detail.module.css", import.meta.url), "utf8");
const nav = await readFile(new URL("../components/nav-links.tsx", import.meta.url), "utf8");
const community = await readFile(new URL("../components/activity-community.tsx", import.meta.url), "utf8");
const communityStyles = await readFile(new URL("../components/activity-community.module.css", import.meta.url), "utf8");
const admin = await readFile(new URL("../components/activity-admin.tsx", import.meta.url), "utf8");
const adminStyles = await readFile(new URL("../app/admin/admin.css", import.meta.url), "utf8");

test("the root route is the activity plaza while the legacy activity alias and market remain reachable", () => {
  assert.match(home, /import \{ ActivityHub \}/u);
  assert.match(home, /<ActivityHub \/>/u);
  assert.match(page, /<ActivityHub \/>/);
  assert.match(nav, /href: "\/", label: "创作活动"/u);
  assert.match(nav, /href: "\/market", label: "行情中心"/u);
  assert.match(nav, /item\.href === "\/"[\s\S]*pathname\.startsWith\("\/activity"\)/u);
  assert.match(hub, /<Link href="\/market">算力行情<\/Link>/u);
});

test("activity plaza is catalog-driven and exposes exactly six distinct challenge cards", () => {
  const ids = [...catalog.matchAll(/\bid:\s*"(act_[^"]+)"/gu)].map((match) => match[1]);
  const slugs = [...catalog.matchAll(/\bslug:\s*"([^"]+)"/gu)].map((match) => match[1]);
  assert.equal(ids.length, 6);
  assert.equal(slugs.length, 6);
  assert.equal(new Set(ids).size, 6);
  assert.equal(new Set(slugs).size, 6);
  assert.equal((catalog.match(/\bsteps:\s*\[/gu) ?? []).length, 6);
  assert.equal((catalog.match(/\brequirements:\s*\[/gu) ?? []).length, 6);
  assert.equal((catalog.match(/\breward:\s*"/gu) ?? []).length, 6);
  assert.match(hub, /activityCatalog\.filter/u);
  assert.match(hub, /visible\.map/u);
  assert.match(hub, /href=\{`\/activity\/\$\{item\.slug\}`\}/u);
  assert.match(hub, /筛选活动/u);
  assert.match(hub, /搜索活动/u);
  assert.match(hub, /<ActivityCommunity \/>/);
  assert.match(community, /\/api\/activity\/submissions/);
});

test("every catalog card has a shareable detail route with route-specific metadata", () => {
  assert.match(detailPage, /generateStaticParams/u);
  assert.match(detailPage, /activityCatalog\.map/u);
  assert.match(detailPage, /generateMetadata/u);
  assert.match(detailPage, /activityBySlug/u);
  assert.match(detailPage, /notFound\(\)/u);
  assert.match(detailPage, /<ActivityDetail activity=\{activity\} \/>/u);
  assert.match(detail, /返回活动广场/u);
  assert.match(detail, /activity\.steps\.map/u);
  assert.match(detail, /activity\.prizes\.map/u);
  assert.match(detail, /activity\.requirements\.map/u);
  assert.equal((catalog.match(/\bbrief:\s*"/gu) ?? []).length, 6);
  assert.match(detailPage, /openGraph:[\s\S]*images: \[\]/u);
  assert.match(detailPage, /twitter:[\s\S]*images: \[\]/u);
});

test("activity layout includes responsive desktop and mobile treatments", () => {
  assert.match(styles, /\.grid\{[^}]*grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/u);
  assert.match(styles, /@media\(max-width:1180px\)[\s\S]*grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/u);
  assert.match(styles, /@media\(max-width:760px\)[\s\S]*grid-template-columns:1fr/u);
  assert.match(styles, /\.mobileNav/u);
  assert.match(styles, /prefers-reduced-motion/u);
  assert.match(detailStyles, /@media\(max-width:760px\)/u);
});

test("activity filters and public cards are accessible without replacing account-backed actions", () => {
  assert.match(hub, /aria-live="polite"/u);
  assert.match(hub, /aria-pressed=\{status === item\}/u);
  assert.match(hub, /aria-label="活动快捷导航"/u);
  assert.match(hub, /aria-label="移动端活动导航"/u);
  assert.match(community, /snapshot\.viewer/u);
  assert.match(community, /登录后投稿与投票/u);
  assert.match(community, /rewardBalance/u);
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
