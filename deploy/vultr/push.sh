#!/usr/bin/env bash
# Deploy the engine to the Vultr server and point the live Worker at it. From the repo root:
#   bash deploy/vultr/push.sh [git-ref]        # default: origin/main
#   bash deploy/vultr/push.sh --url-only       # only re-read the tunnel address and update the Worker
#
# Ships `git archive` of the ref (engine/, contracts/, data/: tracked files only, never .env or
# keys), installs Python packages, writes ENGINE_API_TOKEN (from the gitignored engine/.env) to
# /etc/farmline/engine.env, (re)starts the engine and tunnel services, waits for the tunnel
# address and sets the Worker secrets ENGINE_URL and ENGINE_API_TOKEN. The quick-tunnel address
# survives engine restarts but changes if the tunnel service or server restarts: run --url-only.
set -euo pipefail
SERVER="${FARMLINE_SERVER:-root@104.156.230.226}"
KEY="${FARMLINE_SSH_KEY:-$HOME/.ssh/farmline_vultr}"
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
SSH=(ssh -i "$KEY" -o BatchMode=yes -o ConnectTimeout=20 "$SERVER")
cd "$REPO"

TOKEN="$(grep '^ENGINE_API_TOKEN=' engine/.env | head -1 | cut -d= -f2- | tr -d '\r\n')"
[ -n "$TOKEN" ] || { echo "No ENGINE_API_TOKEN in engine/.env"; exit 1; }

if [ "${1:-}" != "--url-only" ]; then
  REF="${1:-origin/main}"
  git fetch -q origin
  echo "Shipping $(git rev-parse --short "$REF") ($REF)"
  git archive --format=tar "$REF" engine contracts data | "${SSH[@]}" 'set -e
    rm -rf /opt/farmline/new && mkdir -p /opt/farmline/new && tar -xf - -C /opt/farmline/new
    mkdir -p /opt/farmline/app/data/cache
    mv /opt/farmline/app/data/cache /opt/farmline/new-cache
    rm -rf /opt/farmline/app && mv /opt/farmline/new /opt/farmline/app
    mkdir -p /opt/farmline/app/data && mv /opt/farmline/new-cache /opt/farmline/app/data/cache
    chown -R farmline:farmline /opt/farmline'
  "${SSH[@]}" 'set -e
    [ -x /opt/farmline/venv/bin/python ] || python3 -m venv /opt/farmline/venv
    /opt/farmline/venv/bin/pip install -q --upgrade pip
    /opt/farmline/venv/bin/pip install -q -r /opt/farmline/app/engine/requirements.txt'
  printf 'ENGINE_API_TOKEN=%s\n' "$TOKEN" | "${SSH[@]}" 'umask 027; cat > /etc/farmline/engine.env; chgrp farmline /etc/farmline/engine.env'
  "${SSH[@]}" 'cat > /etc/systemd/system/farmline-engine.service' < deploy/vultr/farmline-engine.service
  "${SSH[@]}" 'cat > /etc/systemd/system/farmline-tunnel.service' < deploy/vultr/farmline-tunnel.service
  "${SSH[@]}" 'set -e; systemctl daemon-reload; systemctl enable -q farmline-engine farmline-tunnel
    systemctl restart farmline-engine; systemctl is-active -q farmline-tunnel || systemctl start farmline-tunnel'
fi

echo "Waiting for the tunnel address..."
URL=""
for _ in $(seq 1 60); do
  URL="$("${SSH[@]}" "journalctl -u farmline-tunnel --since '-6h' --no-pager -o cat | grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' | tail -1" || true)"
  [ -n "$URL" ] && curl -fsS -m 5 "$URL/health" >/dev/null 2>&1 && break
  URL=""; sleep 2
done
[ -n "$URL" ] || { echo "Tunnel not reachable; check: journalctl -u farmline-tunnel"; exit 1; }
echo "Engine reachable at $URL"

(cd worker && printf '%s' "$URL" | npx wrangler secret put ENGINE_URL >/dev/null \
            && printf '%s' "$TOKEN" | npx wrangler secret put ENGINE_API_TOKEN >/dev/null)
echo "Worker farmline-messaging now calls $URL"

echo "Warming up fields..."
for _ in $(seq 1 150); do
  H="$(curl -fsS -m 5 "$URL/health" || true)"
  echo "$H" | grep -q '"warming"' || break
  sleep 2
done
echo "$H"
