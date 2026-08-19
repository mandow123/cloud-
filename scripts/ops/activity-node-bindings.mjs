import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import { DatabaseSync } from "node:sqlite";

class NodeD1Statement {
  constructor(database, sql) {
    this.database = database;
    this.sql = sql;
    this.values = [];
  }

  bind(...values) {
    this.values = values;
    return this;
  }

  async run() {
    const result = this.database.prepare(this.sql).run(...this.values);
    return { meta: { changes: Number(result.changes) } };
  }

  async all() {
    return { results: this.database.prepare(this.sql).all(...this.values) };
  }

  async first() {
    return this.database.prepare(this.sql).get(...this.values) ?? null;
  }
}

class NodeD1Database {
  constructor(path) {
    this.database = new DatabaseSync(path);
    this.database.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
  }

  prepare(sql) {
    return new NodeD1Statement(this.database, sql);
  }

  async batch(statements) {
    if (!Array.isArray(statements) || statements.some((statement) => !(statement instanceof NodeD1Statement) || statement.database !== this.database)) {
      throw new TypeError("ACTIVITY_DB_BATCH_INVALID");
    }
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      this.database.exec("COMMIT");
      return results;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }
}

class NodeR2Bucket {
  constructor(root) {
    this.root = resolve(root);
  }

  pathFor(key) {
    if (
      typeof key !== "string"
      || !key
      || key.includes("\0")
      || key.includes("\\")
      || key.startsWith("/")
      || /^[A-Za-z]:[\\/]/.test(key)
      || key.split("/").some((part) => !part || part === ".." || part === ".")
    ) {
      throw new Error("ACTIVITY_UPLOAD_KEY_INVALID");
    }
    const target = resolve(this.root, ...key.split("/"));
    if (target !== this.root && !target.startsWith(`${this.root}${sep}`)) throw new Error("ACTIVITY_UPLOAD_KEY_INVALID");
    return target;
  }

  async put(key, value) {
    const target = this.pathFor(key);
    const bytes = value instanceof ArrayBuffer
      ? Buffer.from(value)
      : Buffer.from(await new Response(value).arrayBuffer());
    await mkdir(resolve(target, ".."), { recursive: true });
    const temporary = `${target}.${randomUUID()}.partial`;
    try {
      await writeFile(temporary, bytes, { flag: "wx", mode: 0o640 });
      await rename(temporary, target);
    } catch (error) {
      try {
        await unlink(temporary);
      } catch (cleanupError) {
        if (cleanupError?.code !== "ENOENT") error.cleanupError = cleanupError.message;
      }
      throw error;
    }
  }

  async get(key) {
    const target = this.pathFor(key);
    try {
      const bytes = await new Response(Readable.toWeb(createReadStream(target))).arrayBuffer();
      const buffer = Buffer.from(bytes);
      return {
        body: Readable.toWeb(Readable.from(buffer)),
        httpEtag: `\"${createHash("sha256").update(buffer).digest("hex")}\"`,
        size: buffer.byteLength,
      };
    } catch (error) {
      if (error?.code === "ENOENT") return null;
      throw error;
    }
  }

  async delete(key) {
    try {
      await unlink(this.pathFor(key));
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
}

export async function installActivityNodeBindings() {
  const databaseDirectory = resolve(process.env.KAI_DB_DIR ?? join(process.cwd(), ".market-cache", "marketplace"));
  const uploadDirectory = resolve(process.env.KAI_ACTIVITY_UPLOAD_DIR ?? join(databaseDirectory, "activity-uploads"));
  const databasePath = resolve(process.env.KAI_ACTIVITY_DB_PATH ?? join(databaseDirectory, "activity.sqlite"));
  await Promise.all([mkdir(databaseDirectory, { recursive: true }), mkdir(dirname(databasePath), { recursive: true }), mkdir(uploadDirectory, { recursive: true })]);
  const bindings = {
    DB: new NodeD1Database(databasePath),
    UPLOADS: new NodeR2Bucket(uploadDirectory),
  };
  globalThis.__KAI_ACTIVITY_ENV__ = bindings;
  return bindings;
}
