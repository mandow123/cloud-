import { access, copyFile, cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const clientDir = join(projectRoot, "dist", "client");
const standaloneClientDir = join(projectRoot, "dist", "standalone", "dist", "client");
const standaloneLauncher = join(projectRoot, "dist", "standalone", "server.js");
const standaloneVinextDir = join(projectRoot, "dist", "standalone", "node_modules", "vinext");
const standaloneVinextPackagePath = join(standaloneVinextDir, "package.json");
const vulnerableVendoredImageSizePath = join(
  standaloneVinextDir,
  "dist",
  "deps",
  ".pnpm",
  "image-size@2.0.2",
);
const buildOnlyMetadataModule = join(
  standaloneVinextDir,
  "dist",
  "server",
  "metadata-route-build-data.js",
);
const buildOnlyWorkerImageModule = join(
  standaloneVinextDir,
  "dist",
  "plugins",
  "worker-image-imports.js",
);

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

// Vinext 1.0.0-beta.8 no longer declares image-size as a runtime dependency,
// but its published tarball still carries the vulnerable build-only parser in
// dist/deps. The Node production server never needs metadata/image-import build
// plugins. Remove the parser from the standalone artifact and replace the two
// build-only entry points with fail-closed stubs so an accidental runtime import
// cannot silently reintroduce it.
const standaloneVinextPackage = JSON.parse(await readFile(standaloneVinextPackagePath, "utf8"));
if (standaloneVinextPackage.version !== "1.0.0-beta.8") {
  throw new Error("Standalone Vinext version is not the audited 1.0.0-beta.8 release.");
}
await access(vulnerableVendoredImageSizePath);
await rm(vulnerableVendoredImageSizePath, { recursive: true, force: false });
await writeFile(
  buildOnlyMetadataModule,
  [
    'const unavailable = () => { throw new Error("VINEXT_BUILD_ONLY_METADATA_UNAVAILABLE_IN_STANDALONE"); };',
    "export { unavailable as createMetadataRouteEntriesSource, unavailable as createMetadataRouteEntryData, unavailable as createMetadataRouteEntrySource };",
    "",
  ].join("\n"),
  "utf8",
);
await writeFile(
  buildOnlyWorkerImageModule,
  [
    'export function createWorkerImageImportsPlugin() { throw new Error("VINEXT_BUILD_ONLY_IMAGE_IMPORTS_UNAVAILABLE_IN_STANDALONE"); }',
    "",
  ].join("\n"),
  "utf8",
);
if (standaloneVinextPackage.devDependencies) {
  delete standaloneVinextPackage.devDependencies["image-size"];
}
await writeFile(
  standaloneVinextPackagePath,
  `${JSON.stringify(standaloneVinextPackage, null, 2)}\n`,
  "utf8",
);

console.log(
  JSON.stringify({
    status: "ok",
    copiedEntries: entries.length,
    target: "dist/standalone/dist/client",
  }),
);
