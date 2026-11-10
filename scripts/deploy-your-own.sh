#!/usr/bin/env bash
# Deploys Lofi Lobby to your Cloudflare account. Safe to re-run.
set -euo pipefail
cd "$(dirname "$0")/.."

if ! npx wrangler whoami >/dev/null 2>&1; then
  echo "NEEDS: sign in to Cloudflare first: npx wrangler login"; exit 2
fi
npm run build
npx wrangler deploy
if ! npx wrangler secret list 2>/dev/null | grep -q ADMIN_PASSWORD; then
  echo
  echo "NEEDS: set the admin password (typed into a hidden prompt):"
  echo "  npx wrangler secret put ADMIN_PASSWORD"
  exit 2
fi
echo "Done. Open the URL above, pick a trainer and enter the room."
