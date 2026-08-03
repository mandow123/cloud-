#!/bin/sh
set -eu

if [ "$#" -eq 0 ]; then
  printf '%s\n' "Production container requires a server command" >&2
  exit 64
fi

# The same immutable image runs two tightly scoped maintenance commands from
# hardened systemd units. Every other command, including the default server,
# remains behind the production environment gate.
case "${1:-}:${2:-}" in
  node:scripts/model-market/cli.mjs|node:scripts/ops/backup-marketplace.mjs)
    exec "$@"
    ;;
esac

node /app/scripts/ops/validate-production-env.mjs --check-filesystem
exec "$@"
