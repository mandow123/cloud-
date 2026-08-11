#!/bin/sh
set -eu

if [ "$(id -u)" -ne 0 ]; then
  echo "KAI Host Agent installer must run as root." >&2
  exit 1
fi

AGENT_SOURCE_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

if [ ! -r /etc/os-release ] || ! grep -q '^ID=ubuntu$' /etc/os-release; then
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

if ! command -v nvidia-smi >/dev/null 2>&1; then
  echo "nvidia-smi is required before installing KAI Host Agent." >&2
  exit 1
fi

if ! command -v systemctl >/dev/null 2>&1; then
  echo "A systemd-based Ubuntu host is required." >&2
  exit 1
fi

if ! id kai-host-agent >/dev/null 2>&1; then
  useradd --system --home-dir /var/lib/kai-host-agent --shell /usr/sbin/nologin kai-host-agent
fi

install -d -o root -g root -m 0755 /opt/kai-host-agent /opt/kai-host-agent/src
install -o root -g root -m 0644 "$AGENT_SOURCE_DIR/package.json" /opt/kai-host-agent/package.json
install -o root -g root -m 0644 "$AGENT_SOURCE_DIR/src/protocol.mjs" /opt/kai-host-agent/src/protocol.mjs
install -o root -g root -m 0644 "$AGENT_SOURCE_DIR/src/state.mjs" /opt/kai-host-agent/src/state.mjs
install -o root -g root -m 0644 "$AGENT_SOURCE_DIR/src/inventory.mjs" /opt/kai-host-agent/src/inventory.mjs
install -o root -g root -m 0644 "$AGENT_SOURCE_DIR/src/client.mjs" /opt/kai-host-agent/src/client.mjs
install -o root -g root -m 0755 "$AGENT_SOURCE_DIR/src/cli.mjs" /opt/kai-host-agent/src/cli.mjs
ln -sfn /opt/kai-host-agent/src/cli.mjs /usr/local/bin/kai-host-agent

install -d -o kai-host-agent -g kai-host-agent -m 0700 /var/lib/kai-host-agent
install -o root -g root -m 0644 "$AGENT_SOURCE_DIR/kai-host-agent.service" /etc/systemd/system/kai-host-agent.service
systemctl daemon-reload

echo "KAI Host Agent installed but not started."
echo "Run the pairing command as kai-host-agent, then enable the service."
