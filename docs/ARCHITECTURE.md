# 架构简介

双半体插件，两个文件，零构建。

| 文件 | 半体 | 职责 |
|---|---|---|
| `lib/index.js` | 宿主（Cordis 加载） | 注册 `/dsh-about/*` 同源 HTTP 路由（source / auth / auth-test / ping / describe / releases / check / versions / update / plugin / plugin-update）；更新源选择与持久化、GitHub 认证与配额回显、延迟检测；拉取 npm 与 GitHub Releases 数据；执行 `npm install -g`（dsh 本体）与 `dsh plugin add`（插件自身）；自动重启看护 |
| `lib/client.js` | 浏览器（`window.__ModuleLoader__` 模块） | 注册「关于」设置分区（`settings.section`，id: `about`）：图标、版本行、插件版本行（自更新 + 小红点）、更新源下拉、检查更新 / 一键更新弹窗、插件自更新弹窗、版本更新记录、导航红点（DOM 追加 + MutationObserver，因 slot 的 label 只接受纯文本） |

- 宿主半体由 `cordis.patch.yml` 挂载；浏览器半体由包内 `dsh.client` 清单 + `exports["./client"]` 自动发现打包（`@deepseek-ai/dsh-client-modules` 机制），无需手动注册。
- **零运行时依赖**：semver 已内嵌（`lib/semver.js`，与 node-semver 语义对齐并经全量对比测试）。clone 即可装、即装即用。

## 安全性设计

- 宿主路由 `/dsh-about/*` **仅允许回环地址访问**（DNS 重绑定防护）；跨站 GET 用 `Sec-Fetch-Site` 拦截，跨站 POST 用 Origin 白名单 + JSON 预检双重防护（CSRF）。
- `/update` 是破坏性端点：并发互斥（同一时刻只允许一个安装任务），且目标版本必须**已存在于 npm 注册表**且比当前新。
- `/plugin-update`（插件自更新）同级别防护，且与 `/update` **互相排斥**（都要动包树）；额外拒绝 `link:` / `file:` 本地安装——否则会把开发者的源码目录替换成 npm 包。
- 自更新只用 `dsh plugin add`（与插件市场同一条命令）：显式指定版本号，可绕开 pnpm「新版本发布未满 24 小时」的静默回退；装完以**磁盘上的 package.json 版本**为准校验，不信 pnpm 的退出码（防假成功）。
- `npm install -g` 带 5 分钟超时与进程组终止，安装输出尾部回显到弹窗，便于排查。
- GitHub token（可选）只落盘到 `$DSH_HOME/dsh-about/auth.json`（`0600`）；接口单向写入、只回掩码，响应体与日志都不含明文。`/auth-test` 只发起一次 `api.github.com` 请求，不接受任意 URL 或任意头。
- 能力只存在于加载了本插件的 dsh 进程内；不修改任何核心文件，卸载即完全移除。

## GitHub 认证（可选 PAT）

匿名调用 GitHub REST 按**出口 IP** 计 60 次/小时——共享代理、机房节点、公司出口很容易被打满，
届时「版本更新记录」显示「获取版本更新失败：GitHub 接口返回 403」，且没有任何自助恢复手段。
配置 token 后按**账号**计 5000 次/小时。

- 存储：`$DSH_HOME/dsh-about/auth.json`（`0600`），只含 `token` 一个字段；
  `POST /auth` 传空串即删除该文件。行距/空白先裁剪再落盘。
- 接口只回**掩码**（长值露前 4 后 4，短值只露前 2），任何响应体都不含明文；token 不写日志。
- 生效优先级：`auth.json` > `GITHUB_TOKEN` 环境变量。环境变量只上报 `fromEnv`，
  不算「已配置」（界面清不掉它，如实说明来源）。
- 生效时机：保存即更新进程内变量，**无需重启 dsh**；`fetchReleases()` 下一次调用就用新值。
- `POST /auth-test` 用界面当前草稿（或已生效值）试打一次 GitHub，回显
  `status / limit / remaining / resetAt`——把「403 是因为没配 token 还是 token 权限不足」
  一次问清楚；网络异常也回 200 + `success:false`，不抛 500。
- 影响面仅限 GitHub 那条请求（`api.github.com/.../releases`）。npm 注册表那几次走的是
  更新源（官方源 / npmmirror / 本地配置），不受本 token 影响。

## 测试

`npm test`（Node 内置 `node --test`，无测试框架、无 devDependencies）。

- 测试在**真实 HTTP 服务**上跑：`test/helpers/host.mjs` 用一个最小 `ctx` 捕获
  `apply()` 注册的路由，再套 `http.createServer`。这样「回环限制 / Origin 白名单 /
  content-type / 请求体上限」这些防护层才在测试路径上——绕过 HTTP 直接调函数等于没测。
- 出站 `fetch` 被整体替换为进程内 stub，**测试不访问外网**：既不会被本机匿名配额
  （60 次/小时/IP）耗尽搞成假红，也不会因网络抖动误报。
- 每个测试文件用独立临时 `DSH_HOME`（`test/helpers/env.mjs` 在 import 被测模块**之前**
  改写环境变量），因此不碰真实 `~/.dsh`；同时设 `DSH_ABOUT_NPMRC=off` 避免测试改写用户 `~/.npmrc`。
- 跨进程语义（「重启后新进程能否读到 token」）用子进程探针
  `test/helpers/probe-auth.mjs` 验证，而不是同进程再 `apply()` 一次——后者测不出模块级
  `let githubToken = readGithubToken()` 的真实行为。
- CI：`.github/workflows/ci.yml` 在 Linux / macOS / Windows 三平台跑，并按实际通过用例数
  设下限，防「用例被删光但 CI 仍绿」。

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
