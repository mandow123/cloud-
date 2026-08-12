#!/bin/sh
set -eu

AUTHORIZED_KEYS=/home/kai/.ssh/authorized_keys
HOST_KEY=/tmp/kai_host_ed25519_key

if [ ! -r "$AUTHORIZED_KEYS" ] || [ ! -s "$AUTHORIZED_KEYS" ]; then
  echo "KAI workload requires a mounted, non-empty authorized_keys file." >&2
  exit 1
fi

if ! nvidia-smi --query-gpu=uuid,name,memory.total --format=csv,noheader >/tmp/kai_gpu_inventory.txt 2>/dev/null; then
  echo "KAI workload requires one NVIDIA GPU exposed by the NVIDIA Container Toolkit." >&2
  exit 1
fi

gpu_count=$(wc -l </tmp/kai_gpu_inventory.txt | tr -d ' ')
if [ "$gpu_count" -ne 1 ]; then
  echo "KAI workload version 1 requires exactly one GPU." >&2
  exit 1
fi

ssh-keygen -q -t ed25519 -N '' -f "$HOST_KEY"
chmod 0600 "$HOST_KEY"

exec /usr/sbin/sshd -D -e -f /etc/ssh/sshd_config -h "$HOST_KEY"
