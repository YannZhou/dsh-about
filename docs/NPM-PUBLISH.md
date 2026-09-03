# 发布到 npm（维护者向）

包已发布为 **scoped 包 `@yannzhou/dsh-about`**（npm Granular 令牌体系下对
无前缀裸包名无法授予写权限，故采用与账号作用域一致的 scoped 名）。包结构已符合
从 npm 直接安装的官方形态（main/exports/dsh./files/bin/scripts 齐备）。

## 发布

```sh
# 1) 先登录/准备有 @yannzhou 作用域写权限的令牌（whoami 应为 yannzhou）
# 2) scoped 包默认走 private，必须显式 --access public 才能公开分发
npm publish --access public
```

## 验证（匿名可查可装即成功）

```sh
npm view @yannzhou/dsh-about version        # 应输出版本号
npm install -g @yannzhou/dsh-about          # 匿名安装应成功
```

npm 安装来源：`dsh plugin --profile web add @yannzhou/dsh-about`。

> **区分两层名字，别混淆**：
> - **npm 包名 / profile 依赖名 / patch 层 `name`**：`@yannzhou/dsh-about`。`remove` 与
>   `dependencies` / `bundles` 清单都用它：
>   `dsh plugin --profile web remove @yannzhou/dsh-about`。
> - **cordis id / 插件内部标识**：`dsh-about`（由 `lib/index.js` 的 `export const name`、
>   HTTP 路由前缀 `/dsh-about/*`、设置分区 `id: "about"` 决定）。`--dump-config` 输出的层
>   `- id: dsh-about / name: '@yannzhou/dsh-about'` 就是这两层：`id` 是插件身份，`name` 是包名。
>
> **关键（新版 dsh）**：`cordis.patch.yml` 的 `name` 与 `lib/client.js` 的
> `window.__ModuleLoader__.load({ id })` 都**必须等于包名 `@yannzhou/dsh-about`**。dsh 0.1.2+
> 的客户端模块系统按「包自身 name」给插件建图；若写成裸名 `dsh-about`，客户端分区会静默不渲染
> （宿主路由正常、无报错）。发布前务必核对这两处与 `package.json` 的 `name` 一致。

## 随包发布的文档

`package.json` 的 `files` 字段已包含 `README.md`、`AI-INSTALL.md`、`LICENSE`、
`assets/`、`docs/` 随 npm 包分发；`docs/` 下的安装手册与架构文档发布后同样可查。
