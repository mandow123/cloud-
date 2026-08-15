#!/bin/sh
set -eu

if [ "$(id -u)" -ne 0 ]; then
  echo "KAI Host Agent installer must run as root." >&2
  exit 1
fi

AGENT_SOURCE_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
LOCK_DIR=/run/kai-host-agent-install.lock
STAGING_RELEASE=
SERVICES_STOPPED=0
AGENT_WAS_ACTIVE=0
AGENT_WAS_ENABLED=0
ACTUATOR_WAS_ACTIVE=0
ACTUATOR_WAS_ENABLED=0
PREVIOUS_RELEASE=
CURRENT_SWITCHED=0
ACTUATOR_UNIT_EXISTED=0
AGENT_UNIT_EXISTED=0
CLI_EXISTED=0

if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  echo "Another KAI Host Agent installation is already running." >&2
  exit 1
fi

cleanup() {
  STATUS=$?
  trap - EXIT
  if [ -n "$STAGING_RELEASE" ] && [ -d "$STAGING_RELEASE" ]; then
    rm -rf -- "$STAGING_RELEASE"
  fi
  if [ "$STATUS" -ne 0 ] && [ "$SERVICES_STOPPED" -eq 1 ]; then
    systemctl stop kai-host-agent.service >/dev/null 2>&1 || true
    systemctl stop kai-host-actuator.service >/dev/null 2>&1 || true
    if [ "$CURRENT_SWITCHED" -eq 1 ]; then
      if [ -n "$PREVIOUS_RELEASE" ] && [ -d "$PREVIOUS_RELEASE" ]; then
        ln -s "$PREVIOUS_RELEASE" "/opt/kai-host-agent/.rollback-$$" || true
        mv -Tf "/opt/kai-host-agent/.rollback-$$" /opt/kai-host-agent/current || true
      else
        rm -f -- /opt/kai-host-agent/current
      fi
    fi
    if [ "$ACTUATOR_UNIT_EXISTED" -eq 1 ]; then
      cp -a -- "$LOCK_DIR/kai-host-actuator.service" /etc/systemd/system/kai-host-actuator.service || true
    else
      rm -f -- /etc/systemd/system/kai-host-actuator.service
    fi
    if [ "$AGENT_UNIT_EXISTED" -eq 1 ]; then
      cp -a -- "$LOCK_DIR/kai-host-agent.service" /etc/systemd/system/kai-host-agent.service || true
    else
      rm -f -- /etc/systemd/system/kai-host-agent.service
    fi
    rm -f -- /usr/local/bin/kai-host-agent
    if [ "$CLI_EXISTED" -eq 1 ]; then
      cp -a -- "$LOCK_DIR/kai-host-agent-cli" /usr/local/bin/kai-host-agent || true
    fi
    systemctl daemon-reload >/dev/null 2>&1 || true
    if [ "$ACTUATOR_WAS_ENABLED" -eq 1 ]; then systemctl enable kai-host-actuator.service >/dev/null 2>&1 || true; else systemctl disable kai-host-actuator.service >/dev/null 2>&1 || true; fi
    if [ "$ACTUATOR_WAS_ACTIVE" -eq 1 ]; then systemctl start kai-host-actuator.service >/dev/null 2>&1 || true; fi
    if [ "$AGENT_WAS_ENABLED" -eq 1 ]; then systemctl enable kai-host-agent.service >/dev/null 2>&1 || true; else systemctl disable kai-host-agent.service >/dev/null 2>&1 || true; fi
    if [ "$AGENT_WAS_ACTIVE" -eq 1 ]; then
      systemctl start kai-host-agent.service >/dev/null 2>&1 || true
    fi
  fi
  rm -f -- "$LOCK_DIR/kai-host-actuator.service" "$LOCK_DIR/kai-host-agent.service" "$LOCK_DIR/kai-host-agent-cli"
  rmdir "$LOCK_DIR" >/dev/null 2>&1 || true
  exit "$STATUS"
}
trap cleanup EXIT

if [ ! -r /etc/os-release ] || ! grep -Eq '^ID=(ubuntu|"ubuntu")$' /etc/os-release; then
  echo "KAI Host Agent version 1 requires Ubuntu." >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 24.15 or newer is required." >&2
  exit 1
fi

NODE_MAJOR=$(node -p 'Number(process.versions.node.split(".")[0])')
NODE_MINOR=$(node -p 'Number(process.versions.node.split(".")[1])')
if [ "$NODE_MAJOR" -lt 24 ] || { [ "$NODE_MAJOR" -eq 24 ] && [ "$NODE_MINOR" -lt 15 ]; }; then
  echo "Node.js 24.15 or newer is required." >&2
  exit 1
fi

NODE_BINARY=$(command -v node)
case "$NODE_BINARY" in
  /usr/bin/node|/usr/local/bin/node) ;;
  *)
    echo "Node.js must be installed system-wide at /usr/bin/node or /usr/local/bin/node for the systemd services." >&2
    exit 1
    ;;
