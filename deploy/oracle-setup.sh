#!/usr/bin/env bash
# Sets up a fresh Ubuntu server (for example the Oracle Cloud "Always Free" one) to run the API and the workers.
# Usage, from inside the cloned project folder:   bash deploy/oracle-setup.sh yourname.duckdns.org
set -euo pipefail

DOMAIN="${1:?Usage: bash deploy/oracle-setup.sh yourname.duckdns.org}"
cd "$(dirname "$0")/.."

if [ ! -f .env ]; then
  echo "Create the .env file first:  cp deploy/server.env.example .env   then fill it in (see deploy/DEPLOY-ORACLE.md)."
  exit 1
fi

sudo apt-get update
sudo apt-get install -y git curl redis-server debian-keyring debian-archive-keyring apt-transport-https gnupg

# Node 22 and pm2
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
sudo npm install -g pm2

# Caddy (the web server that gets the free https certificate)
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
sudo apt-get update
sudo apt-get install -y caddy

# Redis (the queue) starts at boot
sudo systemctl enable --now redis-server

# The project's packages
npm ci

# https address for the API
sed "s/YOUR-DOMAIN/${DOMAIN}/" deploy/Caddyfile | sudo tee /etc/caddy/Caddyfile >/dev/null
sudo systemctl restart caddy

# Oracle's Ubuntu images block web ports in the server's own firewall as well as in the cloud console
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save 2>/dev/null || sudo sh -c 'iptables-save > /etc/iptables/rules.v4' 2>/dev/null || true

# Start the API and the workers, and keep them running
pm2 start deploy/ecosystem.config.cjs
pm2 save
echo
echo "Almost done. Run the command pm2 prints for the next line to make it start after a reboot:"
pm2 startup systemd -u "$USER" --hp "$HOME" | tail -n 1
echo
echo "Then check:  curl https://${DOMAIN}/health"
