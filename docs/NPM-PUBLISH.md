# 发布到 npm（维护者向）

包以 **scoped 名 `@yannzhou/dsh-about`** 发布（npm 对无前缀裸包名无法按账号作用域授权写权限，故采用 scoped 名）。包结构已符合从 npm 直接安装的官方形态：`main` / `exports` / `dsh` 清单 / `files` 白名单 / `scripts` 齐全（无 `bin` 字段——内置看护脚本由插件内部引用，不作为 CLI 对外暴露）。

## 发布

```sh
# 1) 确认已登录（whoami 应为 yannzhou）
npm whoami

# 2) 发布（access 已写死在 package.json 的 publishConfig，无需带参）
npm publish
```

## 发布后（必做）

1. **打 tag 并推 GitHub**（保持 npm 版本与仓库 tag 对齐）：
   ```sh
   git tag vX.Y.Z && git push origin vX.Y.Z
   ```
2. **创建 GitHub Release**：插件「版本更新记录」拉的就是 GitHub Releases，只发 npm 不建 Release，用户端看不到新版本。用 `gh release create` 或网页创建，写清这版改了什么。

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
