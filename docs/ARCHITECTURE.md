# 架构简介

双半体插件，两个文件，零构建。

| 文件 | 半体 | 职责 |
|---|---|---|
| `lib/index.js` | 宿主（Cordis 加载） | 注册 `/dsh-about/*` 同源 HTTP 路由（source / ping / describe / releases / check / versions / update）；更新源选择与持久化、延迟检测；拉取 npm 与 GitHub Releases 数据；执行 `npm install -g` 与自动重启看护 |
| `lib/client.js` | 浏览器（`window.__ModuleLoader__` 模块） | 注册「关于」设置分区（`settings.section`，id: `about`）：图标、版本行、更新源下拉、检查更新 / 一键更新弹窗、版本更新记录 |

- 宿主半体由 `cordis.patch.yml` 挂载；浏览器半体由包内 `dsh.client` 清单 + `exports["./client"]` 自动发现打包（`@deepseek-ai/dsh-client-modules` 机制），无需手动注册。
- **零运行时依赖**：semver 已内嵌（`lib/semver.js`，与 node-semver 语义对齐并经全量对比测试）。clone 即可装、即装即用。

## 安全性设计

- 宿主路由 `/dsh-about/*` **仅允许回环地址访问**（DNS 重绑定防护）；跨站 GET 用 `Sec-Fetch-Site` 拦截，跨站 POST 用 Origin 白名单 + JSON 预检双重防护（CSRF）。
- `/update` 是破坏性端点：并发互斥（同一时刻只允许一个安装任务），且目标版本必须**已存在于 npm 注册表**且比当前新。
- `npm install -g` 带 5 分钟超时与进程组终止，安装输出尾部回显到弹窗，便于排查。
- 能力只存在于加载了本插件的 dsh 进程内；不修改任何核心文件，卸载即完全移除。

## 更新与自动重启

更新成功后，dsh web 的自动重启委托给包内的一次性看护 `dsh-watchdog once`：等宿主退出 → 等 3 秒 → 优先 `systemctl --user start dsh-web`，systemd 不可用才退回落 `dsh web --no-open` → 端口就绪后看护自动退出、零常驻。决策日志在 `$DSH_HOME/dsh-watchdog.log`。

- `bin/dsh-watchdog.mjs`（纯 Node）：三平台首选，node 是 dsh 运行时必有依赖，零新增依赖，Windows / macOS / Linux 同一套。
- `bin/dsh-watchdog`（bash）：Linux 专用，覆盖「常驻 + systemd 用户服务」高级场景及无 node 环境的兜底。
- **Linux + systemd 的特殊性**：看护进程放进独立 transient 单元（独立 cgroup）。实测宿主退出时 systemd 会清空 dsh-web 服务 cgroup 内的全部子进程，普通 detached 派生必死；transient 单元不受影响。更新后"白屏无人拉起"的根因即此。
- **macOS / Windows**：无 systemd，宿主 detached 派生 Node 看护即可；Windows 下 npm 走 `npm.cmd`、进程树终止走 `taskkill /T /F`，均已适配。

## 兼容性

- dsh CLI：0.x 全线支持（`dsh plugin add/remove` + `cordis.patch.yml` insert 层）。
- 客户端图机制分界：dsh **0.1.2 起**按「包自身 name」给插件建客户端启动图，之前的版本接受裸名。本插件 1.6.0 起按新机制对齐（见下）。

## 包名约定（重要）

本包对外用 **scoped 包名 `@yannzhou/dsh-about`**（npm 发布名 / profile 依赖名 / 客户端模块注册键），对内用 **裸名 `dsh-about`** 作为插件身份（cordis id / 路由前缀 / 设置分区 id）。

各位置的取值必须严格一致：

| 位置 | 取值 |
|---|---|
| `package.json` `name` | `@yannzhou/dsh-about` |
| `cordis.patch.yml` insert 的 `name` | `@yannzhou/dsh-about` |
| `lib/client.js` `load({ id })` | `@yannzhou/dsh-about` |
| `lib/index.js` `export const name`、路由前缀、设置分区 id | `dsh-about`（不变） |
| `cordis.patch.yml` insert 的 `id` | `dsh-about`（不变） |

> **为什么必须这样**：dsh 0.1.2+ 的 `@deepseek-ai/dsh-client-modules` 把插件纳入客户端启动图时，会严格比对「loader 条目名」与「包自身 name」，不一致就丢弃。若只改宿主侧不改客户端注册键，表现为 `/dsh-about/*` 路由正常但「关于」分区静默不渲染、无任何报错。
