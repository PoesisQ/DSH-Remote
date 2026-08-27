#!/usr/bin/env bash
# 停止 dsh-remote
set -uo pipefail
cd "$(dirname "$0")/.."
PID_FILE="$HOME/.dsh-remote.pid"
PROJECT_DIR="$(pwd -P)"
TMUX_SESSION="${DSH_REMOTE_BRIDGE_TMUX_SESSION:-dsh-remote-bridge}"

is_bridge_pid() {
  local pid="${1:-}" cwd cmdline
  [[ "$pid" =~ ^[0-9]+$ ]] || return 1
  kill -0 "$pid" 2>/dev/null || return 1
  cwd="$(readlink -f "/proc/$pid/cwd" 2>/dev/null || true)"
  [ "$cwd" = "$PROJECT_DIR" ] || return 1
  cmdline="$(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null || true)"
  [[ "$cmdline" == *"bin/dsh-remote.js"* ]]
}

stopped=0
if [ -f "$PID_FILE" ]; then
  pid="$(tr -dc '0-9' < "$PID_FILE")"
  if is_bridge_pid "$pid"; then
    if kill "$pid"; then
      for _ in $(seq 1 50); do
        if ! is_bridge_pid "$pid"; then break; fi
        sleep 0.1
      done
      if is_bridge_pid "$pid"; then
        echo "dsh-remote 未在 5 秒内退出，保留 pid 文件以避免重复启动" >&2
        exit 1
      fi
      echo "已停止 dsh-remote (pid $pid)"
      stopped=1
    fi
  elif [[ "$pid" =~ ^[0-9]+$ ]] && kill -0 "$pid" 2>/dev/null; then
    echo "pid $pid 不属于本项目，未发送停止信号" >&2
  else
    echo "dsh-remote 未在运行（清理残留 pid 文件）"
  fi
  rm -f "$PID_FILE"
fi

if [ "$stopped" -eq 0 ]; then
  for proc in /proc/[0-9]*; do
    pid="${proc##*/}"
    if is_bridge_pid "$pid"; then
      if kill "$pid"; then
        for _ in $(seq 1 50); do
          if ! is_bridge_pid "$pid"; then break; fi
          sleep 0.1
        done
        if is_bridge_pid "$pid"; then
          echo "$pid" > "$PID_FILE"
          echo "dsh-remote 未在 5 秒内退出，已恢复 pid 文件" >&2
          exit 1
        fi
        echo "已停止 dsh-remote (pid $pid)"
        stopped=1
      fi
    fi
  done
fi

if tmux has-session -t "$TMUX_SESSION" 2>/dev/null; then
  tmux kill-session -t "$TMUX_SESSION" 2>/dev/null || true
fi

if [ "$stopped" -eq 0 ]; then echo "dsh-remote 未在运行"; fi
