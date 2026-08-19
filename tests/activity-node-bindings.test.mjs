import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";

const execFileAsync = promisify(execFile);
const projectRoot = resolve(import.meta.dirname, "..");
const bindingsUrl = pathToFileURL(resolve(projectRoot, "scripts/ops/activity-node-bindings.mjs")).href;

async function withTemporaryState(run) {
  const root = await mkdtemp(join(tmpdir(), "kai-activity-bindings-"));
  try {
    return await run({
      root,
      databasePath: join(root, "database", "nested", "activity.sqlite"),
      uploadDirectory: join(root, "uploads"),
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function runBindingProcess(paths, source) {
  const { stdout } = await execFileAsync(process.execPath, ["--input-type=module", "--eval", source], {
    cwd: projectRoot,
    env: {
      ...process.env,
      KAI_DB_DIR: join(paths.root, "default-database"),
      KAI_ACTIVITY_DB_PATH: paths.databasePath,
      KAI_ACTIVITY_UPLOAD_DIR: paths.uploadDirectory,
      KAI_ACTIVITY_BINDINGS_URL: bindingsUrl,
    },
    maxBuffer: 1024 * 1024,
    windowsHide: true,
  });
  return stdout.trim() ? JSON.parse(stdout) : null;
}

test("Node D1 batch is atomic and creates an explicitly configured database parent", async () => {
  await withTemporaryState(async (paths) => {
    const result = await runBindingProcess(paths, `
      const { installActivityNodeBindings } = await import(process.env.KAI_ACTIVITY_BINDINGS_URL);
      const { DB } = await installActivityNodeBindings();
      await DB.prepare("CREATE TABLE atomic_items(id INTEGER PRIMARY KEY, value TEXT NOT NULL)").run();
      await DB.prepare("INSERT INTO atomic_items(id,value) VALUES(?,?)").bind(1, "baseline").run();
      let rejected = false;
      try {
        await DB.batch([
          DB.prepare("INSERT INTO atomic_items(id,value) VALUES(?,?)").bind(2, "must-roll-back"),
          DB.prepare("INSERT INTO atomic_items(id,value) VALUES(?,?)").bind(1, "duplicate"),
        ]);
      } catch {
        rejected = true;
      }
      const { results } = await DB.prepare("SELECT id,value FROM atomic_items ORDER BY id").all();
      process.stdout.write(JSON.stringify({ rejected, results }));
    `);
    assert.equal(result.rejected, true);
    assert.deepEqual(result.results, [{ id: 1, value: "baseline" }]);
  });
});

test("Node R2 put/get/delete preserves bytes and rejects portable path traversal", async () => {
  await withTemporaryState(async (paths) => {
    const result = await runBindingProcess(paths, `
      const { installActivityNodeBindings } = await import(process.env.KAI_ACTIVITY_BINDINGS_URL);
      const { UPLOADS } = await installActivityNodeBindings();
      const key = "activity/submission/asset.png";
      const first = new TextEncoder().encode("first payload");
      await UPLOADS.put(key, first.buffer);
      const stored = await UPLOADS.get(key);
      const firstText = await new Response(stored.body).text();
      await UPLOADS.put(key, new Blob(["replacement payload"]));
      const replaced = await UPLOADS.get(key);
      const replacementText = await new Response(replaced.body).text();
      const invalidKeys = ["", "../escape", "a/../../escape", "/absolute", "C:/escape", "a\\\\..\\\\escape", "a//b", "a/./b"];
      const rejected = [];
      for (const invalidKey of invalidKeys) {
        try {
          await UPLOADS.put(invalidKey, first.buffer);
        } catch (error) {
          if (error.message === "ACTIVITY_UPLOAD_KEY_INVALID") rejected.push(invalidKey);
        }
      }
      await UPLOADS.delete(key);
      const missing = await UPLOADS.get(key);
      process.stdout.write(JSON.stringify({
        firstText,
        firstSize: stored.size,
        etag: stored.httpEtag,
        replacementText,
        replacementSize: replaced.size,
        rejected,
        invalidKeys,
        missing,
      }));
    `);
    assert.equal(result.firstText, "first payload");
    assert.equal(result.firstSize, Buffer.byteLength("first payload"));
    assert.match(result.etag, /^"[0-9a-f]{64}"$/);
    assert.equal(result.replacementText, "replacement payload");
    assert.equal(result.replacementSize, Buffer.byteLength("replacement payload"));
    assert.deepEqual(result.rejected, result.invalidKeys);
    assert.equal(result.missing, null);
  });
});

test("activity SQLite and uploaded objects survive standalone process restarts", async () => {
  await withTemporaryState(async (paths) => {
    await runBindingProcess(paths, `
      const { installActivityNodeBindings } = await import(process.env.KAI_ACTIVITY_BINDINGS_URL);
      const { DB, UPLOADS } = await installActivityNodeBindings();
      await DB.prepare("CREATE TABLE restart_items(id TEXT PRIMARY KEY, value TEXT NOT NULL)").run();
      await DB.prepare("INSERT INTO restart_items(id,value) VALUES(?,?)").bind("persisted", "after restart").run();
      await UPLOADS.put("activity/restart/object.bin", new TextEncoder().encode("persistent object").buffer);
    `);

    const restarted = await runBindingProcess(paths, `
      const { installActivityNodeBindings } = await import(process.env.KAI_ACTIVITY_BINDINGS_URL);
      const { DB, UPLOADS } = await installActivityNodeBindings();
      const row = await DB.prepare("SELECT id,value FROM restart_items WHERE id=?").bind("persisted").first();
      const object = await UPLOADS.get("activity/restart/object.bin");
      const body = await new Response(object.body).text();
      process.stdout.write(JSON.stringify({ row, body, size: object.size }));
    `);
    assert.deepEqual(restarted.row, { id: "persisted", value: "after restart" });
    assert.equal(restarted.body, "persistent object");
    assert.equal(restarted.size, Buffer.byteLength("persistent object"));
  });
});

test("standalone image and Compose keep activity state on dedicated writable mounts", async () => {
  const [compose, dockerfile, launcher, finalize] = await Promise.all([
    readFile(resolve(projectRoot, "deploy/compose.production.yml"), "utf8"),
    readFile(resolve(projectRoot, "Dockerfile"), "utf8"),
    readFile(resolve(projectRoot, "scripts/ops/standalone-server.mjs"), "utf8"),
    readFile(resolve(projectRoot, "scripts/ops/finalize-standalone.mjs"), "utf8"),
  ]);

  assert.match(compose, /KAI_DB_DIR: \/app\/db/);
  assert.match(compose, /KAI_ACTIVITY_UPLOAD_DIR: \/app\/uploads/);
  assert.match(compose, /source: "\$\{KAI_STATE_ROOT:-\/opt\/kai-cloud-3051\}\/db"\s+target: \/app\/db/);
  assert.match(compose, /source: "\$\{KAI_STATE_ROOT:-\/opt\/kai-cloud-3051\}\/uploads"\s+target: \/app\/uploads/);
  const appService = compose.split("\n  market-update:", 1)[0];
  assert.doesNotMatch(appService, /target: \/app\/(?:db|uploads)\s+read_only: true/);
  assert.match(dockerfile, /COPY --from=build --chown=node:node \/app\/scripts\/ops \.\/scripts\/ops/);
  assert.match(dockerfile, /USER node/);
  assert.ok(launcher.indexOf("await installActivityNodeBindings()") < launcher.indexOf("await startProdServer"));
  assert.match(finalize, /activity-node-bindings\.mjs/);
  assert.equal(dirname(resolve(projectRoot, "dist/standalone/server.js")), resolve(projectRoot, "dist/standalone"));
});
