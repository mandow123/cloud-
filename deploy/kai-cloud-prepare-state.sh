#!/bin/sh
set -eu

KAI_STATE_ROOT="${KAI_STATE_ROOT:-/opt/kai-cloud-3051}"
KAI_RUNTIME_UID=1000
KAI_RUNTIME_GID=1000

if ! printf '%s\n' "$KAI_STATE_ROOT" | grep -Eq '^/opt/kai-cloud(-[a-z0-9][a-z0-9._-]*)?$'; then
  printf '%s\n' "KAI_STATE_ROOT must be a dedicated normalized /opt/kai-cloud[-suffix] path" >&2
  exit 64
fi
if [ "$(id -u)" -ne 0 ]; then
  printf '%s\n' "state preparation must run as root" >&2
  exit 77
fi
if [ -L "$KAI_STATE_ROOT" ]; then
  printf '%s\n' "$KAI_STATE_ROOT must not be a symbolic link" >&2
  exit 73
fi

install -d -o "$KAI_RUNTIME_UID" -g "$KAI_RUNTIME_GID" -m 0750 "$KAI_STATE_ROOT"
for directory in db market uploads backups; do
  target="$KAI_STATE_ROOT/$directory"
  if [ -L "$target" ]; then
    printf '%s\n' "$target must not be a symbolic link" >&2
    exit 73
  fi
  install -d -o "$KAI_RUNTIME_UID" -g "$KAI_RUNTIME_GID" -m 0750 "$target"
done

printf '%s\n' "Prepared $KAI_STATE_ROOT/{db,market,uploads,backups} as $KAI_RUNTIME_UID:$KAI_RUNTIME_GID mode 0750"
