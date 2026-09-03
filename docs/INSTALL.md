# 安装 / 验证 / 卸载（完整手册）

本插件遵循 dsh 官方插件安装形式：`dsh plugin --profile <name> add <包>`
（内部由 pnpm 安装 + `cordis.patch.yml` insert 层挂载 + dsh 客户端模块自动发现打包）。

## 前提

- 已安装 DeepSeek Harness：`npm i -g @deepseek-ai/dsh`（Node ≥ 18）。
- dsh CLI 支持 `dsh plugin --profile <name> add/remove` 与 `cordis.patch.yml` insert 层（0.x 均可）。

## 安装

支持三种来源：

```sh
# 1) 本仓库源码（开发调试）
git clone https://github.com/YannZhou/dsh-about.git
dsh plugin --profile web add /path/to/dsh-about

# 2) GitHub 直接安装（推荐，一条命令，随仓库更新可 re-add 升级）
dsh plugin --profile web add "git+https://github.com/YannZhou/dsh-about.git"

# 3) npm 安装（scoped 包，已公开发布）
dsh plugin --profile web add @yannzhou/dsh-about
```

> 源码方式请在**包目录这一级**执行 `add`（指向 `dsh-about/`，不要指向其父目录）。
> 若 web profile 首次使用，它会用 `@deepseek-ai/dsh-base` 自动初始化，属正常现象。

安装后重启 / 刷新 `dsh web`（默认 http://127.0.0.1:3080），打开 **设置 → 关于** 即可看到本分区。

## 验证安装

```sh
dsh --profile web --dump-config | grep -A1 "dsh-about"
# 三种来源安装后形态一致，应看到（来源注释行 + patch 层）：
#   # == @yannzhou/dsh-about      ← 依赖名（来源注释行，npm / git / link 一致）
#   - id: dsh-about                ← patch 层 id（插件 cordis 标识）
#     name: '@yannzhou/dsh-about'  ← patch 层 name（= 包名，供新版 dsh client-modules 按包名注册）
```

> 注意：patch 层的 `name` 必须是 **scoped 包名 `@yannzhou/dsh-about`**，而非裸名 `dsh-about`。
> 新版 dsh（0.1.2+）的客户端模块系统按「包自身 name」给插件建图，`cordis.patch.yml` 的
> `name` 与 `lib/client.js` 的 `window.__ModuleLoader__.load({ id })` 都须与之保持一致。

浏览器侧：设置 → 关于出现 DeepSeek 图标与版本行；点「检查更新」返回 npm 最新版本对比结果。

> **两层名字，别混淆**：
> - **npm 包名 / profile 依赖名 & patch 层 `name`**：`@yannzhou/dsh-about`。`remove` 与 `dependencies` / `bundles` 清单都用它。
> - **cordis id / 插件内部标识**：`dsh-about`（由 `lib/index.js` 的 `export const name`、HTTP 路由前缀 `/dsh-about/*`、设置分区 `id: "about"` 决定）。

## 卸载

```sh
dsh plugin --profile web remove @yannzhou/dsh-about
```

`remove` 会原样转发给 pnpm，按 package.json `dependencies` 里的依赖名删除
（reconcile 同时把同名 bundle 从 `dsh.profile.bundles` 摘掉），因此卸载命令须与依赖名一致。
**无论源码 / GitHub / npm 哪种来源，安装后依赖名都是 `@yannzhou/dsh-about`**。

> 兼容旧实例：若某 profile 是在本包改名（裸名 `dsh-about` → scoped
> `@yannzhou/dsh-about`）**之前**装的，那一份依赖名是裸名 `dsh-about`，
> 对该实例请用 `dsh plugin --profile web remove dsh-about`。

卸载效果：

- **组合层**：`dsh.profile.bundles` 清单移除本包、`dependencies` 移除依赖，包内
  `cordis.patch.yml`（dsh.bundle.patch 层）随之消失；重启后「关于」分区、
  `/dsh-about/*` 路由、客户端 bundle 全部消失。无需手动改任何配置文件。
- **包文件**：profile node_modules 内对应依赖实体（含内置看护
  `bin/dsh-watchdog.mjs` / `bin/dsh-watchdog`、卸载脚本）随包删除。
- **进程**：更新链路的一次性看护进程端口就绪后自动退出，不驻留。

运行期数据（`$DSH_HOME/dsh-about` 插件数据目录——版本记录缓存与更新源选择、`$DSH_HOME/dsh-watchdog.log`、
`$DSH_HOME/dsh-about-restart.log`、锁文件）由卸载钩子 `scripts/postuninstall.js`
自动删除。npm（registry）安装会正常触发该钩子，卸载即自动清理；仅 pnpm 对
`link:`/本地路径/`file:` tarball 安装的包**不执行**该钩子，此时请补跑兜底脚本：

```sh
bash scripts/uninstall.sh                                   # 克隆目录内
# 或未克隆时：bash <(curl -fsSL https://raw.githubusercontent.com/YannZhou/dsh-about/v1.6.0/scripts/uninstall.sh)
```

唯一可选手动项：如果你曾执行过 `cp bin/dsh-watchdog ~/.local/bin/`（为独立使用
`check`/`once` 命令），按需自行删除；插件本身不需要它。

## 故障排查

| 症状 | 处理 |
|---|---|
| `dsh plugin add` 报 pnpm 未找到 | 安装 pnpm 后重试；或先 `cd` 到 profile 目录手动 `pnpm add <dir>` 后用 `--patch` 覆盖 |
| `--dump-config` 没有 dsh-about 行 | 确认包内 `dsh.bundle.patch` 存在且指向 `cordis.patch.yml`；确认 `add` 路径是包目录而非父目录 |
| 设置里没有「关于」分区 | 刷新浏览器（客户端 bundle 在组合图重建后自动加载）；仍无则重启 dsh web 一次 |
| 「检查更新」报错 | 确认机器能访问 registry.npmjs.org 与 api.github.com；检查输出信息中的具体原因 |
| 更新后自动重启未完成 | 见页面提示手动执行 `dsh web`；新版本已装好时属安全降级路径 |
| 安装失败提示依赖解析 | 本包零运行时依赖（semver 已内嵌），如 pnpm 仍报错，多为镜像/网络问题，换镜像后重试 |
