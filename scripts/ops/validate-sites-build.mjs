import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");

async function read(relativePath) {
  return readFile(resolve(root, relativePath), "utf8");
}

async function exists(relativePath) {
  await access(resolve(root, relativePath));
}

const [hostingSource, viteSource, workerSource, migrationSource] = await Promise.all([
  read(".openai/hosting.json"),
  read("vite.config.ts"),
  read("worker/index.ts"),
  read("drizzle/0022_activity_platform.sql"),
]);

const hosting = JSON.parse(hostingSource);
assert.match(hosting.project_id ?? "", /^appgprj_[a-zA-Z0-9]+$/, "Sites project_id is missing or invalid");
assert.equal(hosting.d1, "DB", "Sites D1 binding must be DB");
assert.equal(hosting.r2, "UPLOADS", "Sites R2 binding must be UPLOADS");

assert.match(viteSource, /binding:\s*d1/);
assert.match(viteSource, /binding:\s*r2/);
assert.match(workerSource, /\bDB:\s*unknown/);
assert.match(workerSource, /\bUPLOADS:\s*unknown/);
assert.match(migrationSource, /CREATE TABLE IF NOT EXISTS activity_submissions/);
assert.match(migrationSource, /CREATE TABLE IF NOT EXISTS activity_votes/);
assert.match(migrationSource, /CREATE TABLE IF NOT EXISTS activity_rewards/);

await Promise.all([
  exists("dist/server/index.js"),
  exists("dist/client"),
  exists("dist/standalone/server.js"),
]);

console.log("Sites deployment contract is valid: project, DB/R2 bindings, migration, and build artifacts are present.");
