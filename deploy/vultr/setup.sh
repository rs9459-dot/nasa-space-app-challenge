#!/usr/bin/env bash
# One-time setup of a fresh Ubuntu 24.04 server for the FarmLine engine. Run as root:
#   ssh root@SERVER 'bash -s' < deploy/vultr/setup.sh
# Installs Python + cloudflared (Cloudflare's apt repo), makes a `farmline` service user,
# installs the two systemd units, and closes every inbound port except SSH (the engine
# listens on 127.0.0.1 only; the tunnel connects outward to Cloudflare).
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

apt-get update -q
apt-get install -y -q python3-venv python3-pip curl ufw

# cloudflared from Cloudflare's own package repository
install -d -m 0755 /usr/share/keyrings
curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg -o /usr/share/keyrings/cloudflare-main.gpg
echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main" \
  > /etc/apt/sources.list.d/cloudflared.list
apt-get update -q
apt-get install -y -q cloudflared

id farmline >/dev/null 2>&1 || useradd --system --create-home --home-dir /opt/farmline --shell /usr/sbin/nologin farmline
install -d -o farmline -g farmline /opt/farmline/app
install -d -m 0750 -o root -g farmline /etc/farmline

ufw allow OpenSSH >/dev/null
ufw --force enable >/dev/null
echo "setup done: $(python3 --version), $(cloudflared --version | head -1)"
