#!/usr/bin/env bash
# Run from a complete checkout/package so POSIX and Windows share all safeguards.
set -eu
script_dir="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
if [ ! -f "$script_dir/postuninstall.js" ]; then
  echo "[dsh-about] 请从完整项目目录运行 scripts/uninstall.sh（需要 Node.js）。" >&2
  exit 1
fi
exec node "$script_dir/postuninstall.js" "$@"
