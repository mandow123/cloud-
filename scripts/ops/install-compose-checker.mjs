#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// Official Docker release assets, pinned by the release API's SHA-256 digest.
// The standalone Compose binary validates config without a Docker daemon.
const assets = {
  'linux-x64': ['linux-x86_64', 'dba9d98e1ba5bfe11d88c99b9bd32fc4a0624a30fafe68eea34d61a3e42fd372'],
  'darwin-arm64': ['darwin-aarch64', '8cd7eb5f95bacb536cc407111662e2c205d67d9abfea5dcb8400be8418db60d1'],
};
const asset = assets[`${process.platform}-${process.arch}`];
if (!asset) throw new Error('COMPOSE_CHECKER_PLATFORM_UNSUPPORTED');
const response = await fetch(`https://github.com/docker/compose/releases/download/v2.40.3/docker-compose-${asset[0]}`, { signal: AbortSignal.timeout(120000) });
if (!response.ok) throw new Error(`COMPOSE_CHECKER_DOWNLOAD_FAILED:${response.status}`);
const bytes = Buffer.from(await response.arrayBuffer());
if (createHash('sha256').update(bytes).digest('hex') !== asset[1]) throw new Error('COMPOSE_CHECKER_CHECKSUM_MISMATCH');
const directory = resolve('.market-cache/tools');
await mkdir(directory, { recursive: true });
await writeFile(resolve(directory, 'docker-compose'), bytes, { mode: 0o755 });
process.stdout.write('Verified Docker Compose v2.40.3 configuration checker installed.\n');
