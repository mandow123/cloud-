import assert from "node:assert/strict";
import test from "node:test";
import { inspectActivityImage } from "../lib/server/activity-upload.ts";

function png(width, height, trailing = 0) {
  const bytes = new Uint8Array(45 + trailing);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(bytes.buffer).setUint32(16, width); new DataView(bytes.buffer).setUint32(20, height);
  bytes.set([0x49, 0x45, 0x4e, 0x44], 37);
  return bytes;
}

test("upload inspection accepts bounded images and rejects polyglots or decompression bombs", () => {
  assert.deepEqual(inspectActivityImage(png(1200, 800), "image/png"), { width: 1200, height: 800 });
  assert.equal(inspectActivityImage(png(1200, 800, 4), "image/png"), null);
  assert.equal(inspectActivityImage(png(16_000, 16_000), "image/png"), null);
  assert.equal(inspectActivityImage(png(1200, 800), "image/avif"), null);
});

test("upload inspection validates JPEG framing and dimensions", () => {
  const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xc0, 0, 7, 8, 0, 100, 0, 200, 0xff, 0xd9]);
  assert.deepEqual(inspectActivityImage(jpeg, "image/jpeg"), { width: 200, height: 100 });
  assert.equal(inspectActivityImage(jpeg.slice(0, -2), "image/jpeg"), null);
});
