# 安装 / 验证 / 卸载（完整手册）

本插件走 dsh 官方插件安装形式：`dsh plugin --profile <name> add <包>`。内部是 pnpm 安装 + `cordis.patch.yml` 挂载 + 客户端模块自动发现，不需要手改任何配置。

## 前提

- 已装 DeepSeek Harness：`npm i -g @deepseek-ai/dsh`（Node ≥ 18）。
- dsh CLI 支持 `dsh plugin` 子命令（0.x 均支持）。

> [!IMPORTANT]
> **npm ≥ 12 用户**：npm 12 默认拦截依赖的安装脚本，dsh 的原生依赖
> （fs-ext / koffi / node-pty / protobufjs / @google/genai / @deepseek-ai/dsh-subprocess-local）
> 需要编译，被拦会缺产物导致 dsh 装完打不开（典型报错
> `Cannot find module '.../build/Release/fs_ext.node'`）。
>
> 放行要用 npm **官方**的 `allow-scripts` 机制。⚠️ **不要再用**
> `--dangerously-allow-all-scripts`：npm 已公告移除它，而给 npm 传不认识的旗标会
> **直接报错退出**（`EUNKNOWNCONFIG`），不是忽略。
>
> 一次配好，以后手动升级都安全（推荐）：
> ```sh
> npm config set allow-scripts=fs-ext,koffi,node-pty,protobufjs,@google/genai,@deepseek-ai/dsh-subprocess-local --location=user
> npm install -g @deepseek-ai/dsh
> ```
> 只想放行这一次：
> ```sh
> npm install -g --allow-scripts=fs-ext,koffi,node-pty,protobufjs,@google/genai,@deepseek-ai/dsh-subprocess-local @deepseek-ai/dsh
> ```
> 升级同理（`@deepseek-ai/dsh@latest`）。若 dsh 已经打不开（缺 `.node` 产物），
> 先按上面配好放行，再加 `--force` 重装当前版本即可修复，无需降级：
> ```sh
> npm install -g --allow-scripts=fs-ext,koffi,node-pty,protobufjs,@google/genai,@deepseek-ai/dsh-subprocess-local --force @deepseek-ai/dsh
> ```
> 本插件「一键更新」已内置：npm ≥ 12 自动附加官方 `allow-scripts` 白名单
> （实际依赖树扫描 ∪ 历史原生依赖表 ∪ 你 .npmrc 里已有的条目），安装后自动校验
> （install-scripts 警告 + dsh --version 双信号），不健康时带 `--force` 自动重装
> 一次自愈，仍失败才报错。因此用插件更新即可，无需手动处理以上细节。
> 插件每次启动还会自动扫描 dsh 实际依赖树，把原生模块以白名单形式追加进
> `~/.npmrc`（只追加不覆盖，写前自动备份），手动 `npm install -g @deepseek-ai/dsh`
> 升级同样无需操心。卸载插件时这些条目会**保留**（它们保护的是 dsh 本体的
> 手动升级）；确实要清掉时用 `DSH_ABOUT_NPMRC_CLEANUP=1 dsh plugin remove dsh-about`。

## 安装

> [!IMPORTANT]
> **最推荐的装法：把仓库地址直接扔给你的 AI，让它帮你装。** 你只需要说一句"帮我装这个插件"，
> AI 会照着 `AI-INSTALL.md` 完成全部步骤。想自己动手的话，下面二选一：

```sh
# 方式一：GitHub 安装（推荐，一条命令，随仓库更新可 re-add 升级）
dsh plugin --profile web add "git+https://github.com/YannZhou/dsh-about.git"

# 方式二：npm 安装（包已发布到 npm，scoped 包名 @yannzhou/dsh-about）
dsh plugin --profile web add @yannzhou/dsh-about
```

两种方式等价：装好后依赖名都是 `@yannzhou/dsh-about`。

> ⚠️ **发布后 24 小时内装 npm 源可能拿到旧版**：pnpm 有 minimumReleaseAge 门禁，新版本发布不足一天时默认安装会静默回退到上一个版本（不报错）。刚发布完想立刻装新版，请显式指定版本：
> ```sh
> dsh plugin --profile web add @yannzhou/dsh-about@1.6.1
> ```

开发调试可以改用本地源码：clone 后在**包目录这一级**执行 `add`（指向 `dsh-about/`，不要指向父目录）：

```sh
git clone https://github.com/YannZhou/dsh-about.git
dsh plugin --profile web add /path/to/dsh-about
```

> 若 web profile 是首次使用，dsh 会自动初始化（用 `@deepseek-ai/dsh-base`），属正常现象。

装完刷新 `dsh web`（默认 http://127.0.0.1:3080），打开 **设置 → 关于** 即可看到本分区。

## 验证安装

```sh
dsh --profile web --dump-config | grep -A1 "dsh-about"
```

应看到：

```
# == @yannzhou/dsh-about      ← 依赖名（来源注释行）
- id: dsh-about                ← 插件 cordis id
  name: '@yannzhou/dsh-about'  ← patch 层 name（= 包名）
```

