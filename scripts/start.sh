#!/usr/bin/env bash
# 后台启动 dsh-remote（日志: ~/.dsh-remote.log，pid: ~/.dsh-remote.pid）
# 默认使用项目内 config.json（与已测试的配对一致）；额外参数可覆盖（如 --config 其他路径）。
set -euo pipefail
cd "$(dirname "$0")/.."
source ./scripts/runtime.sh
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

if [ -f "$PID_FILE" ]; then
  old_pid="$(tr -dc '0-9' < "$PID_FILE")"
  if is_bridge_pid "$old_pid"; then
    echo "dsh-remote 已在运行 (pid $old_pid)"
    exit 0
  fi
  echo "清理无效或不属于本项目的 pid 文件"
  rm -f "$PID_FILE"
fi

if tmux has-session -t "$TMUX_SESSION" 2>/dev/null; then
  tmux_pid="$(tmux list-panes -t "$TMUX_SESSION" -F '#{pane_pid}' | head -n 1)"
  if is_bridge_pid "$tmux_pid"; then
    echo "$tmux_pid" > "$PID_FILE"
    echo "dsh-remote 已在运行 (pid $tmux_pid，tmux: $TMUX_SESSION)"
    exit 0
  fi
  tmux kill-session -t "$TMUX_SESSION" 2>/dev/null || true
fi

# pid 文件可能被手动删除；先找回本项目已存在的桥接进程，避免重复启动。
for proc in /proc/[0-9]*; do
  running_pid="${proc##*/}"
  if is_bridge_pid "$running_pid"; then
    echo "$running_pid" > "$PID_FILE"
    echo "dsh-remote 已在运行 (pid $running_pid，已恢复 pid 文件)"
    exit 0
  fi
done

if command -v tmux >/dev/null 2>&1; then
  printf -v project_q '%q' "$PROJECT_DIR"
  printf -v log_q '%q' "$HOME/.dsh-remote.log"
  printf -v command_q '%q ' node bin/dsh-remote.js --config ./config.json "$@"
  tmux new-session -d -s "$TMUX_SESSION" "cd $project_q && exec $command_q >> $log_q 2>&1"
  pid="$(tmux list-panes -t "$TMUX_SESSION" -F '#{pane_pid}' | head -n 1)"
  manager="，tmux: $TMUX_SESSION"
else
  nohup setsid node bin/dsh-remote.js --config ./config.json "$@" >> "$HOME/.dsh-remote.log" 2>&1 &
  pid=$!
  manager="，setsid"
fi
echo "$pid" > "$PID_FILE"
sleep 0.4
if ! is_bridge_pid "$pid"; then
  tmux kill-session -t "$TMUX_SESSION" 2>/dev/null || true
  rm -f "$PID_FILE"
  echo "dsh-remote 启动后立即退出，请查看 ~/.dsh-remote.log" >&2
  exit 1
fi
echo "dsh-remote 已启动 (pid $pid$manager)，日志: ~/.dsh-remote.log"
echo "查看配对码: node bin/dsh-remote.js --config ./config.json --show-pairing"
