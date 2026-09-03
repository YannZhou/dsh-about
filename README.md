# dsh-about

DeepSeek Harness 设置中心 **「关于」分区**插件 —— 版本信息、检查更新、一键更新、GitHub 版本更新记录。

![dsh-about 设置中心「关于」分区](./assets/dsh-about.png)

## 功能

- **版本信息**：dsh（npm 包）、Web 前端、Node / 平台与项目主页展示。
- **检查更新**：对比 npm `latest` / `next` 及全部预发布 tag（`alpha` / `beta`），自动分级提示风险。
- **一键更新**：`npm install -g` 走所选源，装完自动重启 dsh web；跨平台（Windows / macOS / Linux）看护，零常驻。
- **更新源切换**：官方 npm / npmmirror 国内镜像 / 跟随本地配置，下拉即时切换，点击即可实测延迟。
- **版本更新记录**：官方 GitHub Releases 最新 10 条，中文渲染、默认收起，每日自动拉取缓存到本地。
- **GitHub 同步检测**：Release 已发布而 npm 未同步时明确提示，npm 发布后角标自动消失。

## 安装

前提：已安装 DeepSeek Harness（`npm i -g @deepseek-ai/dsh`，Node ≥ 18）。

```sh
# GitHub 安装
dsh plugin --profile web add "git+https://github.com/YannZhou/dsh-about.git"
```

装完重启 / 刷新 `dsh web`（默认 http://127.0.0.1:3080），打开 **设置 → 关于** 即可看到本分区。

> 最简单的方法是扔给你的 AI，让他帮你安装。

## 卸载

```sh
dsh plugin --profile web remove @yannzhou/dsh-about
```

> 改名前的旧实例请用裸名卸载：`dsh plugin --profile web remove dsh-about`。
> 运行期数据由卸载钩子自动清理，零残留。

## 更多文档

| 文档 | 内容 |
|---|---|
| [docs/INSTALL.md](docs/INSTALL.md) | 完整安装 / 验证 / 卸载 / 故障排查 |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | 架构简介与安全性设计 |
| [docs/NPM-PUBLISH.md](docs/NPM-PUBLISH.md) | 发布到 npm（维护者向） |

## License

MIT © YannZhou
