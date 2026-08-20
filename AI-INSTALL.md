# AI-INSTALL.md — dsh-about 一键安装执行手册

> **读者对象：本文件是写给「另一个 AI 智能体」的自动化任务书。**
> 人类用户只需要做一件事：把本仓库地址（或目录路径）交给他们的 AI，并说
> “按 AI-INSTALL.md 把这个 dsh 插件装上”。AI 应完全按下面的步骤执行，
> 遇到任何失败按「故障排查」一节处理；全部步骤不需要人类手动干预即可完成。

This file is an executable runbook for an AI agent. A human only needs to hand
you this repository (URL or local path) and ask you to install the plugin; you
are expected to complete every step below on your own.

---

## 0. 任务声明 / Mission

在目标机器上，把 `dsh-about`（DeepSeek Harness 设置中心「关于」分区插件：检查更新 /
一键更新 / GitHub 版本记录）安装到 DeepSeek Harness 的 **web** profile，
并验证安装成功。

Target: install the `dsh-about` bundle into the **web** profile of an existing
DeepSeek Harness installation and verify activation.

## 1. 前置检查 / Prerequisites

逐条执行并核对输出：

```sh
dsh --version          # 必须成功。失败 → 先装 DeepSeek Harness：npm install -g @deepseek-ai/dsh
node --version         # 需要 Node ≥ 18（fetch/AbortSignal 可用）
pnpm --version         # dsh plugin 依赖 pnpm；缺失 → npm install -g pnpm
```

- 本仓库目录应已存在（AI 已 clone 或已拿到目录），记作 `$PLUGIN_DIR`。
- 不要修改 `$PLUGIN_DIR` 之外的任何机器配置；不要执行本手册未列出的安装命令。

## 2. 获取插件源码 / Obtain the plugin

若你手头只有仓库 URL：

```sh
git clone https://github.com/YannZhou/dsh-about.git
cd dsh-about                    # $PLUGIN_DIR 即此目录
```

若人类已直接把目录给了你，`cd` 到该目录并确认结构：

```sh
ls "$PLUGIN_DIR"                 # 应包含 package.json、cordis.patch.yml、lib/、AI-INSTALL.md
```

## 3. 安装 bundle / Install the bundle

在 `$PLUGIN_DIR` 的**父目录**执行（关键：不要把 `add` 的路径指向仓库目录自身所在的
父目录根，而应指向本仓库目录这一级）：

```sh
cd "$(dirname "$PLUGIN_DIR")"
dsh plugin --profile web add "$PLUGIN_DIR"
```

说明 / Notes:

- `dsh plugin --profile web add <dir>` 会在 web profile 目录里转发给 pnpm 安装，
  把本包作为依赖写入，**并因为包内声明了 `dsh.bundle.patch` 自动追加到
  `dsh.profile.bundles`**——不需要也不应该手动改任何 yaml。
- 若 web profile 首次使用，它会用 `@deepseek-ai/dsh-base` 自动初始化，属正常现象。
- 若输出要求网络下载依赖，保持网络可用；安装过程应无交互（如有交互，选默认项）。

## 4. 验证激活 / Verify activation

```sh
dsh --profile web --dump-config | grep -A2 "dsh-about"
```

期望输出（bundle 层已应用）：

```
# == .../cordis.patch.yml  (bundle: dsh-about 层或 profile 层)
- id: dsh-about
  name: dsh-about
```

再核对浏览器半体声明可被解析（web 前端在组合图重建后会自动发现并打包 client 半体，
无需任何额外步骤）：

```sh
node -e "const p=require('$PLUGIN_DIR/package.json'); console.log(p.dsh.client.platform, p.dsh.bundle.patch, p.exports['./client'])"
# 期望：web ./cordis.patch.yml ./lib/client.js
```

## 5. 重启并人工验收 / Restart & acceptance

如果 `dsh web` 正在运行：

1. 重启它（AI 通常应先询问人类是否允许重启，或由人类手动重启）。
2. 浏览器打开 http://127.0.0.1:3080（或实际端口），进入 **设置 → 关于**：
   - 应看到 DeepSeek 图标、产品名、当前版本 / 平台 / 项目主页；
   - 点「检查更新」：显示“已是最新版本 vX”或“发现新版本 vY（latest 稳定版 / next 预览版）”；
   - 「版本更新记录」区域应列出官方 GitHub 最新 Releases。

若以上可见，安装成功。🎉

## 6. 卸载（供回滚参考）/ Uninstall

```sh
dsh plugin --profile web remove dsh-about
```

移除后配置树不再含 dsh-about 行；浏览器刷新后「关于」分区消失。

## 7. 故障排查 / Troubleshooting

| 症状 | 处理 |
|---|---|
| `dsh plugin add` 报 pnpm 未找到 | 安装 pnpm 后重试；或先 `cd` 到 profile 目录手动 `pnpm add <dir>` 后用 `--patch` 覆盖 |
| `--dump-config` 没有 dsh-about 行 | 确认包内 `dsh.bundle.patch` 存在且指向 `cordis.patch.yml`；确认 `add` 路径是包目录而非父目录 |
| 设置里没有「关于」分区 | 刷新浏览器（客户端 bundle 在组合图重建后自动加载）；仍无则重启 dsh web 一次 |
| 「检查更新」报错 | 确认机器能访问 registry.npmjs.org 与 api.github.com；检查输出信息中的具体原因 |
| 更新后自动重启未完成 | 见页面提示手动执行 `dsh web`；新版本已装好时属安全降级路径 |
| 安装失败提示依赖解析 | 本包零运行时依赖（semver 已内嵌），如 pnpm 仍报错，多为镜像/网络问题，换镜像后重试 |

## 8. 完成定义 / Definition of done

- [ ] `dsh plugin --profile web add` 成功（exit 0）
- [ ] `--dump-config` 出现 dsh-about 插件行
- [ ] 浏览器「设置 → 关于」分区可见，检查更新可交互
- [ ] 未修改 dsh 核心文件、未动其他 profile

完成后向人类汇报：安装位置、验证结果、浏览器验收结果、卸载命令。

---

*AI 执行注意：本插件更新动作会在 Web UI 内执行 `npm install -g @deepseek-ai/dsh@<版本>`
并自动重启 dsh web，属预期行为；安装本插件本身不做任何全局安装。*