#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
for executable in python3 curl gcc; do command -v "$executable" >/dev/null || { echo "Missing dependency: $executable" >&2; exit 1; }; done
python3 -c 'import yaml' || { echo 'Install python3-yaml before using account balance' >&2; exit 1; }
gcc -O2 -o "$SCRIPT_DIR/zcat" "$SCRIPT_DIR/zcat.c" -l:libzstd.so.1
chmod 755 "$SCRIPT_DIR/zcat" "$SCRIPT_DIR/dsh-status.sh" "$SCRIPT_DIR/launcher.sh"
echo 'Desktop status helper built. No credentials or system settings were changed.'
