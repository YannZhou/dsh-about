# dsh-about

DeepSeek Harness 设置中心「关于」分区插件：查看版本、检查更新、一键更新、看版本更新记录。

![dsh-about 设置中心「关于」分区](./assets/dsh-about.png)

## 功能

- **版本信息**：当前 dsh 版本、Web 前端、Node 版本与平台信息，一目了然。
- **检查更新**：自动对比官方最新版和预发布版，带分级提示，不盲目推荐。
- **一键更新**：选定更新源直接安装，装完自动重启 dsh web；Windows / macOS / Linux 都能用，无常驻进程。
- **更新源切换**：官方源 / 国内镜像 / 跟随本地配置，下拉即切，点击即可实测延迟。
- **版本更新记录**：官方发布的最新 10 条记录，中文显示，默认收起，每天自动拉取并缓存到本地。
- **发布同步检测**：代码已发布而 npm 还没跟上时明确提示，npm 发布后提示自动消失。

## 安装

前提：已安装 DeepSeek Harness（`npm i -g @deepseek-ai/dsh`，Node ≥ 18）。

二选一：

```sh
# 方式一：GitHub 安装
dsh plugin --profile web add "git+https://github.com/YannZhou/dsh-about.git"

# 方式二：npm 安装（已发布到 npm）
dsh plugin --profile web add @yannzhou/dsh-about
```

装完刷新 `dsh web`（默认 http://127.0.0.1:3080），打开 **设置 → 关于** 就能看到。

> 嫌麻烦的话，直接把仓库地址扔给你的 AI，让它帮你装。

## 卸载

```sh
dsh plugin --profile web remove @yannzhou/dsh-about
```

> 改名前的旧安装请用裸名卸载：`dsh plugin --profile web remove dsh-about`。
> 运行期数据由卸载钩子自动清理，卸载后零残留。

## 更多文档

| 文档 | 内容 |
|---|---|
| [安装手册](docs/INSTALL.md) | 完整安装 / 验证 / 卸载 / 故障排查 |
| [架构说明](docs/ARCHITECTURE.md) | 架构简介与安全性设计 |
| [发布说明](docs/NPM-PUBLISH.md) | 发布到 npm（维护者向） |

## License

MIT © YannZhou
