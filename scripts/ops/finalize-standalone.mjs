import { access, copyFile, cp, mkdir, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const clientDir = join(projectRoot, "dist", "client");
const standaloneClientDir = join(projectRoot, "dist", "standalone", "dist", "client");
const standaloneLauncher = join(projectRoot, "dist", "standalone", "server.js");

await access(clientDir);
await mkdir(standaloneClientDir, { recursive: true });

const entries = await readdir(clientDir);
await Promise.all(
  entries.map((entry) =>
    cp(join(clientDir, entry), join(standaloneClientDir, entry), {
      recursive: true,
      force: true,
    }),
  ),
);

const requiredAssets = [
  "assets/fonts/dm-sans/dm-sans-151a53ae.woff2",
  "assets/fonts/work-sans/work-sans-d745e173.woff2",
  "assets/fonts/noto-sans-sc/noto-sans-sc-89709021.woff2",
  "og.png",
];

await Promise.all(requiredAssets.map((asset) => access(join(standaloneClientDir, asset))));
await copyFile(join(projectRoot, "scripts", "ops", "standalone-server.mjs"), standaloneLauncher);

console.log(
  JSON.stringify({
    status: "ok",
    copiedEntries: entries.length,
    target: "dist/standalone/dist/client",
  }),
);
