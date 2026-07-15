#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER_DIR="$SCRIPT_DIR/app/server"
WEB_DIR="$SCRIPT_DIR/app/web"

# Make sure `codex` (installed via nvm's Node 22) is on PATH regardless of what
# Node version the parent shell happened to have active — sourcing nvm.sh alone
# does not switch to the default version, it requires an explicit `nvm use`.
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if [ -s "$NVM_DIR/nvm.sh" ]; then
  # shellcheck disable=SC1091
  \. "$NVM_DIR/nvm.sh"
  nvm use default >/dev/null 2>&1 || true
fi

if [ ! -d "$SERVER_DIR/node_modules" ]; then
  echo "Installing server dependencies..."
  (cd "$SERVER_DIR" && npm install)
fi

if [ ! -d "$WEB_DIR/node_modules" ]; then
  echo "Installing web dependencies..."
  (cd "$WEB_DIR" && npm install)
fi

# Kill both dev servers (and this script) together on Ctrl+C / exit.
trap 'kill 0' EXIT INT TERM

(cd "$SERVER_DIR" && npm run dev) &
(cd "$WEB_DIR" && npm run dev) &

echo ""
echo "Backend:  http://localhost:8787"
echo "Frontend: http://localhost:5173"
echo "Open the frontend URL — it'll ask for your Gemini API key the first time."
echo "Press Ctrl+C to stop both."
echo ""

wait
