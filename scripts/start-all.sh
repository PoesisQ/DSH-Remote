#!/usr/bin/env bash
# 一键启动本机 DSH Web 与 dsh-remote 桥接。
set -euo pipefail
cd "$(dirname "$0")/.."

source ./scripts/runtime.sh
export PATH="$HOME/.local/bin:$PATH"
TMUX_SESSION="${DSH_REMOTE_TMUX_SESSION:-dsh-remote-web}"

port_up() {
  ss -ltnH "sport = :3080" 2>/dev/null | grep -q .
}

if port_up; then
  echo "DSH Web 已在运行"
else
  tmux kill-session -t "$TMUX_SESSION" 2>/dev/null || true
  tmux new-session -d -s "$TMUX_SESSION" \
    "exec dsh web --host 127.0.0.1 --port 3080 --no-open >> '$HOME/.dsh-web.log' 2>&1"
  tmux list-panes -t "$TMUX_SESSION" -F '#{pane_pid}' | head -n 1 > ~/.dsh-web.pid
  for _ in $(seq 1 90); do
    if port_up; then break; fi
    if ! tmux has-session -t "$TMUX_SESSION" 2>/dev/null; then break; fi
    sleep 1
  done
  if ! port_up; then
    tmux kill-session -t "$TMUX_SESSION" 2>/dev/null || true
    echo "DSH Web 启动失败，查看 ~/.dsh-web.log" >&2
    exit 1
  fi
  echo "DSH Web 已启动 (pid $(cat ~/.dsh-web.pid))，日志: ~/.dsh-web.log"
fi

./scripts/start.sh
