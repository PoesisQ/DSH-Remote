#!/usr/bin/env bash
# Stable Windows -> WSL entry. No shell evaluation of arguments.
set -euo pipefail
SUITE_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
for candidate in "$HOME/.nvm/versions/node/"*/bin "$HOME/.local/bin"; do
  [ ! -d "$candidate" ] || PATH="$candidate:$PATH"
done
export PATH
command -v node >/dev/null || { echo 'Node.js 24+ is required in WSL' >&2; exit 1; }
node -e 'if(Number(process.versions.node.split(".")[0])<24)process.exit(1)' || { echo 'Node.js 24+ is required' >&2; exit 1; }
ACTION="${1:-help}"
case "$ACTION" in run|stop|status|usage|pairing|doctor|init) ;; *) echo 'Unknown action' >&2; exit 1;; esac
shift || true
exec node "$SUITE_ROOT/bin/dsh-suite.js" "$ACTION" "$@"
