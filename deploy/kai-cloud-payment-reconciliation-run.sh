#!/bin/sh
set -eu

: "${KAI_PAYMENT_RECONCILIATION_TOKEN:?KAI_PAYMENT_RECONCILIATION_TOKEN is required}"
KAI_APP_PORT="${KAI_APP_PORT:-3051}"
CURL_BIN="${KAI_CURL_BIN:-/usr/bin/curl}"

if ! printf '%s\n' "$KAI_APP_PORT" | grep -Eq '^[0-9]{2,5}$' || [ "$KAI_APP_PORT" -lt 1024 ] || [ "$KAI_APP_PORT" -gt 65535 ]; then
  printf '%s\n' "KAI_APP_PORT must be an unprivileged TCP port" >&2
  exit 64
fi
if [ "${#KAI_PAYMENT_RECONCILIATION_TOKEN}" -lt 32 ] || [ "${#KAI_PAYMENT_RECONCILIATION_TOKEN}" -gt 256 ]; then
  printf '%s\n' "KAI_PAYMENT_RECONCILIATION_TOKEN length is invalid" >&2
  exit 64
fi
if [ ! -x "$CURL_BIN" ]; then
  printf '%s\n' "curl executable is unavailable: $CURL_BIN" >&2
  exit 69
fi

printf '%s\n' \
  'silent' \
  'show-error' \
  'fail-with-body' \
  'request = "POST"' \
  'max-time = 50' \
  'connect-timeout = 5' \
  'header = "Content-Length: 0"' \
  "header = \"Authorization: Bearer $KAI_PAYMENT_RECONCILIATION_TOKEN\"" \
  "url = \"http://127.0.0.1:$KAI_APP_PORT/api/internal/payments/qixiang-pay/reconcile\"" | "$CURL_BIN" --config - >/dev/null
