# 发布到 npm（维护者向）

包以 **scoped 名 `@yannzhou/dsh-about`** 发布（npm 对无前缀裸包名无法按账号作用域授权写权限，故采用 scoped 名）。包结构已符合从 npm 直接安装的官方形态：`main` / `exports` / `dsh` 清单 / `files` 白名单 / `scripts` 齐全（无 `bin` 字段——内置看护脚本由插件内部引用，不作为 CLI 对外暴露）。

## 发布

**正常路径：推 tag，CI 自动发。** 合入 `main` 后推标签即可，不需要本地跑 `npm publish`：

```sh
git push origin main
git tag vX.Y.Z && git push origin vX.Y.Z
```

`.github/workflows/publish-npm.yml` 会在 tag 推上去后自动：校验 `tag == package.json.version` +
`docs/versions/vX.Y.Z.md` 存在 + 三个 JS `node --check` 通过 → 该版本没发过才 `npm publish` →
回读 npm 确认 → 建 GitHub Release（标题 = 纯版本号，正文 = 一行版本文档链接）。任一校验不过就红叉，
不会发出错版本；重复推 tag 或手工补跑（Actions → 发布到 npm → Run workflow）都会识别「已发布」并跳过。

**一次性配置**：仓库 Settings → Secrets and variables → Actions → 新建 secret `NPM_TOKEN`，
值是 npm 网页生成的 Granular Access Token（Read and write、勾 Bypass 2FA、限定 `@yannzhou/dsh-about`）。
本地 `gh secret set NPM_TOKEN` 交互式粘贴也行。没配这个 secret，CI 会在发布步骤失败。

**手工兜底**（CI 挂了 / 临时没配 secret）：

```sh
# 1) 确认已登录（whoami 应为 yannzhou）
npm whoami

# 2) 发布（access 已写死在 package.json 的 publishConfig，无需带参）
npm publish
```

## 发布后

CI 已自动建好 GitHub Release（插件「版本更新记录」拉的就是 GitHub Releases，只发 npm 不建 Release
用户端看不到新版本）。手工发布时记得自己补上：`gh release create vX.Y.Z --title vX.Y.Z --notes "版本说明见 [docs/versions/vX.Y.Z.md](https://github.com/YannZhou/dsh-about/blob/main/docs/versions/vX.Y.Z.md)"`。

无论哪条路径，都回读一次确认：`npm view @yannzhou/dsh-about version`、`gh release view vX.Y.Z`。

## 验证（匿名可查可装即成功）

```sh
npm view @yannzhou/dsh-about version        # 应输出版本号
dsh plugin --profile web add @yannzhou/dsh-about   # 匿名安装应成功
```

> 不要用 `npm install -g` 验证：那会装到全局 npm 目录，与 dsh 的 profile 安装无关，且可能触发权限问题。

## 已知注意点

- **发布后 24 小时内，pnpm 默认安装会回退到旧版**：pnpm 的 minimumReleaseAge 门禁认为新版本太年轻，静默保留上一版本且不报错。要立刻验证最新版，请显式指定版本：`dsh plugin add @yannzhou/dsh-about@X.Y.Z`。
- **scoped 包默认 private**：`publishConfig.access=public` 已写入 package.json，直接 `npm publish` 即可公开；若在别处手动发布，务必带 `--access public`。
- **两层名字别混淆**：对外包名 `@yannzhou/dsh-about`（npm / 依赖清单 / patch 层 name / 客户端注册键）与对内插件 id `dsh-about`（cordis id / 路由 / 分区 id）各司其职。发布前核对 `cordis.patch.yml` 的 name 与 `lib/client.js` 的 `load({ id })` 均等于包名——dsh 0.1.2+ 按包名建客户端图，写裸名会导致「关于」分区静默不渲染。

## 随包发布的文档

`package.json` 的 `files` 白名单包含 `README.md`、`AI-INSTALL.md`、`LICENSE`、`assets/`、`docs/`、`screenshots.json`（市场详情截图声明），随 npm 包一并分发。
