# 发布流程（dsh-about）

本仓库是 DeepSeek Harness 的「关于」分区插件，走 **npm 公开发布 + GitHub 标签/Release** 两条线：
用户既能 `dsh plugin add @yannzhou/dsh-about` 装，也能从插件市场装。

## 硬规矩（最重要）

- **推送前必须交用户验证**：改动做完先把成果给用户验证，**用户明确说「推送」**，才允许
  `git push` / `git tag` / `gh release create` / `npm publish`。
  ⚠️ **推 `v*` 标签会自动触发 `.github/workflows/publish-npm.yml`**：它替我们做 npm publish
  并建 GitHub Release。所以「推 tag」这一个动作就等于同时授权了 npm 发布——别以为只推了 GitHub。
- **Release 正文只有一行链接**：标题已经是版本号，正文不再重复版本号，也不放变更长文。
  详细说明一律写进 `docs/versions/<版本>.md`。
- **每次发布必须写版本文档**，并在 `docs/versions/README.md` 的索引表里加一行。

## 分支与标签

- 分支：`main` 即发布分支，发布提交直接落在 `main`（不做额外发布分支）。
- 标签：`v<版本>`，**与 `package.json` 的 `version` 完全一致**（例：`1.7.0` → `v1.7.0`）。

## 每次发布要同步的地方

1. `package.json` 的 `version`（npm 包版本、dsh 插件版本、`/dsh-about/plugin` 读的都是它）；
2. 新增 `docs/versions/v<版本>.md`（版本信息 + 变更说明），并在 `docs/versions/README.md` 索引表加一行；
3. Git 标签 `v<版本>` 与 GitHub Release（正文只写一行链接引导）。

## 发布动作：推 tag 即自动发（CI 负责 npm + Release）

`git push origin main` 之后推标签 `v<版本>`，`.github/workflows/publish-npm.yml` 会自动：

1. 校验 `tag == package.json.version`、`docs/versions/v<版本>.md` 存在、三个 JS `node --check` 通过（任一不过就红叉，不会发错版本）；
2. 该版本已在 npm 上则跳过发布（重复推 tag / 手工补跑都不报错）；
3. `npm publish --registry=https://registry.npmjs.org`，然后回读 npm 确认版本真的在；
4. 建 GitHub Release：标题 = 纯版本号，正文 = 一行版本文档链接。

因此**不需要再手工跑 `npm publish` / `gh release create`**。补发或重跑：Actions → 「发布到 npm」→ Run workflow，填 tag。

**一次性配置**（换 token 时重做）：仓库 Settings → Secrets and variables → Actions → New repository secret，
名字 `NPM_TOKEN`，值是 npm 网页生成的 **Granular Access Token**（Read and write、勾 Bypass 2FA、限定
`@yannzhou/dsh-about`）。也可以在本地跑 `gh secret set NPM_TOKEN`（交互式粘贴，不进聊天记录）。
没配这个 secret 时 CI 会在发布步骤失败，本地手工 `npm publish` 仍可作为兜底。

## Release 文案（严格照抄这个格式）

- **标题 = 纯版本号**（如 `v1.7.0`），不带描述、不用破折号接长句。
- **正文 = 一行**：

  ```
  版本说明见 [docs/versions/v1.7.0.md](https://github.com/YannZhou/dsh-about/blob/main/docs/versions/v1.7.0.md)
  ```

- 安装命令、功能清单、已知限制、验证情况全部写在版本文件里，正文不重复。

## 发布前检查

- 工作区干净：无未跟踪文件、无 `.bak` / `.orig` / `.rej` 残留。
- 改动的 JS 逐个 `node --check lib/index.js lib/client.js` 通过。
- 新增的纯函数保持 `export`，可直接 `import` 冒烟（本仓库惯例：`npmMajorVersion` / `dshCliEntry` /
  `verifyDshInstall` / `runUpdate` / `getPluginInfo` 等）。
- 宿主路由改动后重启 `systemctl --user restart dsh-web.service`，再逐个回环 `curl` 验证；
  `GET /dsh-about/describe`、`GET /dsh-about/plugin` 应返回 200 且字段正确。
- 在**隔离 `DSH_HOME`** 里真装一次再验证，不污染本机 profile：

  ```sh
  DSH_HOME=/tmp/x/dsh node ~/.npm-global/lib/node_modules/@deepseek-ai/dsh/lib/bin.js \
    plugin --profile web2 add @yannzhou/dsh-about@<版本>
  ```

- 推 tag 前确认 CI 的前置条件都满足（CI 会再校验一遍）：`package.json.version` == 标签、`docs/versions/v<版本>.md` 已写。
- 需要手工兜底时才本地发（CI 挂了 / 没配 secret）：`npm publish --registry=https://registry.npmjs.org`
  （需 npm 网页生成的 granular token 并勾选 bypass 2FA；`npm whoami` 先确认登录态）。
- 发布后回读：`npm view @yannzhou/dsh-about version` / `npm view <pkg> time`、`npm pack` 核对 tarball
  文件清单（scoped 包必须 `publishConfig.access=public`）、`gh release view v<版本>` 正文与资产、
  `git ls-remote origin refs/heads/main refs/tags/v<版本>` 与本地一致；用 CI 发布时看 Actions 那个 run 是否绿。

## 已知约束

- **发布后 24 小时内 pnpm 默认安装会回退到旧版**（`minimumReleaseAge` 门禁，静默不报错）：
  验证/自更新请显式指定版本号 `dsh plugin add @yannzhou/dsh-about@<版本>`。
- **两层名字别混淆**：对外包名 `@yannzhou/dsh-about`（npm / 依赖清单 / patch 层 name / 客户端注册键）
  与对内插件 id `dsh-about`（cordis id / 路由前缀 / 分区 id）各司其职。
- 本插件**故意不声明任何 `@deepseek-ai/*` peer 依赖**：它是管更新的插件，必须在任何 dsh 版本下都能加载。
