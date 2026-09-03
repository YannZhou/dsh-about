#!/usr/bin/env bash
# dsh-about 拔除残留清理（兜底脚本）。
#
# 何时需要：`dsh plugin --profile <name> remove dsh-about` 用 pnpm 卸载时，
# pnpm 对 link:/本地路径/tarball 安装的包**不执行** package.json 的 postuninstall
# 生命周期脚本（registry 安装的包若触发了钩子则无需本脚本）。
#
# 用法（任选其一）：
#   1) 克隆目录内：  bash scripts/uninstall.sh
#   2) 未克隆：      bash <(curl -fsSL https://raw.githubusercontent.com/YannZhou/dsh-about/v1.5.0/scripts/uninstall.sh)
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

clean "$DSH_HOME_DIR/dsh-about" "插件数据目录(版本记录缓存 releases-cache.json / 更新源 source.json)"
clean "$DSH_HOME_DIR/dsh-about-restart.log" "旧版内嵌看护遗留日志"
clean "$DSH_HOME_DIR/dsh-watchdog.log" "once 一次性看护决策日志"
clean "$DSH_HOME_DIR/.dsh-watchdog.lock" "常驻看护单实例锁"
clean "$DSH_HOME_DIR/.dsh-watchdog-once.lock" "once 锁"

# ── 残留的包实体目录：pnpm remove 之后插件实体可能残留在三类位置 ──
#   1) <profile>/node_modules/dsh-about
#   2) <profile>/.dsh-module-fallback/node_modules/dsh-about（该 profile 的模块回退镜像）
#   3) $DSH_HOME/profiles/node_modules/dsh-about（跨 profile 共享的模块回退镜像；
#      只随 dsh-install 依赖闭包自动维护，dsh-about 不在闭包内故从不会被自动清理）
# 清理守则（与旧版一致，绝不越界删用户数据）：
#   仅当「没有任何」profile 的 package.json 仍声明 dsh-about（dependencies /
#   devDependencies 与 dsh.profile.bundles 均无）时才删除——仍在声明中的安装绝不误删。
# 注意：本脚本应在 `dsh plugin --profile <name> remove dsh-about` 完成之后再跑，
# 此时各 profile 清单已是最新（bundles 已对账），判断才准确。

# 先汇总：是否仍有 profile 声明 dsh-about（决定共享镜像/回退镜像是否可删）
still_declared=0
for manifest in "$DSH_HOME_DIR"/profiles/*/package.json; do
  [ -f "$manifest" ] || continue
  if grep -q '"dsh-about"' "$manifest" 2>/dev/null; then
    still_declared=1
    echo "[dsh-about] 检测到 profile 仍声明 dsh-about，保留其所有安装实体: $manifest"
    break
  fi
done

# 1) 各 profile 自身 node_modules（pnpm remove 后偶有真实目录/链接遗留）
for manifest in "$DSH_HOME_DIR"/profiles/*/package.json; do
  [ -f "$manifest" ] || continue
  prof_dir="$(dirname "$manifest")"
  pkg_dir="$prof_dir/node_modules/dsh-about"
  if [ -e "$pkg_dir" ] || [ -L "$pkg_dir" ]; then
    # 该 profile 清单仍声明 → 保留（独立判断，互不牵连）
    if grep -q '"dsh-about"' "$manifest" 2>/dev/null; then
      echo "[dsh-about] 保留（仍在声明中）: $pkg_dir"
    else
      rm -rf -- "$pkg_dir"
      echo "[dsh-about] 已清理残留: $pkg_dir (remove 后遗留的包实体目录)"
      cleaned=$((cleaned + 1))
    fi
  fi
done

# 2) 各 profile 的 .dsh-module-fallback 回退镜像（同 profile 清单判断）
for manifest in "$DSH_HOME_DIR"/profiles/*/package.json; do
  [ -f "$manifest" ] || continue
  prof_dir="$(dirname "$manifest")"
  fb_dir="$prof_dir/.dsh-module-fallback/node_modules/dsh-about"
  if [ -e "$fb_dir" ] || [ -L "$fb_dir" ]; then
    if grep -q '"dsh-about"' "$manifest" 2>/dev/null; then
      echo "[dsh-about] 保留（仍在声明中）: $fb_dir"
    else
      rm -rf -- "$fb_dir"
      echo "[dsh-about] 已清理残留: $fb_dir (profile 模块回退镜像)"
      cleaned=$((cleaned + 1))
    fi
  fi
done

# 3) 跨 profile 共享回退镜像（任一 profile 仍声明即保留）
shared_mirror="$DSH_HOME_DIR/profiles/node_modules/dsh-about"
if [ -e "$shared_mirror" ] || [ -L "$shared_mirror" ]; then
  if [ "$still_declared" = 1 ]; then
    echo "[dsh-about] 保留（仍有 profile 声明）: $shared_mirror"
  else
    rm -rf -- "$shared_mirror"
    echo "[dsh-about] 已清理残留: $shared_mirror (共享模块回退镜像)"
    cleaned=$((cleaned + 1))
  fi
fi

if [ "$cleaned" -gt 0 ]; then
  echo "[dsh-about] 卸载完成：已清理 $cleaned 项运行期残留"
else
  echo "[dsh-about] 卸载完成：未发现插件运行期残留"
fi
echo "[dsh-about] 提示：若曾手动执行过 cp bin/dsh-watchdog ~/.local/bin/，请自行删除该文件（插件本身使用包内副本，不受影响）。"