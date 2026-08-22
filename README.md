# dsh-about

DeepSeek Harness 设置中心「关于」分区插件 —— **检查更新 + 一键更新**。

> DeepSeek Harness 设置中心“About” tab: DeepSeek logo, version info, **check for updates** (npm `latest`/`next`), one-click update with auto-restart, and GitHub releases history.

![dsh-about 设置中心「关于」分区](./assets/dsh-about.png)

## 功能特性

- **版本信息**：当前 dsh 版本（npm 包 `@deepseek-ai/dsh`）、Web 前端版本、Node / 平台、项目主页。
- **检查更新**：对比当前版本与 npm `latest` / `next` 两个 dist-tag 中较新者，提示发现新版本。
- **版本选择**：列出 npm 上所有比当前新的版本（最多 10 个），弹窗选择安装。
- **一键更新**：`npm install -g @deepseek-ai/dsh@<目标版本>`（固定官方 registry），成功后**自动重启 dsh web**（委托外部一次性看护 `bin/dsh-watchdog once`：包内内置、随装随卸；等宿主退出 → 数 3 秒 → 优先 systemd 拉起 `dsh-web`、退回原命令裸拉起（带 `--no-open`），端口就绪后**自动退出、零常驻**；决策日志 `$DSH_HOME/dsh-watchdog.log`）。
  - 看护进程经 `systemd-run` 放入独立 transient 单元（独立 cgroup）——实测宿主退出时
    systemd 会清空 dsh-web 服务 cgroup 内的一切子进程，普通 detached 派生必死；
    transient 单元不受影响，更新后白屏无人拉起的根因即此。
- **版本更新记录**：官方 GitHub Releases 最新 10 条，中文正文渲染，每日首次打开自动拉取一次并**保存到本地电脑**（`$DSH_HOME/dsh-about/releases-cache.json`），失败不会反复重试；点「刷新」可手动强刷。

## 安全性设计要点

- 宿主路由 `/dsh-about/*` **仅允许回环地址**访问（DNS 重绑定防护），跨站 GET 用 `Sec-Fetch-Site` 拦下，跨站 POST 用 `Origin` 白名单 + `application/json` 预检双重防护（CSRF）。
- `/update` 是破坏性端点：并发互斥（同一时刻只允许一个安装任务）、目标版本号必须**已存在于 npm 注册表**且比当前新。
- `npm install -g` 带 5 分钟超时与进程组终止，安装输出尾部回显到弹窗便于排查。
- 只有加载了本插件的 dsh 进程才获得这些能力；不修改任何核心文件，卸载即完全移除。

## 安装（官方 dsh 插件机制）

本包遵循 dsh 官方插件安装形式：`dsh plugin --profile <name> add <包>`（内部由
pnpm 安装 + `cordis.patch.yml` insert 层挂载 + dsh 客户端模块自动发现打包）。
支持三种来源：

```sh
# 1) 本仓库源码（开发调试）
git clone https://github.com/YannZhou/dsh-about.git
dsh plugin --profile web add /path/to/dsh-about

# 2) GitHub 直接安装（推荐，一条命令，随仓库更新可 re-add 升级）
dsh plugin --profile web add "git+https://github.com/YannZhou/dsh-about.git"

# 3) npm 安装（发布后可用，见下方「发布到 npm」）
dsh plugin --profile web add dsh-about
```

安装验证：

```sh
dsh --profile web --dump-config | grep dsh-about   # 应看到 - id: dsh-about 层
```

然后重启 / 刷新 `dsh web`（默认 http://127.0.0.1:3080），打开 **设置 → 关于** 即可看到本分区。
插件自带的 `bin/dsh-watchdog` 随包安装、随包卸载，无需任何手工放置。

## 验证

- 配置树中应出现 `- id: dsh-about / name: dsh-about` 层（bundle 自动应用）。
- 浏览器侧：设置 → 关于出现 DeepSeek 图标与版本行；点「检查更新」返回 npm 最新版本对比结果。

## 卸载（随时拔除，零残留）

```sh
# 1) 官方移除（组合层 + 包文件，一步完成）
dsh plugin --profile web remove dsh-about
```

- **组合层**：`dsh.profile.bundles` 清单移除本包、`dependencies` 移除依赖，包内
  `cordis.patch.yml`（dsh.bundle.patch 层）随之消失；重启后「关于」分区、
  `/dsh-about/*` 路由、客户端 bundle 全部消失。无需手动改任何配置文件。
- **包文件**：profile node_modules 内的 `dsh-about` 实体（含内置看护
  `bin/dsh-watchdog`、卸载脚本）随包删除。
- **进程**：更新链路的一次性看护进程端口就绪后自动退出，不驻留。

运行期数据（`$DSH_HOME/dsh-about` 版本记录缓存、`$DSH_HOME/dsh-watchdog.log`、
`$DSH_HOME/dsh-about-restart.log`、锁文件）由卸载钩子 `scripts/postuninstall.js`
自动删除；注意 pnpm 对 link:/本地路径/tarball 安装的包**不执行**该钩子，此时请补跑兜底脚本：

```sh
# 2) 运行期残留清理（仅当 1 未自动清理时）
bash scripts/uninstall.sh                                   # 克隆目录内
# 或未克隆时：bash <(curl -fsSL https://raw.githubusercontent.com/YannZhou/dsh-about/v1.1.2/scripts/uninstall.sh)
```

唯一可选手动项：如果你曾执行过 `cp bin/dsh-watchdog ~/.local/bin/`（为独立使用
`check`/`once` 命令），按需自行删除；插件本身不需要它。

## 发布到 npm（可选）

```sh
# 包结构已符合从 npm 直接安装的官方形态（main/exports/dsh./files/bin/scripts 齐备）
npm publish --access public
```

## 架构简介

双半体插件，两个文件，零构建：

| 文件 | 半体 | 职责 |
|---|---|---|
| `lib/index.js` | 宿主（Cordis loader 行） | 注册 `/dsh-about/{describe,releases,check,versions,update}` 同源 HTTP 路由；npm dist-tag / packument / GitHub Releases 拉取；`npm install -g` 执行与自动重启看护 |
| `lib/client.js` | 浏览器（`window.__ModuleLoader__` 模块） | 注册 `settings.section`（id: `about`，导航「关于」）组件：图标、版本行、检查更新/一键更新弹窗、版本更新记录（数据由宿主落盘，浏览器不再用 localStorage） |

- 宿主行由 `cordis.patch.yml`（`dsh.bundle.patch`）挂载；浏览器半体由包内 `dsh.client` 清单 + `exports["./client"]` 自动发现打包（`@deepseek-ai/dsh-client-modules` 机制）。
- **零运行时依赖**：semver 已内嵌（`lib/semver.js`，语义与 node-semver 对齐并通过全量对拍）。`dsh plugin add <目录>` 走 `link:` 协议时不携带外部依赖，因此 clone 即可装、即装即用。

## 兼容性

- dsh CLI ≥ 0.x（支持 `dsh plugin --profile <name> add/remove` 与 `cordis.patch.yml` insert 层）。

## License

MIT © YannZhou