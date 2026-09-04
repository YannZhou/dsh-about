# 安装 / 验证 / 卸载（完整手册）

本插件走 dsh 官方插件安装形式：`dsh plugin --profile <name> add <包>`。内部是 pnpm 安装 + `cordis.patch.yml` 挂载 + 客户端模块自动发现，不需要手改任何配置。

## 前提

- 已装 DeepSeek Harness：`npm i -g @deepseek-ai/dsh`（Node ≥ 18）。
- dsh CLI 支持 `dsh plugin` 子命令（0.x 均支持）。

## 安装

```sh
# 方式一：GitHub 安装（推荐）
dsh plugin --profile web add "git+https://github.com/YannZhou/dsh-about.git"

# 方式二：npm 安装
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

运行期数据（`$DSH_HOME/dsh-about/` 数据目录、`$DSH_HOME/dsh-watchdog.log`、`$DSH_HOME/dsh-about-restart.log`、锁文件）由卸载钩子 `scripts/postuninstall.js` 自动清理。

> **钩子触发条件**：npm 安装会正常触发 postuninstall；但 `link:` / 本地路径 / `file:` tarball 安装不触发（GitHub `git+` 视 pnpm 解析形态也可能不触发）。未触发时补跑兜底脚本：
> ```sh
> bash scripts/uninstall.sh                                   # 克隆目录内
> # 或未克隆：bash <(curl -fsSL https://raw.githubusercontent.com/YannZhou/dsh-about/v1.6.1/scripts/uninstall.sh)
> ```

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
