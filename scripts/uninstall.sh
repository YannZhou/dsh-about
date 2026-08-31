#!/usr/bin/env bash
# dsh-about 拔除残留清理（兜底脚本）。
#
# 何时需要：`dsh plugin --profile <name> remove dsh-about` 用 pnpm 卸载时，
# pnpm 对 link:/本地路径/tarball 安装的包**不执行** package.json 的 postuninstall
# 生命周期脚本（registry 安装的包若触发了钩子则无需本脚本）。
#
# 用法（任选其一）：
#   1) 克隆目录内：  bash scripts/uninstall.sh
#   2) 未克隆：      bash <(curl -fsSL https://raw.githubusercontent.com/YannZhou/dsh-about/v1.2.0/scripts/uninstall.sh)
#
# 只删除 dsh-about / dsh-watchdog 明确写入的路径，绝不越界删用户数据。
set -u

DSH_HOME_DIR="${DSH_HOME:-$HOME/.dsh}"
cleaned=0

clean() { # $1=路径 $2=描述
  if [ -e "$1" ]; then
    rm -rf -- "$1"
    echo "[dsh-about] 已清理残留: $1 ($2)"
    cleaned=$((cleaned + 1))
  fi
}

clean "$DSH_HOME_DIR/dsh-about" "版本记录磁盘缓存目录 releases-cache.json"
clean "$DSH_HOME_DIR/dsh-about-restart.log" "旧版内嵌看护遗留日志"
clean "$DSH_HOME_DIR/dsh-watchdog.log" "once 一次性看护决策日志"
clean "$DSH_HOME_DIR/.dsh-watchdog.lock" "常驻看护单实例锁"
clean "$DSH_HOME_DIR/.dsh-watchdog-once.lock" "once 锁"

# ── 残留的包实体目录：pnpm remove 之后 node_modules/dsh-about 偶有遗留 ──
# 仅当该 profile 的 package.json 已不再声明 dsh-about（dependencies/bundles 均无）
# 时才删除，仍在声明中的安装绝不误删。
for manifest in "$DSH_HOME_DIR"/profiles/*/package.json; do
  [ -f "$manifest" ] || continue
  prof_dir="$(dirname "$manifest")"
  pkg_dir="$prof_dir/node_modules/dsh-about"
  [ -d "$pkg_dir" ] || continue
  if ! grep -q '"dsh-about"' "$manifest" 2>/dev/null; then
    rm -rf -- "$pkg_dir"
    echo "[dsh-about] 已清理残留: $pkg_dir (remove 后遗留的包实体目录)"
    cleaned=$((cleaned + 1))
  fi
done

if [ "$cleaned" -gt 0 ]; then
  echo "[dsh-about] 卸载完成：已清理 $cleaned 项运行期残留"
else
  echo "[dsh-about] 卸载完成：未发现插件运行期残留"
fi
echo "[dsh-about] 提示：若曾手动执行过 cp bin/dsh-watchdog ~/.local/bin/，请自行删除该文件（插件本身使用包内副本，不受影响）。"