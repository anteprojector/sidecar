#!/bin/sh
# sidecar installer
#   curl -fsSL https://raw.githubusercontent.com/anteprojector/sidecar/main/packages/sidecar/install.sh | sh
#
# Installs the global sidecar via npm today, and records "curl" as the install
# source so future versions can switch distribution channels without breaking
# the self-updater.
set -eu

PACKAGE="@projectors/sidecar"

if ! command -v npm >/dev/null 2>&1; then
  echo "sidecar: npm is required (install Node.js 20+ from https://nodejs.org)" >&2
  exit 1
fi

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo "sidecar: Node.js 20 or newer is required (found $(node -v 2>/dev/null || echo none))" >&2
  exit 1
fi

echo "installing $PACKAGE..."
npm install -g "$PACKAGE"

# The npm global bin dir may not be on PATH yet in this shell.
SIDECAR="$(command -v sidecar 2>/dev/null || true)"
if [ -z "$SIDECAR" ]; then
  SIDECAR="$(npm prefix -g)/bin/sidecar"
fi
if [ ! -x "$SIDECAR" ]; then
  echo "sidecar: installed, but the sidecar executable was not found on PATH" >&2
  echo "sidecar: add \"$(npm prefix -g)/bin\" to PATH, then run: sidecar set-install-source curl" >&2
  exit 1
fi

"$SIDECAR" set-install-source curl >/dev/null

echo ""
echo "sidecar v$("$SIDECAR" --version) installed."
echo "next: cd into a repo and run \`sidecar init\`"
