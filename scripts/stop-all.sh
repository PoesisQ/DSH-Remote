#!/usr/bin/env bash
# 停止由 start-all.sh 启动的桥接器与 DSH Web。
set -euo pipefail
cd "$(dirname "$0")/.."
TMUX_SESSION="${DSH_REMOTE_TMUX_SESSION:-dsh-remote-web}"

./scripts/stop.sh
if tmux has-session -t "$TMUX_SESSION" 2>/dev/null; then
  tmux kill-session -t "$TMUX_SESSION"
  echo "已停止 DSH Web"
  rm -f ~/.dsh-web.pid
elif [ -f ~/.dsh-web.pid ]; then
  pid="$(cat ~/.dsh-web.pid)"
  if kill -0 "$pid" 2>/dev/null; then
    kill "$pid"
    echo "已停止 DSH Web (pid $pid)"
  else
    echo "DSH Web 未在运行（清理残留 pid 文件）"
  fi
  rm -f ~/.dsh-web.pid
else
  echo "DSH Web 未由 start-all.sh 管理"
fi
