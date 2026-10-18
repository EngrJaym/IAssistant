#!/bin/sh
set -e

PORT="${PORT:-80}"
if [ -n "${BACKEND_HOSTPORT:-}" ] && [ -z "${BACKEND_URL:-}" ]; then
  BACKEND_URL="http://${BACKEND_HOSTPORT}"
fi
BACKEND_URL="${BACKEND_URL:-http://backend:8000}"
BACKEND_URL="${BACKEND_URL%/}"
BACKEND_HOST="${BACKEND_HOST:-$(echo "$BACKEND_URL" | sed -E 's#^https?://##' | cut -d/ -f1)}"

export PORT BACKEND_URL BACKEND_HOST
envsubst '${PORT} ${BACKEND_URL} ${BACKEND_HOST}' < /etc/nginx/templates/default.conf.template > /etc/nginx/conf.d/default.conf
exec nginx -g 'daemon off;'
