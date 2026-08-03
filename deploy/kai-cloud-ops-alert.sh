#!/bin/sh
set -eu

FAILED_UNIT="${1:-unknown-unit}"
MESSAGE="KAI Cloud operation failed: $FAILED_UNIT on $(hostname) at $(date -u +%Y-%m-%dT%H:%M:%SZ)"
logger --tag kai-cloud-ops -- "$MESSAGE"

# Operators may install an executable hook at this fixed path. It receives the
# failed systemd unit as its only argument; secrets remain outside this repo.
if [ -x /usr/local/lib/kai-cloud/notify-failure ]; then
  exec /usr/local/lib/kai-cloud/notify-failure "$FAILED_UNIT"
fi

printf '%s\n' "$MESSAGE"
