#!/bin/sh
set -eu

: "${KAI_IMAGE:?KAI_IMAGE is required}"
: "${KAI_RELEASE_SHA:?KAI_RELEASE_SHA is required}"
KAI_STATE_ROOT="${KAI_STATE_ROOT:-/opt/kai-cloud-3051}"
KAI_BACKUP_CONTAINER_PREFIX="${KAI_BACKUP_CONTAINER_PREFIX:-kai-cloud-backup-3051}"
KAI_BACKUP_CONTAINER="${KAI_BACKUP_CONTAINER_PREFIX}-$$"
DOCKER_BIN="${KAI_DOCKER_BIN:-/usr/bin/docker}"
KAI_BACKUP_RETENTION_HOURLY="${KAI_BACKUP_RETENTION_HOURLY:-48}"
KAI_BACKUP_RETENTION_DAILY="${KAI_BACKUP_RETENTION_DAILY:-30}"
KAI_BACKUP_RETENTION_MONTHLY="${KAI_BACKUP_RETENTION_MONTHLY:-0}"
KAI_BACKUP_RETENTION_MAX_AGE_DAYS="${KAI_BACKUP_RETENTION_MAX_AGE_DAYS:-30}"

if ! printf '%s\n' "$KAI_IMAGE" | grep -Eq '^[a-z0-9]+([._-][a-z0-9]+)*(:[0-9]+)?(/[a-z0-9]+([._-][a-z0-9]+)*)*@sha256:[0-9a-f]{64}$'; then
  printf '%s\n' "KAI_IMAGE must be a full lowercase repository@sha256:<64 lowercase hexadecimal characters> reference" >&2
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
if [ "$KAI_STATE_ROOT" = "/" ]; then
  printf '%s\n' "KAI_STATE_ROOT cannot be /" >&2
  exit 64
fi
for directory in db market uploads backups; do
  if [ ! -d "$KAI_STATE_ROOT/$directory" ]; then
    printf '%s\n' "$KAI_STATE_ROOT/$directory must exist" >&2
    exit 72
  fi
done
if [ ! -x "$DOCKER_BIN" ]; then
  printf '%s\n' "Docker executable is unavailable: $DOCKER_BIN" >&2
  exit 69
fi

cleanup() {
  "$DOCKER_BIN" rm -f "$KAI_BACKUP_CONTAINER" >/dev/null 2>&1 || true
}
trap cleanup EXIT HUP INT TERM

"$DOCKER_BIN" run --rm \
  --name "$KAI_BACKUP_CONTAINER" \
  --init \
  --network none \
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
  --env KAI_DB_DIR=/app/db \
  --env KAI_ACTIVITY_DB_PATH=/app/db/activity.sqlite \
  --env KAI_ACTIVITY_UPLOAD_DIR=/app/uploads \
  --env KAI_MARKET_DATA_DIR=/app/market \
  --env KAI_BACKUP_DIR=/app/backups \
  --env "KAI_RELEASE_SHA=$KAI_RELEASE_SHA" \
  --env "KAI_BACKUP_RETENTION_HOURLY=$KAI_BACKUP_RETENTION_HOURLY" \
  --env "KAI_BACKUP_RETENTION_DAILY=$KAI_BACKUP_RETENTION_DAILY" \
  --env "KAI_BACKUP_RETENTION_MONTHLY=$KAI_BACKUP_RETENTION_MONTHLY" \
  --env "KAI_BACKUP_RETENTION_MAX_AGE_DAYS=$KAI_BACKUP_RETENTION_MAX_AGE_DAYS" \
  --mount "type=bind,src=$KAI_STATE_ROOT/db,dst=/app/db" \
  --mount "type=bind,src=$KAI_STATE_ROOT/market,dst=/app/market,readonly" \
  --mount "type=bind,src=$KAI_STATE_ROOT/uploads,dst=/app/uploads,readonly" \
  --mount "type=bind,src=$KAI_STATE_ROOT/backups,dst=/app/backups" \
  "$KAI_IMAGE" \
  node scripts/ops/backup-marketplace.mjs create

trap - EXIT HUP INT TERM
