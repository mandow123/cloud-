#!/bin/sh
set -eu

: "${KAI_IMAGE:?KAI_IMAGE is required}"
: "${KAI_RELEASE_SHA:?KAI_RELEASE_SHA is required}"
KAI_STATE_ROOT="${KAI_STATE_ROOT:-/opt/kai-cloud-3050}"
KAI_UPDATE_CONTAINER_PREFIX="${KAI_UPDATE_CONTAINER_PREFIX:-kai-cloud-market-update-3050}"
KAI_UPDATE_CONTAINER="${KAI_UPDATE_CONTAINER_PREFIX}-$$"
DOCKER_BIN="${KAI_DOCKER_BIN:-/usr/bin/docker}"

if ! printf '%s\n' "$KAI_IMAGE" | grep -Eq '@sha256:[0-9a-fA-F]{64}$'; then
  printf '%s\n' "KAI_IMAGE must be an immutable image digest (repository@sha256:...)" >&2
  exit 64
fi
if ! printf '%s\n' "$KAI_RELEASE_SHA" | grep -Eq '^([0-9a-fA-F]{40}|[0-9a-fA-F]{64})$'; then
  printf '%s\n' "KAI_RELEASE_SHA must be a full 40- or 64-character Git object ID" >&2
  exit 64
fi
case "$KAI_STATE_ROOT" in
  /*) ;;
  *) printf '%s\n' "KAI_STATE_ROOT must be absolute" >&2; exit 64 ;;
esac
if [ "$KAI_STATE_ROOT" = "/" ] || [ ! -d "$KAI_STATE_ROOT/market" ]; then
  printf '%s\n' "KAI_STATE_ROOT/market must exist below a non-root state directory" >&2
  exit 72
fi
if [ ! -x "$DOCKER_BIN" ]; then
  printf '%s\n' "Docker executable is unavailable: $DOCKER_BIN" >&2
  exit 69
fi

cleanup() {
  "$DOCKER_BIN" rm -f "$KAI_UPDATE_CONTAINER" >/dev/null 2>&1 || true
}
trap cleanup EXIT HUP INT TERM

"$DOCKER_BIN" run --rm \
  --name "$KAI_UPDATE_CONTAINER" \
  --init \
  --user 1000:1000 \
  --read-only \
  --tmpfs /tmp:rw,noexec,nosuid,size=64m \
  --cap-drop ALL \
  --security-opt no-new-privileges \
  --pids-limit 128 \
  --memory 256m \
  --memory-swap 256m \
  --cpus 0.50 \
  --stop-timeout 15 \
  --log-driver json-file \
  --log-opt max-size=10m \
  --log-opt max-file=3 \
  --label "org.opencontainers.image.revision=$KAI_RELEASE_SHA" \
  --env KAI_MARKET_DATA_DIR=/app/market \
  --env KAI_MARKET_PENDING_PATH=/app/market/model-market.pending.json \
  --env KAI_MARKET_SNAPSHOT_PATH=/app/market/model-market.snapshot.json \
  --env KAI_MARKET_REGISTRY_PATH=/app/market-registry/model-market-registry.mjs \
  --mount "type=bind,src=$KAI_STATE_ROOT/market,dst=/app/market" \
  "$KAI_IMAGE" \
  node scripts/model-market/cli.mjs update

trap - EXIT HUP INT TERM
