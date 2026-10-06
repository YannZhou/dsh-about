#!/usr/bin/env node
// dsh-about 拔除残留清理（兜底脚本，Windows / 任意有 node 的环境）。
//
// 何时需要：`dsh plugin --profile <name> remove <本包>` 走 pnpm 卸载时，pnpm 对
// link:/本地路径/tarball 安装的包**不执行** package.json 的 postuninstall 生命周期
// 脚本（registry 安装的包若触发了钩子则无需本脚本）。Windows 默认没有 bash，
// `bash scripts/uninstall.sh` 直接不可用，而「补跑清理」恰恰在 Windows 上更容易
// 需要（安装形态更杂），故提供这个纯 Node 的等价入口。
//
// 用法：
//   node scripts/uninstall.mjs                        # Windows / 任意有 node 的环境
//   bash scripts/uninstall.sh                         # POSIX（等价实现）
//   set DSH_HOME=D:\some\.dsh && node scripts/uninstall.mjs   # 覆盖数据目录（可选）
//
// 清理目标（$DSH_HOME/dsh-about/、dsh-about-restart.log、dsh-watchdog.log、两个锁
// 文件，以及三类残留包实体目录）与「仅当没有任何 profile 仍声明本包时才删」的安全
// 守则，直接复用卸载钩子的实现：钩子与兜底共用同一份逻辑，避免两条路径对同一份
// 数据做出不同判断。postuninstall.js 的对外行为未做任何改动，本文件只是它的
// 可执行入口。
import "./postuninstall.js";