esac

RELEASE_FACTS=$($NODE_BINARY --input-type=module - "$AGENT_SOURCE_DIR" <<'NODE'
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.argv[2];
const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const manifest = JSON.parse(readFileSync(join(root, "release-manifest.json"), "utf8"));
const requiredFiles = [
  "README.md",
  "install.sh",
  "kai-host-actuator.env.example",
  "kai-host-actuator.service",
  "kai-host-agent.service",
  "package.json",
  "src/actuator-client.mjs",
  "src/actuator-server.mjs",
  "src/actuator.mjs",
  "src/cli.mjs",
  "src/client.mjs",
  "src/inventory.mjs",
  "src/preflight.mjs",
  "src/doctor.mjs",
  "src/protocol.mjs",
  "src/state.mjs",
  "src/verify.mjs",
];
if (manifest.schemaVersion !== "kai-host-agent-release/1" || manifest.version !== packageJson.version
  || !/^\d+\.\d+\.\d+$/.test(packageJson.version) || !/^[a-f0-9]{40}$/.test(manifest.revision)
  || !Array.isArray(manifest.files) || manifest.files.length < 1) throw new Error("Host Agent release manifest is invalid.");
const manifestPaths = manifest.files.map((file) => file?.path);
const sortedManifestPaths = [...manifestPaths].sort();
const sortedRequiredFiles = [...requiredFiles].sort();
if (manifestPaths.length !== requiredFiles.length || new Set(manifestPaths).size !== requiredFiles.length
  || sortedManifestPaths.some((path, index) => path !== sortedRequiredFiles[index])) {
  throw new Error("Host Agent release manifest is incomplete or contains duplicate/unexpected files.");
}
for (const file of manifest.files) {
  if (!file || typeof file.path !== "string" || !/^[A-Za-z0-9._/-]{1,100}$/.test(file.path) || file.path.includes("..")
    || !Number.isSafeInteger(file.bytes) || file.bytes < 1 || !/^[a-f0-9]{64}$/.test(file.sha256)) throw new Error("Host Agent release file entry is invalid.");
  const content = readFileSync(join(root, file.path));
  if (content.byteLength !== file.bytes || createHash("sha256").update(content).digest("hex") !== file.sha256) throw new Error(`Host Agent release file failed verification: ${file.path}`);
}
process.stdout.write(`${packageJson.version} ${manifest.revision}`);
NODE
)
set -- $RELEASE_FACTS
if [ "$#" -ne 2 ]; then
  echo "KAI Host Agent release metadata is invalid." >&2
  exit 1
fi
AGENT_VERSION=$1
RELEASE_REVISION=$2

if ! command -v nvidia-smi >/dev/null 2>&1; then
  echo "nvidia-smi is required before installing KAI Host Agent." >&2
  exit 1
fi

if ! command -v systemctl >/dev/null 2>&1; then
  echo "A systemd-based Ubuntu host is required." >&2
  exit 1
fi

if [ ! -x /usr/bin/docker ] || [ ! -S /run/docker.sock ]; then
  echo "Docker Engine and its local Unix socket are required before installing KAI Host Agent." >&2
  exit 1
fi

if ! id kai-host-agent >/dev/null 2>&1; then
  useradd --system --home-dir /var/lib/kai-host-agent --shell /usr/sbin/nologin kai-host-agent
fi

install -d -o root -g root -m 0755 /opt/kai-host-agent /opt/kai-host-agent/releases
STAGING_RELEASE="/opt/kai-host-agent/releases/.install-${AGENT_VERSION}-${RELEASE_REVISION}-$$"
FINAL_RELEASE="/opt/kai-host-agent/releases/${AGENT_VERSION}-${RELEASE_REVISION}-$(date -u +%Y%m%dT%H%M%SZ)-$$"
install -d -o root -g root -m 0755 "$STAGING_RELEASE" "$STAGING_RELEASE/src"
install -o root -g root -m 0644 "$AGENT_SOURCE_DIR/package.json" "$STAGING_RELEASE/package.json"
install -o root -g root -m 0644 "$AGENT_SOURCE_DIR/release-manifest.json" "$STAGING_RELEASE/release-manifest.json"
install -o root -g root -m 0644 "$AGENT_SOURCE_DIR/src/protocol.mjs" "$STAGING_RELEASE/src/protocol.mjs"
install -o root -g root -m 0644 "$AGENT_SOURCE_DIR/src/state.mjs" "$STAGING_RELEASE/src/state.mjs"
install -o root -g root -m 0644 "$AGENT_SOURCE_DIR/src/inventory.mjs" "$STAGING_RELEASE/src/inventory.mjs"
install -o root -g root -m 0755 "$AGENT_SOURCE_DIR/src/preflight.mjs" "$STAGING_RELEASE/src/preflight.mjs"
install -o root -g root -m 0644 "$AGENT_SOURCE_DIR/src/doctor.mjs" "$STAGING_RELEASE/src/doctor.mjs"
install -o root -g root -m 0644 "$AGENT_SOURCE_DIR/src/client.mjs" "$STAGING_RELEASE/src/client.mjs"
install -o root -g root -m 0644 "$AGENT_SOURCE_DIR/src/verify.mjs" "$STAGING_RELEASE/src/verify.mjs"
install -o root -g root -m 0644 "$AGENT_SOURCE_DIR/src/actuator.mjs" "$STAGING_RELEASE/src/actuator.mjs"
install -o root -g root -m 0644 "$AGENT_SOURCE_DIR/src/actuator-client.mjs" "$STAGING_RELEASE/src/actuator-client.mjs"
install -o root -g root -m 0755 "$AGENT_SOURCE_DIR/src/actuator-server.mjs" "$STAGING_RELEASE/src/actuator-server.mjs"
install -o root -g root -m 0755 "$AGENT_SOURCE_DIR/src/cli.mjs" "$STAGING_RELEASE/src/cli.mjs"

