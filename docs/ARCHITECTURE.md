# 架构简介

双半体插件，两个文件，零构建。

| 文件 | 半体 | 职责 |
|---|---|---|
| `lib/index.js` | 宿主（Cordis loader 行） | 注册 `/dsh-about/{source,ping,describe,releases,check,versions,update}` 同源 HTTP 路由；更新源选择与持久化（`$DSH_HOME/dsh-about/source.json`）与延迟检测；npm dist-tag / packument / GitHub Releases 拉取；`npm install -g` 执行与自动重启看护 |
| `lib/client.js` | 浏览器（`window.__ModuleLoader__` 模块） | 注册 `settings.section`（id: `about`，导航「关于」）组件：图标、版本行、更新源选择（下拉菜单，点各源「未检测」即测延迟）、检查更新/一键更新弹窗、版本更新记录（数据由宿主落盘，浏览器不再用 localStorage） |

- 宿主行由 `cordis.patch.yml`（`dsh.bundle.patch`）挂载；浏览器半体由包内 `dsh.client` 清单 + `exports["./client"]` 自动发现打包（`@deepseek-ai/dsh-client-modules` 机制）。
- **零运行时依赖**：semver 已内嵌（`lib/semver.js`，语义与 node-semver 对齐并通过全量对拍）。`dsh plugin add <目录>` 走 `link:` 协议时不携带外部依赖，因此 clone 即可装、即装即用。

## 安全性设计要点

- 宿主路由 `/dsh-about/*` **仅允许回环地址**访问（DNS 重绑定防护），跨站 GET 用 `Sec-Fetch-Site` 拦下，跨站 POST 用 `Origin` 白名单 + `application/json` 预检双重防护（CSRF）。
- `/update` 是破坏性端点：并发互斥（同一时刻只允许一个安装任务）、目标版本号必须**已存在于 npm 注册表**且比当前新。
- `npm install -g` 带 5 分钟超时与进程组终止，安装输出尾部回显到弹窗便于排查。
- 只有加载了本插件的 dsh 进程才获得这些能力；不修改任何核心文件，卸载即完全移除。

## 更新链路细节

### 跨平台看护（自动重启）

更新成功后自动重启 dsh web，委托外部一次性看护 `dsh-watchdog once`：包内内置、随装随卸，
**Windows / macOS / Linux 三平台可用**；等宿主退出 → 数 3 秒 → 优先 systemd 拉起
`dsh-web`、退回原命令裸拉起（带 `--no-open`），端口就绪后**自动退出、零常驻**；
决策日志 `$DSH_HOME/dsh-watchdog.log`。

- `bin/dsh-watchdog.mjs`（纯 Node）是三平台首选——node 是 dsh 运行时必有依赖，
  **零新增依赖**，Windows / macOS / Linux 同一套。
- `bin/dsh-watchdog`（bash）保留给 Linux「常驻主循环 + systemd 用户服务」高级场景，
  并在极少数无 node 环境兜底。
- **Linux + systemd-run**：看护进程放进独立 transient 单元（独立 cgroup）——实测宿主退出时
  systemd 会清空 dsh-web 服务 cgroup 内的一切子进程，普通 detached 派生必死；
  transient 单元不受影响，更新后白屏无人拉起的根因即此。
- **macOS / Windows**：无 systemd，宿主 detached 派生 Node 看护即可；Windows 下
  npm 安装走 `npm.cmd`（shell 解析）、进程树终止走 `taskkill /T /F`，均已适配。

## 兼容性

- dsh CLI ≥ 0.x（支持 `dsh plugin --profile <name> add/remove` 与 `cordis.patch.yml` insert 层）。
