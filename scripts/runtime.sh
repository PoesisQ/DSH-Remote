#!/usr/bin/env bash
# Trusted machine-local settings are never part of the public repository.
RUNTIME_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [ -f "$RUNTIME_ROOT/.runtime.env" ]; then source "$RUNTIME_ROOT/.runtime.env"; fi
if [ -n "${DSH_REMOTE_NODE_BIN:-}" ]; then
  if [ -d "$DSH_REMOTE_NODE_BIN" ]; then
    export PATH="$DSH_REMOTE_NODE_BIN:$PATH"
  elif [ -x "$DSH_REMOTE_NODE_BIN" ]; then
    export PATH="$(dirname "$DSH_REMOTE_NODE_BIN"):$PATH"
  fi
fi
if ! command -v node >/dev/null 2>&1; then
  echo "找不到 Node.js；请设置 PATH 或 .runtime.env 中的 DSH_REMOTE_NODE_BIN" >&2
  exit 1
fi