install -d -o kai-host-agent -g kai-host-agent -m 0700 /var/lib/kai-host-agent
if [ ! -e /etc/kai-host-actuator.env ]; then
  install -o root -g root -m 0600 "$AGENT_SOURCE_DIR/kai-host-actuator.env.example" /etc/kai-host-actuator.env
fi

if systemctl is-active --quiet kai-host-agent.service 2>/dev/null; then AGENT_WAS_ACTIVE=1; fi
if systemctl is-enabled --quiet kai-host-agent.service 2>/dev/null; then AGENT_WAS_ENABLED=1; fi
if systemctl is-active --quiet kai-host-actuator.service 2>/dev/null; then ACTUATOR_WAS_ACTIVE=1; fi
if systemctl is-enabled --quiet kai-host-actuator.service 2>/dev/null; then ACTUATOR_WAS_ENABLED=1; fi
if [ -L /opt/kai-host-agent/current ]; then PREVIOUS_RELEASE=$(readlink -f /opt/kai-host-agent/current); fi
if [ -e /etc/systemd/system/kai-host-actuator.service ]; then
  cp -a -- /etc/systemd/system/kai-host-actuator.service "$LOCK_DIR/kai-host-actuator.service"
  ACTUATOR_UNIT_EXISTED=1
fi
if [ -e /etc/systemd/system/kai-host-agent.service ]; then
  cp -a -- /etc/systemd/system/kai-host-agent.service "$LOCK_DIR/kai-host-agent.service"
  AGENT_UNIT_EXISTED=1
fi
if [ -e /usr/local/bin/kai-host-agent ] || [ -L /usr/local/bin/kai-host-agent ]; then
  cp -a -- /usr/local/bin/kai-host-agent "$LOCK_DIR/kai-host-agent-cli"
  CLI_EXISTED=1
fi
systemctl stop kai-host-agent.service >/dev/null 2>&1 || true
systemctl stop kai-host-actuator.service >/dev/null 2>&1 || true
SERVICES_STOPPED=1

mv "$STAGING_RELEASE" "$FINAL_RELEASE"
STAGING_RELEASE=
ln -s "$FINAL_RELEASE" "/opt/kai-host-agent/.current-$$"
mv -Tf "/opt/kai-host-agent/.current-$$" /opt/kai-host-agent/current
CURRENT_SWITCHED=1
ln -sfn /opt/kai-host-agent/current/src/cli.mjs /usr/local/bin/kai-host-agent
install -o root -g root -m 0644 "$AGENT_SOURCE_DIR/kai-host-actuator.service" /etc/systemd/system/kai-host-actuator.service
install -o root -g root -m 0644 "$AGENT_SOURCE_DIR/kai-host-agent.service" /etc/systemd/system/kai-host-agent.service
sed -i "s|^ExecStart=.*src/actuator-server.mjs$|ExecStart=$NODE_BINARY /opt/kai-host-agent/current/src/actuator-server.mjs|" /etc/systemd/system/kai-host-actuator.service
systemctl daemon-reload
systemctl enable --now kai-host-actuator.service
if [ "$AGENT_WAS_ENABLED" -eq 1 ]; then
  systemctl enable kai-host-agent.service
else
  systemctl disable kai-host-agent.service >/dev/null 2>&1 || true
fi
if [ "$AGENT_WAS_ACTIVE" -eq 1 ]; then
  systemctl start kai-host-agent.service
fi
SERVICES_STOPPED=0
CURRENT_SWITCHED=0

echo "KAI Host Agent $AGENT_VERSION installed from release $RELEASE_REVISION."
if [ "$AGENT_WAS_ACTIVE" -eq 1 ]; then
  echo "The previously running Host Agent service has been restored."
elif [ "$AGENT_WAS_ENABLED" -eq 1 ]; then
  echo "The previously stopped Host Agent service remains enabled and stopped."
else
  echo "KAI Host Agent installed but not started."
fi
echo "Configure immutable images in /etc/kai-host-actuator.env before accepting rental commands."
echo "Run the pairing command as kai-host-agent, then enable the service."