浏览器侧：设置 → 关于出现 DeepSeek 图标与版本行；点「检查更新」能返回版本对比结果。

> **两层名字，别混淆**：
> - **包名**（对外，npm / 依赖清单 / patch 层 name / 客户端注册键）：`@yannzhou/dsh-about`
> - **插件 id**（对内，cordis id / 路由前缀 / 设置分区 id）：`dsh-about`
>
> patch 层的 `name` 和 `lib/client.js` 的 `load({ id })` 必须等于包名 `@yannzhou/dsh-about`。新版 dsh（0.1.2+）按包名建客户端图，写裸名会导致「关于」分区静默不渲染（路由正常、无报错）。

## 卸载

```sh
dsh plugin --profile web remove @yannzhou/dsh-about
```

卸载命令必须与依赖名一致（`remove` 原样转给 pnpm，按 `dependencies` 里的名字删）。无论 GitHub 还是 npm 安装，依赖名都是 `@yannzhou/dsh-about`。

> 旧实例兼容：本包改名（裸名 → scoped）之前装的 profile，依赖名是裸名 `dsh-about`，请用 `dsh plugin --profile web remove dsh-about`。

卸载效果：

- **配置层**：`dsh.profile.bundles` 与 `dependencies` 自动摘除本包，patch 层随之消失，重启后分区、路由、客户端模块全部移除，无需手动改配置。
- **文件层**：profile node_modules 里的包实体（含内置看护脚本）随包删除。
- **进程**：更新链路的一次性看护进程在端口就绪后自动退出，不驻留。

运行期数据（`$DSH_HOME/dsh-about/` 数据目录、日志与锁文件）在没有其他 profile 使用、没有更新或恢复任务、也没有活动看护时，由 `scripts/postuninstall.js` 清理。仍在使用或需要恢复的共享数据会保留。

> **钩子触发条件**：npm 安装会正常触发 postuninstall；但 `link:` / 本地路径 / `file:` tarball 安装不触发（GitHub `git+` 视 pnpm 解析形态也可能不触发）。未触发时补跑兜底脚本：
> ```sh
> bash scripts/uninstall.sh                                   # POSIX：克隆目录内
> node scripts/uninstall.mjs                                  # Windows：默认没有 bash
> # 两个入口均须在完整项目目录中运行（共用 Node 清理逻辑）。
> ```
> 两个兜底脚本清理的目标与安全判断完全一致（`uninstall.mjs` 直接复用 `scripts/postuninstall.js` 的实现），数据目录非默认时可先设 `DSH_HOME` 再跑。

唯一可选手动项：若你曾手动执行过 `cp bin/dsh-watchdog ~/.local/bin/`（为独立使用 `check`/`once` 命令），按需自行删除；插件本身不需要它。

## 故障排查

| 症状 | 处理 |
|---|---|
| `dsh plugin add` 报 pnpm 未找到 | 安装 pnpm 后重试 |
| `--dump-config` 没有 dsh-about 行 | 确认 `add` 指向包目录本身而非父目录 |
| 设置里没有「关于」分区 | 先刷新浏览器；仍无则重启 dsh web |
| 「检查更新」报错 | 确认机器能访问 registry.npmjs.org 与 api.github.com |
| 更新后自动重启未完成 | 新版本已装好时属安全降级：手动执行 `dsh web` 即可 |
| 安装失败提示依赖解析 | 本包零运行时依赖（semver 已内嵌），报错多为镜像 / 网络问题，换源重试 |


## 更新中断后的恢复

更新进度和结果保存在 `$DSH_HOME/dsh-about/update-state.json`，诊断日志为同目录的 `update.log`。宿主退出不会终止独立事务。若事务进程本身被强杀，页面会报告中断并保留快照；需要恢复时禁止启动新的安装。

先确认安装任务停止，再在完整项目目录运行 `node scripts/recover-update.mjs`。非默认目录须使用原来的 `DSH_HOME`。恢复脚本核对原任务配置、进程和 systemd 安装单元，成功恢复并验证旧版 CLI 后才解除互斥。不要直接删除锁或唯一快照来绕过保护。

插件自身更新中断也使用该命令恢复。先关闭发起更新的原 dsh 宿主，并确认安装进程停止；脚本根据保存的 profile 检查已安装插件的清单、入口文件、浏览器脚本语法及宿主模块依赖能否加载，通过后解除更新阻塞。插件没有本体回滚快照，此流程不会回滚插件版本；检查失败时会继续保留阻塞，请在原 profile 手动重新安装插件，再运行恢复命令。

旧任务未记录 profile 时，脚本只在安装位置唯一时自动推断。多 profile 同时声明插件时，显式指定原安装位置，例如 `node scripts/recover-update.mjs --profile web`。恢复成功后重新启动 dsh。异常退出遗留的 `update.lock.reclaim` 会在持有者失效且文件超过 20 秒后安全回收，仍存活的锁持有者不会被抢占。

成功更新会保留旧版快照；请按需管理 `$DSH_HOME/dsh-about/backups/` 的磁盘占用，仅在确认没有任务和待恢复状态后清理不再需要的历史备份。
