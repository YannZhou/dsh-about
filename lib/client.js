// dsh-about — 设置中心「关于」分区的浏览器半体。
//
// 注册一个 settings.section 分区（id: "about"，导航标签「关于」），
// 页面内容：DeepSeek 官方图标、产品名（页面右上角为 GitHub 项目主页图标）、平台 / 当前版本 / 插件版本，
// 「检查更新」（npm latest+next 取新）+「一键更新」（npm install -g），
// 以及底部「版本更新记录」（官方 GitHub Releases，最多 10 个版本）：
// 每日首次打开自动拉取一次（内容与日期标记由宿主落盘到本地电脑），其余时间仅点「刷新」才拉取。
// 版本与更新数据来自宿主半体的 /dsh-about 路由（见 ./index.js）。
window.__ModuleLoader__.load({
	id: "@yannzhou/dsh-about",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		const React = require("react");
		const { useState, useEffect, useRef } = React;
		const h = React.createElement;

		const PLUGIN_ID = "dsh-about";
		const NS = "ui-about";
		const ENDPOINT = "/dsh-about";
		/** 安装过程发生自动修复（npm 12 脚本拦截）时的提示文案。 */
		const SELF_HEALED_NOTE = "注：安装时自动修复了 npm 12 拦截原生依赖安装脚本的问题（已带官方 allow-scripts 白名单重装一次）。";
		/** 给用户看的「手动安装」命令里的 allow-scripts 白名单。
		 *  与宿主侧 lib/index.js 的 allowScriptsNames() 同口径（静态表部分）：
		 *  npm ≥ 12 需放行这些原生依赖的安装脚本，否则会被拦截、装完 dsh 打不开。
		 *  用官方机制而不是即将被移除的 --dangerously-allow-all-scripts。
		 *  ⚠️ 与 lib/index.js 的 DSHA_KNOWN_NATIVE_DEPS 保持同步。 */
		/** 本插件自身的版本查询接口（宿主半体：已装版本 / 安装形态 / npm 最新版本）。 */
		const PLUGIN_ENDPOINT = ENDPOINT + "/plugin";
		/** 本插件在 npm / GitHub 上的对外包名与仓库（自更新走的是这个包名）。 */
		const PLUGIN_PKG = "@yannzhou/dsh-about";
		const PLUGIN_REPO = "https://github.com/YannZhou/dsh-about";
		/** 作者署名：显示在「关于」面板，装上本插件的人打开「关于」即可看到出处。 */
		const AUTHOR = "YannZhou";
		const AUTHOR_URL = "https://github.com/YannZhou";
		/** 固定公告标识，不随版本号变化；按当前浏览器、站点记住已展示状态。 */
		const PLATFORM_NOTICE_KEY = "dsh-about:notice:desktop-platform-support";
		let platformNoticeSeen = false;
		function claimPlatformNotice(platform) {
			// 以宿主 /describe 为准，避免 Windows/macOS 浏览器访问 Linux 服务时误弹。
			if (typeof platform !== "string" || !/^(win32|darwin)(?:\s|$)/.test(platform) || platformNoticeSeen) return false;
			platformNoticeSeen = true;
			try {
				if (window.localStorage.getItem(PLATFORM_NOTICE_KEY) === "seen") return false;
				window.localStorage.setItem(PLATFORM_NOTICE_KEY, "seen");
			} catch { /* 存储被禁用时，至少保证当前页面生命周期内只展示一次。 */ }
			return true;
		}
		/** 「关于」导航红点控制器：由 apply() 创建、AboutSection 通过它上报「有无新版」。 */
		let navDotCtl = null;

		/* ───────────── 安装期「白屏自救」守卫 ─────────────
		 * 背景（Windows 侧实机复现并抓到完整证据）：
		 *   `npm install -g` 期间，前端与各客户端插件的 bundle 会被**就地替换**；
		 *   仍在运行的旧宿主按**旧的 rev 哈希**去取新文件 → `/plugins/??…&rev=xxx` 返回 404
		 *   → 客户端插件加载失败 → `SlotAssemblyError` → React 树整体卸载 → 页面变成空白
		 *   （实测 body.innerText.length = 0，且此后 150 秒**永不自行恢复**）。
		 *
		 * 为什么插件自己必须兜底：页面崩掉时 AboutSection 也被卸载，插件原有的
		 * 「等 nonce 变化 → location.reload()」轮询随之停止（`mountedRef` 变 false 后
		 * 轮询直接 return），于是**再也没有任何人去刷新页面**，用户只能手动按 F5。
		 *
		 * 守卫因此**挂在模块作用域而不是 React 副作用里**（组件卸载不会撤掉它），
		 * 只做一件事：安装窗口内发现页面已崩成空白，就等服务端重新应答后自动刷新。
		 * 误触发风险极低：只在安装/重启窗口内布防，且要求连续两次探测到空白才动作。 */
		let whiteScreenGuard = null;
		function armWhiteScreenGuard() {
			if (whiteScreenGuard !== null || typeof window === "undefined") return;
			const state = { crashed: false, emptyStreak: 0, done: false };
			const markCrashed = () => { state.crashed = true; };
			window.addEventListener("error", markCrashed);
			window.addEventListener("unhandledrejection", markCrashed);
			const timer = setInterval(async () => {
				if (state.done || !state.crashed) return;
				// 已判定崩溃：等服务端能正常应答（重启完成的新进程）再刷新，
				// 否则会刷出浏览器的「无法连接」错误页。
				try {
					const r = await fetch(ENDPOINT + "/describe", { cache: "no-store" });
					if (!r.ok) return;
				} catch {
					return;
				}
				if (state.done) return;
				state.done = true;
				clearInterval(timer);
				window.removeEventListener("error", markCrashed);
				window.removeEventListener("unhandledrejection", markCrashed);
				location.reload();
			}, 2000);
			// 双保险：未抛异常但页面已被清空的场景（例如宿主直接换掉了 DOM）
			const watcher = setInterval(() => {
				if (state.done) { clearInterval(watcher); return; }
				if (document.body.innerText.trim().length === 0) {
					if (++state.emptyStreak >= 2) state.crashed = true;
				} else {
					state.emptyStreak = 0;
				}
			}, 1000);
			// 兜底自动收摊：避免守卫在「安装其实没崩」的情况下长期占用一个定时器
			setTimeout(() => {
				if (state.done) return;
				state.done = true;
				clearInterval(timer);
				clearInterval(watcher);
				window.removeEventListener("error", markCrashed);
				window.removeEventListener("unhandledrejection", markCrashed);
			}, 15 * 60 * 1000);
			whiteScreenGuard = { state, timer, watcher };
		}
		/** 版本记录的内容缓存与「当日已尝试」标记不再存浏览器 localStorage，
		 * 而是由宿主半体落到本地磁盘（$DSH_HOME/dsh-about/releases-cache.json）。
		 * 浏览器侧只负责请求 /dsh-about/releases 并渲染结果。 */

		/* ───────────── 官方 DeepSeek 标识（与前端 favicon.svg 同款路径） ───────────── */
		const LOGO_PATH =
			"M48.8354 10.0479C48.3232 9.79199 48.1025 10.2798 47.8032 10.5278C47.7007 10.6079 47.6143 10.7119 47.5273 10.8076C46.7793 11.624 45.9048 12.1597 44.7622 12.0957C43.0923 12 41.666 12.5356 40.4058 13.8398C40.1377 12.2319 39.2476 11.272 37.8926 10.6558C37.1836 10.3359 36.4668 10.0156 35.9702 9.31982C35.6235 8.82373 35.5293 8.27197 35.356 7.72754C35.2456 7.3999 35.1353 7.06396 34.7651 7.00781C34.3633 6.94385 34.2056 7.2876 34.0479 7.57568C33.418 8.75195 33.1733 10.0479 33.1973 11.3599C33.2524 14.312 34.4736 16.6641 36.8999 18.3359C37.1758 18.5278 37.2466 18.7197 37.1597 19C36.9946 19.5757 36.7974 20.1357 36.624 20.7119C36.5137 21.0801 36.3486 21.1597 35.9624 21C34.6309 20.4321 33.481 19.5918 32.4644 18.5757C30.7393 16.8721 29.1792 14.9917 27.2334 13.52C26.7764 13.1758 26.3193 12.856 25.8467 12.5518C23.8618 10.584 26.1069 8.96777 26.627 8.77588C27.1704 8.57568 26.8159 7.8877 25.0591 7.896C23.3022 7.90381 21.6953 8.50391 19.647 9.30371C19.3477 9.42383 19.0322 9.51172 18.7095 9.58398C16.8501 9.22363 14.9199 9.14355 12.9033 9.37598C9.10596 9.80762 6.07275 11.6396 3.84326 14.7681C1.16455 18.5278 0.53418 22.7998 1.30664 27.2559C2.11768 31.9521 4.46582 35.8398 8.07373 38.8799C11.8159 42.0322 16.1255 43.5762 21.041 43.2803C24.0269 43.104 27.3516 42.6963 31.1016 39.4561C32.0469 39.936 33.0396 40.1279 34.686 40.272C35.9546 40.3921 37.1758 40.208 38.1211 40.0078C39.6021 39.688 39.4995 38.2881 38.9639 38.0322C34.623 35.9678 35.5762 36.8081 34.71 36.1279C36.9155 33.4639 40.2402 30.6958 41.54 21.728C41.6426 21.0161 41.5557 20.5679 41.54 19.9917C41.5322 19.6396 41.6108 19.5039 42.0049 19.4639C43.0923 19.3359 44.1479 19.0317 45.1167 18.4878C47.9292 16.9199 49.064 14.3438 49.3315 11.2559C49.3711 10.7837 49.3237 10.2959 48.8354 10.0479ZM24.3262 37.8398C20.1196 34.4639 18.0791 33.3521 17.2358 33.3999C16.4482 33.4482 16.5898 34.3682 16.7632 34.9678C16.9443 35.5601 17.1812 35.9683 17.5117 36.4878C17.7402 36.832 17.8979 37.3442 17.2832 37.728C15.9282 38.584 13.5728 37.4399 13.4624 37.3838C10.7207 35.7358 8.42822 33.5601 6.81348 30.584C5.25342 27.7197 4.34766 24.6479 4.19775 21.3677C4.1582 20.5757 4.38672 20.2959 5.15869 20.1519C6.17529 19.96 7.22314 19.9199 8.23926 20.0718C12.5327 20.7119 16.1885 22.6719 19.2529 25.7759C21.002 27.5439 22.3252 29.6558 23.6885 31.7202C25.1377 33.9121 26.6978 36 28.6831 37.7119C29.3843 38.312 29.9434 38.7681 30.479 39.104C28.8643 39.2881 26.1699 39.3281 24.3262 37.8398ZM26.3433 24.6001C26.3433 24.248 26.6191 23.9678 26.9658 23.9678C27.0444 23.9678 27.1152 23.9839 27.1782 24.0078C27.2651 24.04 27.3438 24.0879 27.4067 24.1602C27.5171 24.272 27.5801 24.4321 27.5801 24.6001C27.5801 24.9521 27.3042 25.2319 26.9575 25.2319C26.6108 25.2319 26.3433 24.9521 26.3433 24.6001ZM32.6064 27.8799C32.2046 28.0479 31.8027 28.1919 31.4165 28.208C30.8179 28.2397 30.1641 27.9922 29.8096 27.688C29.2583 27.2158 28.8643 26.9521 28.6987 26.1279C28.6279 25.7759 28.6675 25.2319 28.7305 24.9199C28.8721 24.248 28.7144 23.8159 28.2495 23.4238C27.8716 23.104 27.3911 23.0161 26.8633 23.0161C26.666 23.0161 26.4849 22.9277 26.3511 22.856C26.1304 22.7441 25.9492 22.4639 26.1226 22.1201C26.1777 22.0078 26.4458 21.7358 26.5088 21.688C27.2256 21.272 28.0527 21.4077 28.8169 21.7197C29.5259 22.0161 30.0615 22.5601 30.834 23.3281C31.6216 24.2559 31.7632 24.5117 32.2124 25.208C32.5669 25.752 32.8901 26.312 33.1104 26.9521C33.2446 27.3521 33.0713 27.6802 32.6064 27.8799Z";

		/* GitHub 官方 mark（simple-icons，24×24，fill 用 currentColor）：页面右上角的项目主页入口。 */
		const GITHUB_PATH = "M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12";

		/* ───────────── 样式（主题中立，跟随宿主主题规则） ───────────── */
		const CSS = `
.dsh-about { --dsh-about-gap: 10px; display: flex; flex-direction: column; gap: var(--dsh-about-gap); padding: 2px 2px 12px; font-family: inherit; color: var(--dsw-alias-label-primary, #1f1f1f); }
.dsh-about * { box-sizing: border-box; }
.dsh-about-hero { display: flex; align-items: flex-start; justify-content: space-between; gap: 14px; }
.dsh-about-hero-main { display: flex; align-items: center; gap: 14px; min-width: 0; }
.dsh-about-gh { flex: none; display: inline-flex; align-items: center; justify-content: center; width: 30px; height: 30px; border-radius: 8px; border: 1px solid rgba(128, 128, 128, 0.3); background: rgba(128, 128, 128, 0.06); color: var(--dsw-alias-label-secondary, #57606a); text-decoration: none; transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease; }
.dsh-about-gh:hover { background: rgba(128, 128, 128, 0.16); border-color: rgba(128, 128, 128, 0.45); color: var(--dsw-alias-label-primary, #1f1f1f); }
.dsh-about-gh:focus-visible { outline: 2px solid var(--dsw-static-blue-400, #0a66c2); outline-offset: 2px; }
.dsh-about-gh-icon { display: block; width: 17px; height: 17px; fill: currentColor; }
.dsh-about-logo { width: 52px; height: 52px; flex: none; color: #141414; }
.dsh-about-logo path { fill: currentColor; }
@media (prefers-color-scheme: dark) { .dsh-about-logo { color: #ffffff; } }
.dsh-about-name { font-size: 18px; font-weight: 700; line-height: 1.3; }
.dsh-about-sub { font-size: 13px; color: var(--dsw-alias-label-tertiary, #7a7a7a); margin-top: 3px; }
.dsh-about-rows { margin: 0; display: flex; flex-direction: column; }
.dsh-about-row { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 7px 0; border-bottom: 1px solid rgba(128, 128, 128, 0.22); font-size: 13.5px; }
.dsh-about-row:last-child { border-bottom: none; }
.dsh-about-row dt { color: var(--dsw-alias-label-tertiary, #7a7a7a); }
.dsh-about-row dd { margin: 0; font-variant-numeric: tabular-nums; text-align: right; overflow-wrap: anywhere; }
.dsh-about-row a { color: var(--dsw-static-blue-400, #0a66c2); text-decoration: none; }
/* 「作者」行与「更新源」分区相邻时抵扣容器的 10px 间距：
 * 否则这两条分隔线之间会比上面的行多出一截，作者行的行距看起来被拉开。 */
.dsh-about-rows + .dsh-about-source { margin-top: calc(-1 * var(--dsh-about-gap)); }
.dsh-about-update { display: flex; flex-direction: column; gap: 8px; padding-top: 0; }
.dsh-about-update-line { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
/* 报错历史：标题并入「检查更新」行末的感叹号，记录直接平铺在该行下方供选择 */
.dsh-about-history { display: flex; flex-direction: column; gap: 6px; }
.dsh-about-history-panel { display: flex; flex-direction: column; gap: 6px; max-height: 280px; overflow: auto; overscroll-behavior: contain; border: 1px solid rgba(128, 128, 128, 0.24); border-radius: 8px; padding: 6px; background: rgba(128, 128, 128, 0.04); }
.dsh-about-history-item { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; padding: 7px 9px; border-radius: 6px; background: rgba(128, 128, 128, 0.06); }
/* 已覆盖的旧记录只出现在悬停预览/二级菜单里，发灰提示它们在磁盘保留但无需再处理 */
.dsh-about-history-item-old { opacity: 0.7; }

.dsh-about-history-main { min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.dsh-about-history-title { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; font-size: 12.5px; font-weight: 600; }
.dsh-about-history-badge { font-size: 11px; padding: 0 6px; border-radius: 999px; background: rgba(207, 34, 46, 0.12); color: var(--dsw-alias-state-error-primary, #cf222e); font-weight: 600; }
.dsh-about-history-summary { font-size: 12px; line-height: 1.45; color: var(--dsw-alias-label-secondary, #57606a); word-break: break-all; }
.dsh-about-history-meta { font-size: 11px; color: var(--dsw-alias-label-tertiary, #7a7a7a); }
.dsh-about-history-actions { display: inline-flex; gap: 6px; flex: none; }
.dsh-about-history-actions .dsh-about-btn { padding: 3px 9px; font-size: 12px; }
/* 「检查更新」右侧的感叹号：悬停预览全部报错，点击打开可滚动的报错历史二级菜单 */
.dsh-about-bang { position: relative; display: inline-flex; align-items: center; flex: none; }
.dsh-about-bang-btn { display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; padding: 0; border-radius: 50%; border: 1px solid rgba(154, 103, 0, 0.45); background: rgba(154, 103, 0, 0.14); color: var(--dsw-alias-state-warn-primary, #9a6700); font: inherit; font-size: 14px; font-weight: 700; line-height: 1; cursor: pointer; transition: background 0.15s ease, border-color 0.15s ease; }
.dsh-about-bang-btn:hover { background: rgba(154, 103, 0, 0.26); border-color: var(--dsw-alias-state-warn-primary, #9a6700); }
.dsh-about-bang-btn:focus-visible { background: rgba(154, 103, 0, 0.26); border-color: var(--dsw-alias-state-warn-primary, #9a6700); outline: 2px solid var(--dsw-static-blue-400, #0a66c2); outline-offset: 2px; }
/* 没有待处理报错时仍保留入口，但退成中性色；历史记录依旧可查 */
.dsh-about-bang-btn-idle { border-color: rgba(128, 128, 128, 0.34); background: rgba(128, 128, 128, 0.08); color: var(--dsw-alias-label-tertiary, #7a7a7a); }
/* 宽度按视口留出左侧内容区，避免在窄屏/移动布局下被设置面板右边缘裁掉 */
.dsh-about-bang-menu { display: none; position: absolute; top: calc(100% + 8px); left: 0; z-index: 1000; flex-direction: column; gap: 6px; width: min(380px, calc(100vw - 140px)); max-height: 300px; padding: 8px; border: 1px solid rgba(128, 128, 128, 0.28); border-radius: 8px; background: var(--dsw-alias-bg-layer-3, #ffffff); color: var(--dsw-alias-label-primary, #1f1f1f); box-shadow: 0 6px 20px rgba(0, 0, 0, 0.18); animation: dsh-about-bang-in 0.14s ease-out; }
/* 悬停预览只跟随鼠标；键盘用户走点击打开的二级菜单，避免关闭弹窗后焦点回落又自动弹开预览 */
.dsh-about-bang:hover .dsh-about-bang-menu { display: flex; }
/* 菜单与感叹号之间留 8px，用透明伪元素搭桥，鼠标移进菜单时不会中途收起 */
.dsh-about-bang-menu::before { content: ""; position: absolute; left: 0; right: 0; top: -8px; height: 8px; }
/* 向上翻转时桥接在菜单下沿，仍然覆盖菜单与感叹号之间的缝隙 */
.dsh-about-bang-menu-up::before { top: auto; bottom: -8px; }
@keyframes dsh-about-bang-in { from { opacity: 0; transform: translateY(-3px); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) { .dsh-about-bang-menu { animation: none; } }
.dsh-about-bang-head { display: flex; align-items: baseline; gap: 6px; flex-wrap: wrap; }
.dsh-about-bang-title { font-size: 12.5px; font-weight: 700; }
.dsh-about-bang-list { display: flex; flex-direction: column; gap: 4px; max-height: 220px; overflow: auto; overscroll-behavior: contain; }
.dsh-about-bang-item { display: flex; flex-direction: column; gap: 2px; width: 100%; padding: 6px 8px; border: none; border-radius: 6px; background: none; color: inherit; font: inherit; text-align: left; cursor: pointer; }
.dsh-about-bang-item:hover { background: rgba(128, 128, 128, 0.1); }
.dsh-about-bang-item-old { opacity: 0.7; }
.dsh-about-bang-item-head { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; font-size: 12.5px; font-weight: 600; }
.dsh-about-bang-item-time { font-size: 11px; font-weight: 400; color: var(--dsw-alias-label-tertiary, #7a7a7a); }
.dsh-about-bang-item-summary { overflow: hidden; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 1; font-size: 12px; line-height: 1.4; color: var(--dsw-alias-label-secondary, #57606a); word-break: break-all; }
.dsh-about-bang-empty { padding: 8px; font-size: 12px; color: var(--dsw-alias-label-tertiary, #7a7a7a); }
.dsh-about-history-dialog-list { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; gap: 6px; max-height: 54vh; overflow: auto; overscroll-behavior: contain; padding-right: 2px; }
.dsh-about-btn { font-family: inherit; font-size: 13.5px; padding: 7px 14px; border-radius: 6px; cursor: pointer; border: 1px solid rgba(128, 128, 128, 0.4); background: var(--dsw-alias-bg-layer-2, #f5f5f5); color: var(--dsw-alias-label-primary, #1f1f1f); }
.dsh-about-btn:hover:not(:disabled) { background: var(--dsw-alias-bg-layer-3, #ffffff); }
.dsh-about-btn:disabled { opacity: 0.55; cursor: default; }
.dsh-about-btn-primary { background: var(--dsw-static-blue-400, #0a66c2); color: #ffffff; border-color: transparent; }
.dsh-about-btn-primary:hover:not(:disabled) { background: #0958b0; }
.dsh-about-status { font-size: 13px; display: inline-flex; align-items: center; gap: 6px; }
.dsh-about-status-ok { color: var(--dsw-alias-state-success-primary, #1a7f37); }
.dsh-about-status-warn { color: var(--dsw-alias-state-warn-primary, #9a6700); }
.dsh-about-compat-line { display: flex; flex-direction: column; gap: 8px; width: 100%; margin-top: 2px; }
.dsh-about-compat-summary { position: relative; display: inline-flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.dsh-about-compat-toggle { background: none; border: none; padding: 0; color: var(--dsw-static-blue-400, #0a66c2); cursor: pointer; text-decoration: underline; font-size: 13px; font-family: inherit; }
.dsh-about-compat-toggle:hover { opacity: 0.85; }
.dsh-about-compat-icon-wrap { display: inline-flex; align-items: center; justify-content: center; cursor: help; }
.dsh-about-compat-icon-wrap:focus-visible { outline: 2px solid var(--dsw-static-blue-400, #0a66c2); outline-offset: 3px; border-radius: 50%; }
.dsh-about-compat-icon { display: inline-flex; align-items: center; justify-content: center; width: 16px; height: 16px; border-radius: 50%; background: var(--dsw-alias-state-warn-primary, #9a6700); color: #ffffff; font-size: 11px; font-weight: 700; line-height: 1; user-select: none; }
.dsh-about-compat-menu { display: none; position: absolute; left: 0; bottom: calc(100% + 8px); width: max-content; max-width: min(320px, 100%); padding: 8px 12px; background: var(--dsw-alias-bg-layer-3, #ffffff); color: var(--dsw-alias-label-primary, #1f1f1f); border: 1px solid rgba(128, 128, 128, 0.28); border-radius: 8px; box-shadow: 0 4px 16px rgba(0, 0, 0, 0.16); font-size: 12px; font-weight: normal; line-height: 1.5; z-index: 1000; pointer-events: none; white-space: normal; }
.dsh-about-compat-icon-wrap:hover .dsh-about-compat-menu,
.dsh-about-compat-icon-wrap:focus-within .dsh-about-compat-menu { display: block; }
.dsh-about-compat-details { padding: 10px 14px; background: rgba(154, 103, 0, 0.06); border: 1px solid rgba(154, 103, 0, 0.22); border-radius: 8px; font-size: 12.5px; line-height: 1.6; color: var(--dsw-alias-label-primary, #1f1f1f); }
.dsh-about-compat-list { margin: 0; padding-left: 18px; }
.dsh-about-compat-item { margin: 4px 0; word-break: break-all; }
.dsh-about-compat-item strong { color: var(--dsw-alias-state-warn-primary, #9a6700); }
.dsh-about-status-err { color: var(--dsw-alias-state-error-primary, #cf222e); }
.dsh-about-muted { color: var(--dsw-alias-label-tertiary, #7a7a7a); font-size: 12.5px; line-height: 1.6; }
.dsh-about-tail { margin: 0; max-height: 140px; overflow: auto; white-space: pre-wrap; word-break: break-all; font-size: 11.5px; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; background: rgba(128, 128, 128, 0.1); border-radius: 6px; padding: 8px 10px; color: var(--dsw-alias-label-primary, #1f1f1f); }
.dsh-about-releases { margin-top: 0; border-top: 1px solid rgba(128, 128, 128, 0.22); padding-top: 8px; }
.dsh-about-releases-head { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; flex-wrap: wrap; }
.dsh-about-releases-title { font-size: 14.5px; font-weight: 700; }
.dsh-about-refresh { margin-left: auto; padding: 3px 12px; font-size: 12px; border-radius: 6px; }
.dsh-about-release { border: 1px solid rgba(128, 128, 128, 0.24); border-radius: 8px; padding: 10px 12px 8px; margin-bottom: 10px; }
.dsh-about-release-head { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
.dsh-about-release-ver { font-weight: 700; font-size: 14px; }
.dsh-about-release-badge { font-size: 11px; padding: 1px 7px; border-radius: 999px; background: rgba(10, 102, 194, 0.1); color: var(--dsw-static-blue-400, #0a66c2); }
.dsh-about-release-hot { font-size: 11px; padding: 1px 7px; border-radius: 999px; background: rgba(26, 127, 55, 0.12); color: var(--dsw-alias-state-success-primary, #1a7f37); font-weight: 600; }
.dsh-about-release-badge-unsynced { font-size: 11px; padding: 1px 7px; border-radius: 999px; background: rgba(154, 103, 0, 0.14); color: var(--dsw-alias-state-warn-primary, #9a6700); }
.dsh-about-badge-alpha { font-size: 11px; padding: 1px 7px; border-radius: 999px; background: rgba(207, 34, 46, 0.12); color: #cf222e; font-weight: 600; }
.dsh-about-badge-beta { font-size: 11px; padding: 1px 7px; border-radius: 999px; background: rgba(154, 103, 0, 0.14); color: var(--dsw-alias-state-warn-primary, #9a6700); font-weight: 600; }
.dsh-about-prerelease-warn { font-size: 12.5px; line-height: 1.6; display: flex; gap: 6px; padding: 7px 10px; border-radius: 6px; background: rgba(207, 34, 46, 0.08); border: 1px solid rgba(207, 34, 46, 0.28); color: #cf222e; }
.dsh-about-prerelease-warn-beta { background: rgba(154, 103, 0, 0.08); border-color: rgba(154, 103, 0, 0.32); color: var(--dsw-alias-state-warn-primary, #9a6700); }
.dsh-about-release-h { font-size: 13px; margin: 8px 0 4px; }
.dsh-about-release ul { margin: 4px 0; padding-left: 18px; }
.dsh-about-release li, .dsh-about-release p { font-size: 12.5px; line-height: 1.6; margin: 3px 0; }
.dsh-about-release-head { cursor: pointer; user-select: none; -webkit-user-select: none; }
.dsh-about-release-head:hover { opacity: 0.85; }
.dsh-about-release-toggle { margin-left: auto; flex: none; width: 24px; height: 24px; display: inline-flex; align-items: center; justify-content: center; border-radius: 50%; background: rgba(10, 102, 194, 0.1); color: var(--dsw-static-blue-400, #0a66c2); transition: background 0.15s ease; }
.dsh-about-release-toggle:hover { background: rgba(10, 102, 194, 0.22); }
.dsh-about-release-arrow { display: inline-block; width: 0; height: 0; border-left: 6px solid transparent; border-right: 6px solid transparent; border-top: 8px solid currentColor; transition: transform 0.18s ease; }
.dsh-about-release-arrow-open { transform: rotate(180deg); }
.dsh-about-release-body { overflow: hidden; transition: max-height 0.24s ease, opacity 0.2s ease; }
@media (prefers-reduced-motion: reduce) {
	.dsh-about-release-body { transition: none; }
}
.dsh-about-overlay { position: fixed; inset: 0; z-index: 99998; display: flex; align-items: center; justify-content: center; background: rgba(0, 0, 0, 0.35); padding: 24px; }
.dsh-about-dialog { width: min(480px, 94vw); max-height: 84vh; display: flex; flex-direction: column; gap: 14px; background: var(--dsw-alias-bg-layer-3, #ffffff); color: var(--dsw-alias-label-primary, #1f1f1f); border: 1px solid rgba(128, 128, 128, 0.35); border-radius: 12px; padding: 20px 22px; box-shadow: 0 12px 40px rgba(0, 0, 0, 0.25); }
.dsh-about-dialog-title { font-size: 15.5px; font-weight: 700; line-height: 1.35; margin: 0; }
.dsh-about-dialog-hints { display: flex; flex-direction: column; gap: 6px; }
.dsh-about-versions { display: flex; flex-direction: column; gap: 8px; overflow: auto; padding: 2px 0 4px; }
.dsh-about-version { display: flex; align-items: center; gap: 10px; padding: 11px 14px; border: 1px solid rgba(128, 128, 128, 0.28); border-radius: 8px; cursor: pointer; font-size: 13.5px; line-height: 1.4; }
.dsh-about-version:hover { border-color: var(--dsw-static-blue-400, #0a66c2); }
.dsh-about-version-sel { border-color: var(--dsw-static-blue-400, #0a66c2); background: rgba(10, 102, 194, 0.06); }
.dsh-about-version:focus-visible { outline: 2px solid var(--dsw-static-blue-400, #0a66c2); outline-offset: 1px; }
.dsh-about-version-radio { width: 14px; flex: none; font-size: 11px; color: var(--dsw-static-blue-400, #0a66c2); text-align: center; }
.dsh-about-version-no { font-variant-numeric: tabular-nums; }
.dsh-about-dialog-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 4px; padding-top: 12px; border-top: 1px solid rgba(128, 128, 128, 0.18); }
.dsh-about-fail-badge { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; font-weight: 600; color: #cf222e; background: rgba(207, 34, 46, 0.1); padding: 1px 8px; border-radius: 999px; }
.dsh-about-fail-icon { width: 13px; height: 13px; flex: none; fill: #cf222e; }
.dsh-about-failure-card { border: 1px solid rgba(207, 34, 46, 0.28); background: rgba(207, 34, 46, 0.04); border-radius: 8px; padding: 12px 14px; display: flex; flex-direction: column; gap: 10px; width: 100%; margin-top: 4px; box-sizing: border-box; }
.dsh-about-failure-summary { display: flex; align-items: center; justify-content: space-between; gap: 10px; cursor: pointer; font-size: 13.5px; font-weight: 600; color: var(--dsw-alias-state-error-primary, #cf222e); list-style: none; user-select: none; }
.dsh-about-failure-summary::-webkit-details-marker { display: none; }
.dsh-about-failure-summary-title { display: inline-flex; align-items: center; gap: 7px; min-width: 0; }
.dsh-about-failure-body { display: flex; flex-direction: column; gap: 9px; padding-top: 4px; }
.dsh-about-failure-callout { padding: 9px 12px; background: rgba(207, 34, 46, 0.07); border: 1px solid rgba(207, 34, 46, 0.22); border-radius: 6px; font-size: 12.5px; line-height: 1.5; color: var(--dsw-alias-label-primary, #1f1f1f); word-break: break-all; }
.dsh-about-failure-rollback { font-size: 12px; color: var(--dsw-alias-state-success-primary, #1a7f37); margin-top: 4px; font-weight: 500; }
.dsh-about-failure-actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-top: 2px; }
.dsh-about-dialog-wide { width: min(580px, 94vw); }
.dsh-about-fail-view { display: flex; flex-direction: column; gap: 12px; }
.dsh-about-fail-callout { padding: 10px 14px; background: rgba(207, 34, 46, 0.07); border: 1px solid rgba(207, 34, 46, 0.24); border-radius: 8px; display: flex; flex-direction: column; gap: 6px; }
.dsh-about-fail-header-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
.dsh-about-update .joi-face, .dsh-about-dialog .joi-face, .dsh-about-overlay .joi-face, .dsh-about-failure-card .joi-face, .dsh-about-fail-callout .joi-face, .dsh-about-failure-callout .joi-face { display: none !important; }
.dsh-about-status-ok-badge { font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 999px; background: rgba(26, 127, 55, 0.12); color: var(--dsw-alias-state-success-primary, #1a7f37); }
.dsh-about-fail-summary-text { font-size: 12.5px; line-height: 1.5; color: var(--dsw-alias-label-primary, #1f1f1f); word-break: break-all; }
.dsh-about-fail-steps { display: flex; flex-direction: column; gap: 6px; }
.dsh-about-fail-section-header { font-size: 12.5px; font-weight: 600; color: var(--dsw-alias-label-secondary, #57606a); }
.dsh-about-fail-steps-list { display: flex; flex-direction: column; gap: 5px; }
.dsh-about-fail-step-item { display: flex; align-items: center; gap: 8px; font-size: 12px; flex-wrap: wrap; padding: 5px 10px; background: rgba(128, 128, 128, 0.06); border-radius: 6px; }
.dsh-about-step-tag { font-size: 11px; padding: 1px 7px; border-radius: 4px; font-weight: 600; }
.dsh-about-step-pass { background: rgba(26, 127, 55, 0.14); color: var(--dsw-alias-state-success-primary, #1a7f37); }
.dsh-about-step-fail { background: rgba(207, 34, 46, 0.14); color: #cf222e; }
.dsh-about-step-name { font-weight: 600; }
.dsh-about-step-dep { color: var(--dsw-alias-label-tertiary, #7a7a7a); font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
.dsh-about-fail-details-wrap { display: flex; flex-direction: column; gap: 6px; }
.dsh-about-tail-dialog { max-height: 200px; }
.dsh-about-fail-hint { font-size: 12px; line-height: 1.5; padding: 8px 12px; border-radius: 6px; background: rgba(10, 102, 194, 0.06); border: 1px solid rgba(10, 102, 194, 0.2); color: var(--dsw-alias-label-primary, #1f1f1f); }
.dsh-about-success-overlay { position: fixed; inset: 0; z-index: 99999; display: flex; align-items: center; justify-content: center; background: rgba(0, 0, 0, 0.25); }
.dsh-about-success-card { display: flex; flex-direction: column; align-items: center; gap: 14px; background: var(--dsw-alias-bg-layer-3, #ffffff); color: var(--dsw-alias-label-primary, #1f1f1f); border-radius: 16px; padding: 26px 44px; box-shadow: 0 12px 40px rgba(0, 0, 0, 0.22); animation: dsh-about-success-pop 0.3s ease-out; }
.dsh-about-success-icon { width: 56px; height: 56px; }
.dsh-about-success-circle { fill: none; stroke: #34c759; stroke-width: 2.5; }
.dsh-about-success-check { fill: none; stroke: #34c759; stroke-width: 5; stroke-linecap: round; stroke-linejoin: round; stroke-dasharray: 64; stroke-dashoffset: 64; animation: dsh-about-success-draw 0.45s ease-out 0.15s forwards; }
.dsh-about-success-text { font-size: 16px; font-weight: 600; }
.dsh-about-source { margin-top: 0; border-top: 1px solid rgba(128, 128, 128, 0.22); padding-top: 8px; }
.dsh-about-source-head { display: flex; align-items: center; gap: 8px; margin-bottom: 0; flex-wrap: wrap; }
.dsh-about-source-title { font-size: 14.5px; font-weight: 700; }
.dsh-about-source-hint { font-size: 12px; line-height: 1.5; color: var(--dsw-alias-label-tertiary, #7a7a7a); margin-bottom: 6px; }
/* GitHub 认证：与「更新源」同款分隔线 + 一行输入框（password，绝不回显明文） */
.dsh-about-auth { margin-top: 0; border-top: 1px solid rgba(128, 128, 128, 0.22); padding-top: 8px; }
.dsh-about-auth-head { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; flex-wrap: wrap; }
.dsh-about-auth-title { font-size: 14.5px; font-weight: 700; }
.dsh-about-auth-state { font-size: 12px; color: var(--dsw-alias-label-tertiary, #7a7a7a); }
.dsh-about-auth-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-top: 8px; }
.dsh-about-auth-input { flex: 1 1 240px; min-width: 180px; padding: 6px 10px; border: 1px solid rgba(128, 128, 128, 0.32); border-radius: 6px; background: rgba(128, 128, 128, 0.06); color: inherit; font-size: 13px; font-family: inherit; }
.dsh-about-auth-input:focus { outline: none; border-color: var(--dsw-static-blue-400, #0a66c2); }
.dsh-about-auth-input:disabled { opacity: 0.6; }
/* 认证区标题行右侧的两个入口按钮：靠右对齐，当前展开的高亮 */
.dsh-about-auth-actions { margin-left: auto; display: inline-flex; align-items: center; gap: 8px; }
/* 未认证提醒：标题行下方一整行红字（未认证走出口 IP 的 60 次/小时匿名配额） */
.dsh-about-auth-warn { display: flex; font-size: 12.5px; }
.dsh-about-btn-on { border-color: var(--dsw-static-blue-400, #0a66c2); color: var(--dsw-static-blue-400, #0a66c2); background: rgba(96, 165, 250, 0.12); }
.dsh-about-btn-on:hover:not(:disabled) { background: rgba(96, 165, 250, 0.18); }
/* 二级面板：与标题行之间保持 8px 节奏（与相邻 margin 折叠后即为 8px） */
.dsh-about-auth-panel { margin-top: 8px; }
/* 面板内的状态行此前紧贴上一行（3px），这里补到与其他行一致的 8px */
.dsh-about-auth-panel .dsh-about-status { margin-top: 8px; }
/* 设备码：等宽带字距，便于逐字核对 */
.dsh-about-device-code { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-top: 8px; }
.dsh-about-device-code-value { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 16px; font-weight: 700; letter-spacing: 1.5px; padding: 6px 12px; border-radius: 6px; background: rgba(128, 128, 128, 0.12); color: inherit; }
.dsh-about-source-select { display: inline-flex; align-items: center; gap: 8px; padding: 5px 10px; border: 1px solid rgba(128, 128, 128, 0.32); border-radius: 6px; cursor: pointer; font-size: 13px; user-select: none; -webkit-user-select: none; background: rgba(128, 128, 128, 0.06); min-width: 220px; }
.dsh-about-source-select:hover { border-color: var(--dsw-static-blue-400, #0a66c2); background: rgba(128, 128, 128, 0.1); }
.dsh-about-source-select-value { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsh-about-source-select-arrow { flex: none; font-size: 11px; color: var(--dsw-alias-label-tertiary, #7a7a7a); transition: transform 0.18s ease; display: inline-block; }
.dsh-about-source-select-arrow-open { transform: rotate(180deg); }
.dsh-about-source-drop { overflow: hidden; max-height: 0; opacity: 0; transform: translateY(-4px); animation: dsh-about-source-drop-in 0.16s ease-out forwards; }
.dsh-about-source-drop-closing { animation: dsh-about-source-drop-out 0.18s ease-in forwards; }
@keyframes dsh-about-source-drop-in {
	0% { max-height: 0; opacity: 0; transform: translateY(-4px); }
	60% { opacity: 1; }
	100% { max-height: 300px; opacity: 1; transform: translateY(0); }
}
@keyframes dsh-about-source-drop-out {
	0% { max-height: 300px; opacity: 1; transform: translateY(0); }
	100% { max-height: 0; opacity: 0; transform: translateY(-4px); }
}
@media (prefers-reduced-motion: reduce) {
	.dsh-about-source-drop, .dsh-about-source-drop-closing { animation: none; transition: none; max-height: none; opacity: 1; transform: none; }
}
.dsh-about-source-menu { margin-top: 6px; border: 1px solid rgba(128, 128, 128, 0.28); border-radius: 8px; background: var(--dsw-alias-surface-primary, rgba(255, 255, 255, 0.04)); overflow: hidden; }
.dsh-about-source-opt { display: flex; align-items: center; gap: 8px; padding: 7px 10px; font-size: 13px; cursor: pointer; }
.dsh-about-source-opt:hover { background: rgba(128, 128, 128, 0.1); }
.dsh-about-source-opt-current { background: rgba(10, 102, 194, 0.08); }
.dsh-about-source-opt-current::before { content: "✓"; font-weight: 700; color: var(--dsw-static-blue-400, #0a66c2); flex: none; }
.dsh-about-source-opt-name { flex: none; font-weight: 600; }
.dsh-about-source-opt-code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 11.5px; color: var(--dsw-alias-label-tertiary, #7a7a7a); overflow-wrap: anywhere; min-width: 0; }
.dsh-about-source-lat { margin-left: auto; flex: none; font-size: 12.5px; font-variant-numeric: tabular-nums; font-weight: 600; }
.dsh-about-source-lat-ok { color: var(--dsw-alias-state-success-primary, #1a7f37); }
.dsh-about-source-lat-err { color: var(--dsw-alias-state-error-primary, #cf222e); }
.dsh-about-source-lat-unknown { color: var(--dsw-alias-label-tertiary, #7a7a7a); font-weight: 400; }
.dsh-about-source-lat-clickable { cursor: pointer; padding: 2px 6px; border-radius: 4px; }
.dsh-about-source-lat-clickable:hover { background: rgba(10, 102, 194, 0.15); }
@keyframes dsh-about-success-draw { to { stroke-dashoffset: 0; } }
@keyframes dsh-about-success-pop { from { transform: scale(0.9); opacity: 0; } to { transform: scale(1); opacity: 1; }}
/* 插件版本行与「有新版本」小红点 */
.dsh-about-ver-link { font: inherit; color: var(--dsw-static-blue-400, #0a66c2); background: none; border: none; padding: 0; cursor: pointer; text-decoration: underline dotted; }
.dsh-about-ver-link:hover:not(:disabled) { text-decoration: underline; }
.dsh-about-ver-link:disabled { color: inherit; text-decoration: none; cursor: default; }
.dsh-about-row-label { position: relative; }
.dsh-about-label-dot { position: absolute; top: -1px; right: -8px; width: 7px; height: 7px; border-radius: 50%; background: #d92d20; }
.dsh-about-ver-note { margin-left: 6px; }
.dsh-about-ver-arrow { display: inline-block; width: 0; height: 0; margin-left: 7px; border-left: 5px solid transparent; border-right: 5px solid transparent; border-bottom: 7px solid currentColor; animation: dsh-about-ver-bob 1.5s ease-in-out infinite; }
@keyframes dsh-about-ver-bob { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-2px); } }
@media (prefers-reduced-motion: reduce) { .dsh-about-ver-arrow { animation: none; } }
/* 「关于」导航单元格右上角的小红点（DOM 追加，见 createNavDot） */
.dsh-about-navdot { position: absolute; top: 5px; right: 9px; width: 8px; height: 8px; border-radius: 50%; background: #d92d20; box-shadow: 0 0 0 2px var(--dsw-alias-bg-layer-1, rgba(255, 255, 255, 0.92)); pointer-events: none; }
/* 「建议优先更新本插件」提示块（紧跟「插件版本」行，间距收紧一档） */
.dsh-about > .dsh-about-priority { margin-top: -4px; }
.dsh-about-priority { font-size: 12.5px; line-height: 1.6; display: flex; flex-direction: column; gap: 6px; padding: 9px 11px; border-radius: 6px; background: rgba(217, 45, 32, 0.08); border: 1px solid rgba(217, 45, 32, 0.3); color: var(--dsw-alias-state-error-primary, #cf222e); }
.dsh-about-priority-title { font-weight: 600; }`;

		/* ───────────── CSS 注入（幂等） ───────────── */
		function ensureCss() {
			const tagId = PLUGIN_ID + "/about.css";
			const existing = document.querySelector(`style[data-plugin-css=${JSON.stringify(tagId)}]`);
			if (existing !== null) return existing;
			const tag = document.createElement("style");
			tag.dataset.plugin = PLUGIN_ID;
			tag.dataset.pluginCss = tagId;
			tag.textContent = CSS;
			document.head.appendChild(tag);
			return tag;
		}

		/* ───────────── 语言包（导航标签；页面正文以中文为主） ───────────── */
		const DICT = {
			zh: { nav: "关于" },
			en: { nav: "About" }
		};

		/* ───────────── 「关于」导航红点 ─────────────
		 * 设置导航里给本分区单元格的右上角挂一个小红点。宿主对 settings.section 的
		 * label 只用 resolveSlotLabel 转成纯文本（没有角标位），故只能自己补 DOM：
		 * 按导航标签文本认出我们的单元格 → 挂点 → MutationObserver 跟随设置面板重渲染。
		 * 只碰我们自己的节点和那一个单元格，卸载时全部还原。 */
		function createNavDot(labelGetter, titleGetter) {
			const state = { dot: null, cell: null, prevPosition: "", observer: null, active: false };
			const labelNow = () => {
				try {
					const value = labelGetter();
					return typeof value === "string" && value !== "" ? value : null;
				} catch {
					return null;
				}
			};
			const findCell = () => {
				const want = labelNow();
				if (want === null) return null;
				for (const label of document.querySelectorAll("span[class*=navLabel]")) {
					if (label.textContent === want) {
						const cell = label.closest("button");
						if (cell !== null) return cell;
					}
				}
				return null;
			};
			const detach = () => {
				if (state.dot !== null) state.dot.remove();
				if (state.cell !== null) {
					if (state.prevPosition === "") state.cell.style.removeProperty("position");
					else state.cell.style.position = state.prevPosition;
				}
				state.dot = null;
				state.cell = null;
			};
			const attach = () => {
				const cell = findCell();
				if (cell === null) return;
				// 已挂好且节点还在（React 重渲染可能把我们的节点挤掉，故每轮都验一次）
				if (state.cell === cell && state.dot !== null && cell.contains(state.dot)) return;
				detach();
				const dot = document.createElement("span");
				dot.className = "dsh-about-navdot";
				dot.setAttribute("data-dsh-about", "nav-dot");
				dot.setAttribute("aria-hidden", "true");
				try {
					const title = titleGetter();
					if (typeof title === "string" && title !== "") dot.setAttribute("title", title);
				} catch {
					/* 标题可选 */
				}
				state.prevPosition = cell.style.position || "";
				cell.style.position = "relative";
				const label = cell.querySelector("span[class*=navLabel]");
				if (label !== null) label.after(dot);
				else cell.appendChild(dot);
				state.dot = dot;
				state.cell = cell;
			};
			const syncObserver = () => {
				if (state.observer !== null) {
					state.observer.disconnect();
					state.observer = null;
				}
				if (!state.active || typeof MutationObserver !== "function") return;
				state.observer = new MutationObserver(() => {
					if (state.active) attach();
				});
				state.observer.observe(document.body, { childList: true, subtree: true });
			};
			return {
				set(active) {
					if (active === state.active) {
						if (active) attach();
						return;
					}
					state.active = active;
					if (active) attach();
					else detach();
					syncObserver();
				},
				dispose() {
					state.active = false;
					syncObserver();
					detach();
				}
			};
		}

		/* ───────────── 版本记录渲染（轻量 Markdown 子集，输出 React 元素） ───────────── */
		/** 取 release body 的中文部分（官方正文为「中文 | English」双段，中文在前）。 */
		function zhPart(body) {
			// 无英文段时兜底取「中文标题至文末」，避免把目录行等前言一起展示
			const enIdx = body.search(/<h3[^>]*id="en[^"]*"/);
			const cnIdx = body.search(/<h3[^>]*id="cn[^"]*"/);
			let zh;
			if (enIdx !== -1) zh = body.slice(0, enIdx);
			else if (cnIdx !== -1) zh = body.slice(cnIdx);
			else zh = body;
			return zh
				.replace(/^\[中文\][^\n]*(?:\n|$)/, "")
				.replace(/\r?\n---\s*$/, "");
		}

		/** 行内样式：先解析 [文本](链接)，再在纯文本里解析 **粗体**；
		 * 仅 http/https 链接渲染为可点击，其余原样显示。 */
		function inline(line) {
			const out = [];
			for (const node of linkify(line, 0)) {
				if (typeof node === "string") out.push(...splitBold(node, out.length));
				else out.push(node);
			}
			return out;
		}
		/** 把纯文本按 **粗体** 拆分；配对不完整时退化为原文（星号可见，无安全影响）。 */
		function splitBold(text, keyBase) {
			return text
				.split(/\*\*(.+?)\*\*/g)
				.map((part, i) => (i % 2 === 1 ? h("strong", { key: "b" + keyBase + "-" + i }, part) : part));
		}
		/** 把文本中的 Markdown 链接 [文本](url) 转为安全的 React 节点
		 * （URL 支持一对嵌套括号；仍以 ^https?:// 白名单为准）。 */
		function linkify(text, keyBase) {
			const nodes = [];
			const re = /\[([^\]]+)\]\(([^\s)]+(?:\([^\s)]*\)[^\s)]*)*)\)/g;
			let last = 0;
			let match;
			let k = 0;
			while ((match = re.exec(text)) !== null) {
				if (match.index > last) nodes.push(text.slice(last, match.index));
				if (/^https?:\/\//i.test(match[2])) {
					// 链接文本内同样支持 **粗体**
					nodes.push(h("a", { key: keyBase + "-a" + k, href: match[2], target: "_blank", rel: "noreferrer" }, ...splitBold(match[1], keyBase + "-l" + k)));
				} else {
					// 相对路径等非 http(s) 链接在设置页内点击无意义，按原文显示
					nodes.push(match[0]);
				}
				k += 1;
				last = match.index + match[0].length;
			}
			if (last < text.length) nodes.push(text.slice(last));
			return nodes;
		}

		/** 识别标题行（Markdown `### ` 或 HTML `<h3 …>…</h3>`），返回 (级别, 文本)。 */
		function headingLevel(line) {
			const md = /^(#{2,4})\s+(.*)$/.exec(line);
			if (md !== null) return [md[1].length, md[2]];
			const html = /^<h3[^>]*>(.*)<\/h3>$/.exec(line.trim());
			if (html !== null) return [4, html[1]];
			return null;
		}

		/** 将中文 release body 渲染为 React 元素列表（标题 / 列表 / 段落）。 */
		function renderReleaseBody(body) {
			// 兜底：body 非字符串（缓存污染/接口异常）时渲染为空，避免 TypeError
			if (typeof body !== "string" || body === "") return [];
			const out = [];
			let list = null;
			const flushList = () => {
				if (list !== null) {
					out.push(h("ul", { key: "ul-" + out.length }, ...list));
					list = null;
				}
			};
			for (const raw of String(zhPart(body) || "").split("\n")) {
				const line = raw.trim();
				if (line === "") {
					flushList();
					continue;
				}
				const bullet = /^[-*]\s+(.*)$/.exec(line);
				if (bullet !== null) {
					if (list === null) list = [];
					list.push(h("li", { key: "li-" + list.length }, ...inline(bullet[1])));
					continue;
				}
				flushList();
				const level = headingLevel(line);
				if (level !== null) {
					out.push(h(level[0] >= 4 ? "h5" : "h4", { className: "dsh-about-release-h", key: "h-" + out.length }, ...inline(level[1])));
				} else {
					out.push(h("p", { key: "p-" + out.length }, ...inline(line)));
				}
			}
			flushList();
			return out;
		}

		/* ───────────── 预发布分级标签（alpha 开发者预览版 / beta 测试版 / rc 预览版） ───────────── */
		/** 分级警告条（alpha 高风险红 / beta 中风险橙）。kind 为空返回 null。
		 *  只含版本本身的风险提示；「插件兼容性」由 compatWarn 单独、通用地提示。 */
		function kindWarn(kind) {
			if (kind === "alpha") {
				return h("div", { className: "dsh-about-prerelease-warn" },
					"⚠ 开发者预览版（alpha）：包含未完成功能，可能不稳定或破坏现有数据，仅建议在测试环境使用。"
				);
			}
			if (kind === "beta") {
				return h("div", { className: "dsh-about-prerelease-warn dsh-about-prerelease-warn-beta" },
					"⚠ Beta 测试版：功能基本完成，但可能存在缺陷，升级前请确认已备份。"
				);
			}
			return null;
		}
		/** 通用插件兼容性警告：任何版本更新（含稳定版）都提示可能与插件不兼容。 */
		function compatWarn() {
			return h("div", { className: "dsh-about-prerelease-warn dsh-about-prerelease-warn-beta" },
				"⚠ 版本更新后可能与某些插件不兼容，建议先关闭并退出所有插件再安装。"
			);
		}
		/** 版本列表条目旁的分级角标（与 npm tag 角标区分，视觉上更醒目）。 */
		function kindBadge(kind) {
			if (kind === "alpha") return h("span", { className: "dsh-about-badge-alpha", key: "kind-alpha" }, "开发者预览版");
			if (kind === "beta") return h("span", { className: "dsh-about-badge-beta", key: "kind-beta" }, "Beta 测试版");
			if (kind === "rc") return h("span", { className: "dsh-about-release-badge", key: "kind-rc" }, "预览版");
			return null;
		}

		/** 弹窗打开时的默认选中项：优先 latest（npm 稳定发布），其次最高 rc，
		 *  再退到任何「npm 已发布」的版本。
		 *  起因（Windows 侧验证发现）：旧实现只 setSelectedVersion(null)，
		 *  而「安装所选版本」按钮是 disabled:!selectedVersion —— 弹窗一打开按钮就是灰的，
		 *  用户直接点它没有任何反应，很容易误判为「按钮坏了」。 */
		function pickDefaultVersion(list) {
			if (!Array.isArray(list) || list.length === 0) return null;
			const installable = list.filter((v) => v && typeof v.version === "string" && v.onNpm !== false);
			const pool = installable.length > 0 ? installable : list.filter((v) => v && typeof v.version === "string");
			if (pool.length === 0) return null;
			// list 已按版本降序；带 "latest" 标签的就是 npm 的稳定发布
			const stable = pool.find((v) => Array.isArray(v.tags) && v.tags.includes("latest"));
			if (stable !== undefined) return stable.version;
			const rc = pool.find((v) => v.kind === "rc");
			if (rc !== undefined) return rc.version;
			return pool[0].version;
		}

		const UPDATE_STAGES = {
			launching: "启动更新任务", preflight: "隔离预检", "checking-npm": "检查 npm",
			snapshotting: "保存当前版本", installing: "安装", verifying: "校验 DSH 命令",
			retrying: "重试安装", "rolling-back": "恢复旧版", "arming-restart": "准备重启",
			interrupted: "更新中断", failed: "更新失败", "plugin-update": "安装 dsh-about",
			"preflight-node": "校验 Node 版本", "preflight-install": "隔离安装",
			"preflight-cli": "隔离校验 DSH 命令", "preflight-web": "隔离检查 Web 启动",
			install: "正式 npm 安装", cli: "正式 CLI 校验"
		};

		function formatUpdateFailure(report) {
			const targetName = (report.kind === "plugin" ? "dsh-about" : "DSH");
			const targetVer = report.target ? " " + report.target : " 未知版本";
			const lines = [
				`【${targetName} 更新失败诊断报告与修复请求】`,
				`我在尝试更新 ${targetName} 到 ${report.target || "新版本"} 时校验未通过，系统已安全回退。请根据以下报错信息与依赖排查并修复：`,
				"",
				"【基本信息】",
				"目标：" + targetName + targetVer,
				report.currentVersion && "更新前版本：" + report.currentVersion,
				report.finishedAt && "时间：" + new Date(report.finishedAt).toLocaleString(),
				report.id && "任务编号：" + report.id,
				"失败阶段：" + (UPDATE_STAGES[report.stage] || report.stage || "未知"),
				report.rolledBack === true && "已恢复到 " + (report.installedVersion || "旧版"),
				report.stage === "preflight" && "正式安装保持原有版本",
				report.needsRecovery && "更新需要恢复",
				report.restartError && "重启结果：" + report.restartError,
				"",
				"【错误概要】",
				report.summary,
				report.hint && ("修复建议：" + report.hint),
				"",
				"【各阶段检查结果】"
			].filter(Boolean);
			for (const check of report.checks || []) {
				lines.push("", (UPDATE_STAGES[check.phase] || check.phase) + "：" + (check.ok ? "通过" : check.timedOut ? "超时" : "失败") +
					(check.code == null ? "" : "（退出码 " + check.code + "）"));
				if (check.dependency) lines.push("实际依赖：" + check.dependency.name + (check.dependency.version ? "@" + check.dependency.version : ""));
				if (check.reason) lines.push("原因：" + check.reason);
				if (check.error && !check.output?.includes(check.error)) lines.push("核心报错：" + check.error);
				if (check.output) lines.push(check.output.trimEnd());
			}
			if (report.output && (!(report.checks || []).length || report.needsRecovery)) lines.push("", "【详细输出日志】", report.output.trimEnd());
			return lines.join("\n");
		}

		/* ───────────── 「关于」分区组件 ───────────── */
		function AboutSection() {
			const [info, setInfo] = useState(null);
			const [describeError, setDescribeError] = useState(null);
			const [checking, setChecking] = useState(false);
			const [snapshot, setSnapshot] = useState(null);
			const [installing, setInstalling] = useState(false);
			const [updateResult, setUpdateResult] = useState(null);
			const [lastFailure, setLastFailure] = useState(null);
			const [failureDialogOpen, setFailureDialogOpen] = useState(false);
			const [failureDetail, setFailureDetail] = useState(null);
			const [failureHistory, setFailureHistory] = useState(null);
			const [historyMenuOpen, setHistoryMenuOpen] = useState(false);
			const [failureHistoryBusy, setFailureHistoryBusy] = useState(false);
			const [failureHistoryError, setFailureHistoryError] = useState(null);
			const [copyStatus, setCopyStatus] = useState(null);
			const [pickerOpen, setPickerOpen] = useState(false);
			const [versions, setVersions] = useState(null);
			const [versionsError, setVersionsError] = useState(null);
			const [selectedVersion, setSelectedVersion] = useState(null);
			const [restarting, setRestarting] = useState(false);
			/** 版本更新记录中已展开描述的版本集合（手风琴：点击头部展开/收起）。 */
			const [expandedReleases, setExpandedReleases] = useState(() => new Set());
			const [restartDone, setRestartDone] = useState(false);
			const [restartFailed, setRestartFailed] = useState(false);
			/** 安装成功但宿主未能布防自动重启（restarting:false 响应）。 */
			const [manualRestartNeeded, setManualRestartNeeded] = useState(false);
			/** 宿主回报的「自动重启布防失败」原因（describe.restartArmed === false 且
			 *  lastRestartError 非空）。有值时立刻转手动重启提示，不再空等 60 次轮询。 */
			const [restartReason, setRestartReason] = useState(null);
			/** 本次安装中宿主自动修复了 npm 12 的 install-scripts 拦截（selfHealed:true）。 */
			const [selfHealed, setSelfHealed] = useState(false);
			const [compatibilityWarnings, setCompatibilityWarnings] = useState([]);
			const [compatDetailsOpen, setCompatDetailsOpen] = useState(false);
			const [updateProgress, setUpdateProgress] = useState(null);
			const updateJobRef = useRef(null);
			const updateSubmissionRef = useRef(null);
			const handledUpdateRef = useRef(null);
			const [releases, setReleases] = useState(null);
			const [refreshing, setRefreshing] = useState(false);
			const [failBadge, setFailBadge] = useState(false);
			const [successShow, setSuccessShow] = useState(false);
			/** 更新源：源列表（含 label/host）、当前选中、各源延迟检测结果、检测中标记。 */
			const [sourceState, setSourceState] = useState(null); // { current, resolvedHost, sources: [...] }
			const [sourceError, setSourceError] = useState(null);
			const [pings, setPings] = useState(null); // { [sourceId]: { ok, ms, error } }
			/** 正在检测延迟的源 id（每次只测一个，只标记被点的那个源）。 */
			const [pingingSrc, setPingingSrc] = useState(null);
			const [savingSource, setSavingSource] = useState(false);
			/** GitHub 认证：是否已配置、是否来自环境变量、掩码（宿主只回掩码，绝不明文）。 */
			const [authState, setAuthState] = useState(null); // { configured, fromEnv, masked }
			/** 认证输入框草稿（保存成功后清空；未保存也能直接「测试连接」）。 */
			const [tokenDraft, setTokenDraft] = useState("");
			const [savingToken, setSavingToken] = useState(false);
			const [testingAuth, setTestingAuth] = useState(false);
			/** 「测试连接」结果：{ ok, status, limit, remaining, resetAt, error }。 */
			const [authTest, setAuthTest] = useState(null);
			const [authError, setAuthError] = useState(null);
			/** 认证区展开态：null 收起 | "device" 在线认证 | "custom" 自定义。两者互斥。 */
			const [authPanel, setAuthPanel] = useState(null);
			/** 在线认证（设备码）流程态：idle | starting | waiting | authorized | expired | denied | error。 */
			const [deviceState, setDeviceState] = useState("idle");
			/** 宿主下发的一次性码与验证页地址（device_code 留在宿主，前端只拿给人看的这两样）。 */
			const [deviceInfo, setDeviceInfo] = useState(null); // { userCode, verificationUri, expiresIn }
			const [deviceError, setDeviceError] = useState(null);
			/** 未配置 OAuth App 的 client_id 时的注册指引（入口地址由宿主下发，前端不写死）。 */
			const [deviceSetup, setDeviceSetup] = useState(null); // { error, setupUrl }
			const [copiedCode, setCopiedCode] = useState(false);
			/** 下拉是否展开。 */
			const [sourceOpen, setSourceOpen] = useState(false);
			/** 下拉收起动画进行中（短暂过渡态：菜单还在 DOM，正在淡出，结束后卸载）。 */
			const [sourceClosing, setSourceClosing] = useState(false);
			const successTimerRef = useRef(null);
			/** 下拉收起动画计时：动画结束后卸载菜单 DOM。 */
			const sourceCloseTimerRef = useRef(null);
			/** 版本记录各正文元素（version → body 元素）：展开动画量 scrollHeight 用。 */
			const releaseBodyEls = useRef(new Map());
			/** 卸载标志与轮询定时器引用：组件卸载后停止轮询、不再触发整页刷新。 */
			const mountedRef = useRef(true);
			const pollTimerRef = useRef(null);
			/** /versions 请求序号：丢弃过期响应，防止旧错误压过新成功数据。 */
			const versionsSeqRef = useRef(0);
			/** /ping 请求序号：丢弃过期响应（连点时只有最后发起的请求能落地）。 */
			const pingSeqRef = useRef(0);
			/** /ping 互斥锁（ref 同步判定，防状态异步导致的并发重入）。 */
			const pingBusyRef = useRef(false);
			/** /ping 客户端超时：宿主侧 15s 探测超时，再留 5s 网络余量。 */
			const PING_CLIENT_TIMEOUT_MS = 20_000;
			const dialogRef = useRef(null);
			const failureDialogRef = useRef(null);
			const historyDialogRef = useRef(null);
			/** 感叹号与悬停预览：用实测视口坐标定位，避开设置面板的 overflow 裁剪。 */
			const bangRef = useRef(null);
			const bangMenuRef = useRef(null);
			const bangListRef = useRef(null);
			/** 报错历史请求的并发闸门：state 在闭包里可能滞后，用 ref 保证同一时刻只发一次。 */
			const failureHistoryBusyRef = useRef(false);

			/* ── 本插件自身的版本 / 自更新状态（插件版本行 + 导航红点 + 自更新弹窗共用） ── */
			const [pluginInfo, setPluginInfo] = useState(null);
			const [pluginInfoError, setPluginInfoError] = useState(null);
			const [pluginDialog, setPluginDialog] = useState(false);
			const [pluginBusy, setPluginBusy] = useState(false);
			const [pluginTarget, setPluginTarget] = useState(null);
			const [pluginRestarting, setPluginRestarting] = useState(false);
			const [pluginRestartDone, setPluginRestartDone] = useState(false);
			const [pluginRestartFailed, setPluginRestartFailed] = useState(false);
			const [pluginManualRestart, setPluginManualRestart] = useState(false);
			/** 同 restartReason，作用于插件自更新弹窗。 */
			const [pluginRestartReason, setPluginRestartReason] = useState(null);
			const [pluginResult, setPluginResult] = useState(null);
			const pluginSeqRef = useRef(0);
			const pluginDialogRef = useRef(null);
			const [platformNoticeOpen, setPlatformNoticeOpen] = useState(false);
			const platformNoticeRef = useRef(null);
			const platformNoticeVisible = platformNoticeOpen && !pickerOpen && !pluginDialog;
			useEffect(() => {
				if (!pickerOpen && !pluginDialog && claimPlatformNotice(info && info.platform)) setPlatformNoticeOpen(true);
			}, [info, pickerOpen, pluginDialog]);
			useEffect(() => {
				if (!platformNoticeVisible) return;
				const previousFocus = document.activeElement;
				const button = platformNoticeRef.current?.querySelector("button");
				button?.focus();
				const onKey = (e) => {
					if (e.key === "Escape") setPlatformNoticeOpen(false);
					if (e.key === "Tab") { e.preventDefault(); button?.focus(); }
				};
				document.addEventListener("keydown", onKey);
				return () => {
					document.removeEventListener("keydown", onKey);
					if (previousFocus?.isConnected) previousFocus.focus();
				};
			}, [platformNoticeVisible]);
			useEffect(() => {
				// 兼容 React StrictMode 双挂载：挂载时重置，卸载时清理
				mountedRef.current = true;
				return () => {
					mountedRef.current = false;
					if (pollTimerRef.current !== null) {
						clearTimeout(pollTimerRef.current);
						pollTimerRef.current = null;
					}
					if (successTimerRef.current !== null) {
						clearTimeout(successTimerRef.current);
						successTimerRef.current = null;
					}
					if (sourceCloseTimerRef.current !== null) {
						clearTimeout(sourceCloseTimerRef.current);
						sourceCloseTimerRef.current = null;
					}
					// 重挂载（切页/开合设置中心）时重置延迟检测与下拉的瞬态，避免脏状态残留
					setSourceOpen(false);
					setPingingSrc(null);
					pingBusyRef.current = false;
					pingSeqRef.current += 1; // 使旧请求的回调全部失效
					releaseBodyEls.current.clear();
				};
			}, []);
			useEffect(() => {
				let alive = true;
				fetch(ENDPOINT + "/describe")
					.then((res) => res.json())
					.then((data) => {
						if (!alive) return;
						if (data && data.ok) setInfo(data);
						else setDescribeError(String((data && data.error) || "describe 响应异常"));
					})
					.catch((error) => {
						if (alive) setDescribeError(String(error && error.message));
					});
				return () => {
					alive = false;
				};
			}, []);

			useEffect(() => {
				let alive = true;
				fetch(ENDPOINT + "/compatibility").then((r) => r.json()).then((d) => {
					if (alive && d && d.ok && Array.isArray(d.warnings)) setCompatibilityWarnings(d.warnings);
				}).catch(() => {});
				return () => { alive = false; };
			}, []);
			useEffect(() => {
				let alive = true;
				fetch(ENDPOINT + "/source")
					.then((res) => res.json())
					.then((data) => {
						if (!alive) return;
						if (data && data.ok) {
							setSourceState({ current: data.current, resolvedHost: data.resolvedHost, sources: data.sources || [] });
							setSourceError(null);
						} else {
							setSourceError(String((data && data.error) || "获取更新源失败"));
						}
					})
					.catch((error) => {
						if (alive) setSourceError(String(error && error.message));
					});
				return () => {
					alive = false;
				};
			}, []);
			useEffect(() => {
				let alive = true;
				fetch(ENDPOINT + "/auth")
					.then((res) => res.json())
					.then((data) => {
						if (!alive) return;
						if (data && data.ok) {
							setAuthState({
								configured: data.configured === true,
								fromEnv: data.fromEnv === true,
								masked: typeof data.masked === "string" ? data.masked : "",
								// 「在线认证」是否可用（宿主是否配了 OAuth App 的 client_id）
								deviceAvailable: data.deviceAvailable === true
							});
							setAuthError(null);
						} else {
							setAuthError(String((data && data.error) || "获取认证状态失败"));
						}
					})
					.catch((error) => {
						if (alive) setAuthError(String(error && error.message));
					});
				return () => {
					alive = false;
				};
			}, []);
			/** 拉取成功：弹出苹果支付风格的「拉取成功」对勾动画浮层。 */
			const showSuccess = () => {
				setSuccessShow(true);
				if (successTimerRef.current !== null) clearTimeout(successTimerRef.current);
				successTimerRef.current = setTimeout(() => setSuccessShow(false), 1800);
			};

			/** 把 /releases 响应落到界面状态：成功弹对勾，失败亮红标并尽量保留旧内容。 */
			const applyReleasesResult = (data) => {
				if (data && data.ok === true) {
					const list = Array.isArray(data.releases) ? data.releases : [];
					setReleases({ ok: true, releases: list });
					setFailBadge(false);
					if (data.fresh === true) showSuccess();
					return;
				}
				setFailBadge(true);
				const fallback = data && Array.isArray(data.releases) ? data.releases : [];
				if (fallback.length > 0) setReleases({ ok: true, releases: fallback });
				else setReleases({ ok: false, error: String((data && data.error) || "获取版本记录失败"), releases: [] });
			};

			/** 网络请求本身失败（没拿到任何响应）：亮红标并保留页面已展示的内容。 */
			const markFetchFailed = () => {
				setFailBadge(true);
				setReleases((prev) =>
					prev !== null && Array.isArray(prev.releases) && prev.releases.length > 0
						? prev
						: { ok: false, error: "网络请求失败", releases: [] }
				);
			};

			/** 切换下拉开合：展开立即可见；收起先播放淡出动画，结束后再卸载菜单 DOM。 */
			const toggleSource = () => {
				if (!sourceOpen) {
					if (sourceCloseTimerRef.current !== null) {
						clearTimeout(sourceCloseTimerRef.current);
						sourceCloseTimerRef.current = null;
					}
					setSourceClosing(false);
					setSourceOpen(true);
					return;
				}
				setSourceClosing(true);
				sourceCloseTimerRef.current = setTimeout(() => {
					sourceCloseTimerRef.current = null;
					setSourceClosing(false);
					setSourceOpen(false);
				}, 180); // 与 CSS 收起动画时长一致
			};

			/** 切换更新源：POST /source 持久化到宿主，成功后更新本地状态。 */
			const switchSource = (sourceId) => {
				if (savingSource || sourceId === (sourceState && sourceState.current)) return;
				setSavingSource(true);
				fetch(ENDPOINT + "/source", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ source: sourceId })
				})
					.then((res) => res.json())
					.then((data) => {
						if (!data || data.ok !== true) {
							setSourceError(String((data && data.error) || "切换更新源失败"));
							return;
						}
						// 成功后立即同步本地选中态（高亮/✓ 即时更新，不必重开下拉），并清掉历史错误
						setSourceState((prev) => {
							if (prev === null) return prev;
							return {
								...prev,
								current: data.current,
								resolvedHost: data.resolvedHost,
								sources: (prev.sources || []).map((s) => ({ ...s, host: s.id === data.current && data.resolvedHost ? data.resolvedHost : s.host }))
							};
						});
						setSourceError(null);
					})
					.catch((error) => setSourceError(String(error && error.message)))
					.finally(() => setSavingSource(false));
			};

			/** 延迟检测：点击某源行上的「未检测」/延迟文本触发，只测该源。 */
			const pingSource = (sourceId) => {
				// 已有源在测（ref 同步锁，防连点竞态）时不重复发起请求
				if (pingBusyRef.current) return;
				pingBusyRef.current = true;
				setPingingSrc(sourceId);
				pingSeqRef.current += 1;
				const seq = pingSeqRef.current;
				const cleanup = () => {
					if (seq === pingSeqRef.current) {
						pingBusyRef.current = false;
						setPingingSrc(null);
					}
				};
				const timer = setTimeout(() => {
					// 客户端超时兜底：网络层悬挂时主动结束「检测中」态。
					// 必须先解锁、再推序号：cleanup() 仅在 seq === pingSeqRef.current
					// 时解锁，若先推序号（旧实现）则解锁条件恒失配 → pingBusyRef 卡死、
					// 之后任何源都测不了，只能重挂载组件恢复。
					if (seq !== pingSeqRef.current) return;
					setSourceError("延迟检测超时，请重试");
					pingBusyRef.current = false;
					setPingingSrc(null);
					pingSeqRef.current += 1; // 使本次请求的后续回调全部失效
				}, PING_CLIENT_TIMEOUT_MS);
				fetch(ENDPOINT + "/ping", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ source: sourceId })
				})
					.then((res) => res.json())
					.then((data) => {
						if (seq !== pingSeqRef.current) return; // 过期响应丢弃
						clearTimeout(timer);
						if (!data) {
							setSourceError("延迟检测失败：无响应");
							return;
						}
						// 传输层失败（宿主拒绝/异常）才报错；ping 自身的 ok=false（不可达）
						// 是正常检测结果，落到对应源行显示「不可达」
						if (data.error && data.source === undefined) {
							setSourceError(String(data.error));
							return;
						}
						if (data.source !== undefined && data.source !== null) {
							setPings((prev) => ({ ...(prev || {}), [data.source]: { ok: data.ok === true, ms: data.ms, error: data.error } }));
						}
						setSourceError(null);
					})
					.catch((error) => {
						if (seq !== pingSeqRef.current) return;
						clearTimeout(timer);
						setSourceError(String(error && error.message));
					})
					.finally(cleanup);
			};

			useEffect(() => {
				let alive = true;
				let pending = false;
				let lastPollAt = -Infinity;
				try { updateJobRef.current = JSON.parse(sessionStorage.getItem("dsh-about-update-job") || "null"); } catch {}
				const poll = async (force = false) => {
					// Stay aware of jobs submitted by another tab/host without polling
					// idle installations at the active-job frequency.
					if (!alive || pending || !force && !updateJobRef.current && !updateSubmissionRef.current && Date.now() - lastPollAt < 15000) return;
					pending = true;
					lastPollAt = Date.now();
					try {
						const response = await fetch(ENDPOINT + "/update-status", { cache: "no-store" });
						const data = await response.json();
						if (!alive || !data || !data.ok) return;
						setLastFailure((current) => current?.id === data.lastFailure?.id && current?.finishedAt === data.lastFailure?.finishedAt
							? current : data.lastFailure || null);
						const submitted = updateSubmissionRef.current;
						if (data.inProgress && data.kind === "dsh") {
							armWhiteScreenGuard();
							updateJobRef.current = { id: data.id, version: data.target };
							try { sessionStorage.setItem("dsh-about-update-job", JSON.stringify(updateJobRef.current)); } catch {}
							setInstalling(true);
							setPickerOpen(true);
							setSelectedVersion(data.target);
							setUpdateProgress(data);
						} else if (data.result && handledUpdateRef.current !== data.id &&
							(data.needsRecovery || updateJobRef.current?.id === data.id || submitted && data.target === submitted.version && data.startedAt >= submitted.at)) {
							handledUpdateRef.current = data.id;
							updateSubmissionRef.current = null;
							updateJobRef.current = null;
							try { sessionStorage.removeItem("dsh-about-update-job"); } catch {}
							if (data.kind === "plugin") {
								setPluginDialog(true);
								setPluginTarget(data.target);
								setPluginBusy(false);
								setPluginResult({ ...data.result, tail: data.result.out });
							} else {
								setPickerOpen(true);
								setSelectedVersion(data.target);
								handleInstallResult({ ...data.result, id: data.id, tail: data.result.out, version: data.target }, data.target);
							}
						} else if (submitted && !data.inProgress && Date.now() - submitted.at > 90000 && !updateJobRef.current) {
							updateSubmissionRef.current = null;
							setInstalling(false);
							setUpdateResult({ ok: false, error: "未能确认后台更新任务，请重试", tail: "" });
						} else if (!submitted && !data.inProgress && updateJobRef.current?.id !== data.id) {
							updateJobRef.current = null;
							setInstalling(false);
							setUpdateProgress(null);
							try { sessionStorage.removeItem("dsh-about-update-job"); } catch {}
						}
					} catch { /* Host can disappear while the independent worker continues. */ }
					finally { pending = false; }
				};
				const onFocus = () => { void poll(true); };
				const onVisibility = () => { if (document.visibilityState === "visible") onFocus(); };
				poll();
				const timer = setInterval(poll, 1500);
				window.addEventListener("focus", onFocus);
				document.addEventListener("visibilitychange", onVisibility);
				return () => {
					alive = false;
					clearInterval(timer);
					window.removeEventListener("focus", onFocus);
					document.removeEventListener("visibilitychange", onVisibility);
				};
			}, []);

			useEffect(() => {
				// 内容缓存与「每日门控」已移到宿主侧（落盘到 $DSH_HOME/dsh-about）。
				// 浏览器只发一次自动拉取请求：是否真的访问 GitHub、是否弹对勾，都由宿主
				// 按磁盘缓存状态决定，并用 fresh 字段标记本次是否为实时拉取。
				let alive = true;
				fetch(ENDPOINT + "/releases")
					.then((res) => res.json())
					.then((data) => {
						if (!alive || !data) return;
						applyReleasesResult(data);
					})
					.catch(() => {
						if (!alive) return;
						markFetchFailed();
					});
				return () => {
					alive = false;
				};
			}, []);

			// 版本记录正文开合动画（纯 JS 驱动高度，精确无裁切）：
			//  - 展开：先把 inline max-height 归 0 → 强制重排 → 设 scrollHeight，transition 平滑滑开
			//  - 收起：inline max-height 归 0，平滑收起
			//  - 折叠态初始也由 JS 归零（CSS 基态无 max-height，避免与过渡打架）
			useEffect(() => {
				const els = releaseBodyEls.current;
				for (const el of els.values()) {
					if (!el) continue;
					const open = expandedReleases.has(el.dataset.rel);
					// 折叠初始/收起的元素：inline 归 0（含首次挂载）
					if (!open && el.style.maxHeight !== "0px") {
						el.style.maxHeight = "0px";
						el.style.opacity = "0";
					}
				}
				// 展开的元素：双帧驱动过渡（先让浏览器应用 0px 基态，再滑到实际高度）
				const raf = requestAnimationFrame(() => {
					for (const el of els.values()) {
						if (!el) continue;
						const open = expandedReleases.has(el.dataset.rel);
						if (open && el.style.maxHeight === "0px") {
							// 强制同步重排，确保浏览器已渲染 0px 折叠态，transition 才会启动
							void el.offsetHeight;
							el.style.maxHeight = el.scrollHeight + "px";
							el.style.opacity = "1";
						}
					}
				});
				// 展开结束后收掉 inline（清理时重新核对状态，避免把刚收起的又撑开）
				const t = setTimeout(() => {
					for (const el of els.values()) {
						if (!el) continue;
						const open = expandedReleases.has(el.dataset.rel);
						// 只有仍是展开态（且 inline 不是 0px）才清；收起态保持 0px
						if (open && el.style.maxHeight !== "0px") {
							el.style.maxHeight = "";
							el.style.opacity = "";
						}
					}
				}, 300);
				return () => {
					clearTimeout(t);
					cancelAnimationFrame(raf);
				};
			}, [expandedReleases, releases]);
			// 弹窗键盘与焦点：Escape 关闭（安装/重启进行中除外）；打开时把焦点移入对话框
			useEffect(() => {
				if (!pickerOpen) return;
				const onKey = (e) => {
					if (e.key === "Escape" && !installing && !restarting) setPickerOpen(false);
				};
				document.addEventListener("keydown", onKey);
				return () => document.removeEventListener("keydown", onKey);
			}, [pickerOpen, installing, restarting]);
			useEffect(() => {
				if (pickerOpen && dialogRef.current !== null) dialogRef.current.focus();
			}, [pickerOpen]);
			useEffect(() => {
				if (!failureDialogOpen) return;
				const onKey = (e) => {
					if (e.key === "Escape") {
						setFailureDialogOpen(false);
						setFailureDetail(null);
					}
				};
				document.addEventListener("keydown", onKey);
				return () => document.removeEventListener("keydown", onKey);
			}, [failureDialogOpen]);
			useEffect(() => {
				if (!failureDialogOpen) return;
				const previousFocus = document.activeElement;
				failureDialogRef.current?.focus();
				return () => {
					if (previousFocus?.isConnected) previousFocus.focus();
				};
			}, [failureDialogOpen]);

			/* ───────────── 本插件自身的版本与自更新 ───────────── */

			/** 拉一次插件自身版本状态（force=true 绕过宿主的 5 分钟缓存）。 */
			const loadPluginInfo = (force) => {
				pluginSeqRef.current += 1;
				const seq = pluginSeqRef.current;
				fetch(PLUGIN_ENDPOINT + (force ? "?force=1" : ""), { cache: "no-store" })
					.then((res) => res.json())
					.then((data) => {
						if (seq !== pluginSeqRef.current || !mountedRef.current) return;
						if (data && data.version) {
							setPluginInfo(data);
							setPluginInfoError(null);
						} else {
							setPluginInfoError(String((data && data.error) || "获取插件版本失败"));
						}
					})
					.catch((error) => {
						if (seq !== pluginSeqRef.current || !mountedRef.current) return;
						setPluginInfoError(String(error && error.message));
					});
			};

			useEffect(() => {
				loadPluginInfo(false);
				// 十分钟后台刷新一次：不必等重开设置页，红点也能自己更新
				const timer = setInterval(() => loadPluginInfo(false), 10 * 60 * 1000);
				return () => clearInterval(timer);
			}, []);

			const pluginHasUpdate = Boolean(pluginInfo && pluginInfo.updateAvailable);
			/** 本地 link:/file: 安装（开发态）：不提供自更新，否则会把源码目录换成 npm 包。 */
			const pluginIsLocal = Boolean(pluginInfo && pluginInfo.installMode === "local");
			/** 可一键自更新：npm 安装形态 + 源上确有更新版。 */
			const pluginCanUpdate = pluginHasUpdate && !pluginIsLocal;

			// 「关于」导航红点跟随「有无新版开发版」
			useEffect(() => {
				if (navDotCtl === null) return;
				navDotCtl.set(pluginHasUpdate);
			}, [pluginHasUpdate]);

			const openPluginDialog = () => {
				if (!pluginInfo) return;
				if (!pluginHasUpdate && !pluginIsLocal) return;
				setPluginTarget(pluginInfo.newest);
				setPluginDialog(true);
				setPluginResult(null);
				setPluginRestartDone(false);
				setPluginRestartFailed(false);
				setPluginManualRestart(false);
				setPluginRestartReason(null);
			};

			/** 点版本号：有新版→打开更新弹窗；已是最新→重新检查一次（手动强刷）。 */
			const onPluginVersionClick = () => {
				// 有新版（或本地源码安装，需要说明为什么不能自更新）→ 开弹窗；否则＝重新检查一次
				if (pluginHasUpdate || pluginIsLocal) openPluginDialog();
				else loadPluginInfo(true);
			};

			useEffect(() => {
				if (!pluginDialog) return;
				const onKey = (e) => {
					if (e.key === "Escape" && !pluginBusy && !pluginRestarting) setPluginDialog(false);
				};
				document.addEventListener("keydown", onKey);
				return () => document.removeEventListener("keydown", onKey);
			}, [pluginDialog, pluginBusy, pluginRestarting]);
			useEffect(() => {
				if (pluginDialog && pluginDialogRef.current !== null) pluginDialogRef.current.focus();
			}, [pluginDialog]);

			/** 自更新：POST /dsh-about/plugin-update → 宿主执行 dsh plugin add → 自动重启 → 轮询新版就绪。 */
			const onPluginUpdate = (version) => {
				if (!version || pluginBusy || pluginRestarting) return;
				// 与 dsh 本体更新同理：插件包被就地替换同样会把运行中的 SPA 打崩
				armWhiteScreenGuard();
				setPluginBusy(true);
				setPluginResult(null);
				setPluginTarget(version);
				fetch(PLUGIN_ENDPOINT + "-update", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ version, port: Number(window.location.port) || undefined })
				})
					.then((res) => res.json())
					.then((data) => {
						if (!data) throw new Error("空响应");
						if (data.ok && data.restarting) {
							setPluginBusy(false);
							setPluginRestarting(true);
							// 与 dsh 本体更新同款轮询：等新版插件真的在跑，再刷新页面。
							// 同样要求**进程身份变化**：`/dsh-about/plugin` 的 version 读的是
							// 磁盘上的插件清单，`dsh plugin add` 一落盘旧宿主就会报新版本号。
							// （首轮延迟 5s 避开宿主 2.5s 退出窗口。）
							const fromNonce = typeof data.hostNonce === "string" ? data.hostNonce : null;
							let attempts = 0;
							const poll = () => {
								pollTimerRef.current = null;
								fetch(PLUGIN_ENDPOINT, { cache: "no-store" })
									.then((r) => r.json())
									.then((d) => {
										if (!mountedRef.current) return;
										const restarted = fromNonce === null
											? true
											: typeof d?.nonce === "string" && d.nonce !== fromNonce;
										if (d && d.version === version && restarted) {
											setPluginRestartDone(true);
											setPluginRestarting(false);
											pollTimerRef.current = setTimeout(() => location.reload(), 1500);
										} else if (d && d.restartArmed === false && typeof d.lastRestartError === "string" && d.lastRestartError !== "") {
											// 同本体更新：宿主明确回报「看护没能布防」时立刻转手动重启提示
											setPluginRestartReason(d.lastRestartError);
											setPluginManualRestart(true);
											setPluginRestarting(false);
										} else if (++attempts < 60) pollTimerRef.current = setTimeout(poll, 2000);
										else {
											setPluginRestartFailed(true);
											setPluginRestarting(false);
										}
									})
									.catch(() => {
										if (!mountedRef.current) return;
										if (++attempts < 60) pollTimerRef.current = setTimeout(poll, 2000);
										else {
											setPluginRestartFailed(true);
											setPluginRestarting(false);
										}
									});
							};
							pollTimerRef.current = setTimeout(poll, 5000);
						} else if (data.ok && !data.restarting) {
							// 装好了但宿主没能布防自动重启：提示手动重启
							setPluginBusy(false);
							setPluginManualRestart(true);
						} else {
							setPluginResult(data);
							setPluginBusy(false);
						}
					})
					.catch((error) => {
						setPluginResult({ ok: false, error: String(error && error.message) });
						setPluginBusy(false);
					});
			};

			const copyFailure = async (report) => {
				if (!report) return;
				const { id, finishedAt } = report;
				try {
					await navigator.clipboard.writeText(formatUpdateFailure(report));
					setCopyStatus({ id, finishedAt, message: "诊断已复制" });
				} catch {
					setCopyStatus({ id, finishedAt, message: "自动复制失败，请手动选中日志复制" });
				}
			};
			const copyMessage = copyStatus ? copyStatus.message : "";
			const openFailureDetail = (report) => {
				if (!report) return;
				setFailureDetail(report);
				setFailureDialogOpen(true);
			};
			const closeFailureDialog = () => {
				setFailureDialogOpen(false);
				setFailureDetail(null);
			};
			/** 报错历史按需拉取（不在 1.5s 轮询里传输完整日志）。 */
			const loadFailureHistory = () => {
				if (failureHistoryBusyRef.current) return;
				failureHistoryBusyRef.current = true;
				setFailureHistoryBusy(true);
				fetch(ENDPOINT + "/failure-history", { cache: "no-store" })
					.then((res) => res.json())
					.then((data) => {
						if (!mountedRef.current) return;
						if (!data || data.ok !== true) {
							setFailureHistoryError(String((data && data.error) || "获取报错历史失败"));
							return;
						}
						setFailureHistory(Array.isArray(data.failures) ? data.failures : []);
						setFailureHistoryError(null);
					})
					.catch((error) => {
						if (mountedRef.current) setFailureHistoryError(String(error && error.message));
					})
					.finally(() => {
						failureHistoryBusyRef.current = false;
						if (mountedRef.current) setFailureHistoryBusy(false);
					});
			};
			/** 感叹号点击后展开的「报错历史二级菜单」；打开前再拉一次，保证是最新记录。 */
			const openHistoryMenu = () => {
				setHistoryMenuOpen(true);
				loadFailureHistory();
			};
			const closeHistoryMenu = () => setHistoryMenuOpen(false);
			/** 从历史菜单进入完整诊断：先收起外层菜单，避免两层弹窗叠在一起。 */
			const openHistoryDetail = (report) => {
				setHistoryMenuOpen(false);
				openFailureDetail(report);
			};
			/** 悬停预览用 fixed 定位：设置面板的 .panel / .options 都是 overflow 裁剪容器，
			 *  absolute 预览在靠近面板底部或窄屏时会被切掉。这里按触发器实测位置夹在视口内，
			 *  下方空间不足时向上翻，并把列表高度收进可用空间。 */
			const placeBangMenu = () => {
				const anchor = bangRef.current;
				const menu = bangMenuRef.current;
				if (!anchor || !menu) return;
				const rect = anchor.getBoundingClientRect();
				const viewportWidth = window.innerWidth;
				const viewportHeight = window.innerHeight;
				if (!viewportWidth || !viewportHeight) return;
				const margin = 12;
				const gap = 8;
				const width = Math.min(380, Math.max(180, viewportWidth - rect.left - margin));
				const left = Math.min(Math.max(margin, rect.left), Math.max(margin, viewportWidth - width - margin));
				const below = viewportHeight - rect.bottom - gap - margin;
				const above = rect.top - gap - margin;
				const openUp = below < 200 && above > below;
				const maxHeight = Math.max(120, Math.min(300, openUp ? above : below));
				menu.style.position = "fixed";
				menu.style.width = width + "px";
				menu.style.left = left + "px";
				menu.style.top = openUp ? "auto" : rect.bottom + gap + "px";
				menu.style.bottom = openUp ? viewportHeight - rect.top + gap + "px" : "auto";
				menu.style.maxHeight = maxHeight + "px";
				menu.classList.toggle("dsh-about-bang-menu-up", openUp);
				if (bangListRef.current) bangListRef.current.style.maxHeight = Math.max(60, maxHeight - 56) + "px";
			};
			useEffect(() => {
				const reposition = () => placeBangMenu();
				document.addEventListener("scroll", reposition, true);
				window.addEventListener("resize", reposition);
				return () => {
					document.removeEventListener("scroll", reposition, true);
					window.removeEventListener("resize", reposition);
				};
			}, []);
			/** 页面打开即拉一次历史（下方列表常驻），有新失败记录时再刷新。 */
			useEffect(() => {
				loadFailureHistory();
			}, [lastFailure]);
			useEffect(() => {
				if (!historyMenuOpen) return;
				const dialog = historyDialogRef.current;
				const previousFocus = document.activeElement;
				dialog?.focus();
				const onKey = (e) => {
					if (e.key === "Escape") {
						setHistoryMenuOpen(false);
						return;
					}
					// 遮罩后面的内联列表与版本记录不应被 Tab 触达；把焦点圈在弹窗内。
					if (e.key !== "Tab" || !dialog) return;
					const focusable = [...dialog.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')]
						.filter((el) => !el.disabled && el.getClientRects().length > 0);
					if (focusable.length === 0) {
						e.preventDefault();
						dialog.focus();
						return;
					}
					const first = focusable[0];
					const last = focusable[focusable.length - 1];
					if (e.shiftKey && (document.activeElement === first || document.activeElement === dialog)) {
						e.preventDefault();
						last.focus();
					} else if (!e.shiftKey && document.activeElement === last) {
						e.preventDefault();
						first.focus();
					}
				};
				document.addEventListener("keydown", onKey);
				return () => {
					document.removeEventListener("keydown", onKey);
					if (previousFocus?.isConnected) previousFocus.focus();
				};
			}, [historyMenuOpen]);
			const renderCopyFailure = (report, btnText = "复制诊断", className = "dsh-about-btn") => h("div", { className: "dsh-about-update-line" },
				h("button", { type: "button", className, onClick: () => copyFailure(report), title: "复制完整报错与环境信息，可直接发给 DSH 修复" }, btnText),
				h("span", { role: "status", className: "dsh-about-muted" }, copyMessage)
			);

			const onCheck = () => {
				if (checking || installing || restarting) return;
				setChecking(true);
				setSnapshot(null);
				fetch(ENDPOINT + "/check", { method: "POST" })
					.then((res) => res.json())
					.then((data) => {
						if (data && data.ok && data.updateAvailable) openPicker();
						setSnapshot(data);
					})
					.catch((error) => setSnapshot({ ok: false, error: String(error && error.message) }))
					.finally(() => setChecking(false));
			};

			const openPicker = () => {
				versionsSeqRef.current += 1;
				const seq = versionsSeqRef.current;
				setPickerOpen(true);
				setVersions(null);
				setVersionsError(null);
				setSelectedVersion(null);
				setUpdateResult(null);
				setManualRestartNeeded(false);
				setRestartReason(null);
				fetch(ENDPOINT + "/versions")
					.then((res) => res.json())
					.then((data) => {
						// 过期响应（用户已关闭并重开弹窗）直接丢弃，避免旧错误压过新数据
						if (seq !== versionsSeqRef.current) return;
						if (data && data.ok) {
							const list = data.versions || [];
							setVersions(list);
							// 默认选中一项，避免「安装所选版本」一上来就是灰的（见 pickDefaultVersion）
							setSelectedVersion(pickDefaultVersion(list));
						} else {
							setVersionsError(String((data && data.error) || "获取版本列表失败"));
						}
					})
					.catch((error) => {
						if (seq !== versionsSeqRef.current) return;
						setVersionsError(String(error && error.message));
					});
			};

			function handleInstallResult(data, version) {
				if (!data) throw new Error("空响应");
				if (data.ok && data.selfHealed === true) setSelfHealed(true);
				if (Array.isArray(data.compatibilityWarnings)) setCompatibilityWarnings(data.compatibilityWarnings);
				if (data.ok && data.restarting) {
					setInstalling(false);
					setRestarting(true);
					// 等**新进程**以「目标版本」就绪后自动刷新页面：
					//  - hostNonce = 刚应答更新请求的那个宿主（即将退出）的进程身份。
					//    describe 的 version 读的是**磁盘** package.json：npm 安装一落盘，
					//    仍在运行的旧进程就会报新版本。只比版本号会被旧进程冒充
					//    （旧实现的缺陷，Windows 侧验证时发现），故必须要求 nonce 也变。
					//  - 首轮轮询延迟 5s，避开宿主 2.5s 的退出窗口。
					//  - 轮询定时器统一登记在 pollTimerRef：组件卸载即清理，不再「幽灵刷新」。
					const fromNonce = typeof data.hostNonce === "string" ? data.hostNonce : null;
					let attempts = 0;
					const poll = () => {
						pollTimerRef.current = null;
						fetch(ENDPOINT + "/describe", { cache: "no-store" })
							.then((r) => r.json())
							.then((d) => {
								if (!mountedRef.current) return;
								// 进程身份是否已更换；宿主 describe 未带 nonce 时退回「只比版本号」
								const restarted = fromNonce === null
									? true
									: typeof d?.nonce === "string" && d.nonce !== fromNonce;
								if (d && d.ok && d.version === version && restarted) {
									setRestartDone(true);
									setRestarting(false);
									pollTimerRef.current = setTimeout(() => location.reload(), 1500);
								} else if (d && d.restartArmed === false && typeof d.lastRestartError === "string" && d.lastRestartError !== "") {
									// 宿主明确回报「看护没能布防」（restarter error / 找不到看护脚本）：
									// 立刻转手动重启提示，不再对着「正在自动重启…」空等 60 次（约 2 分钟）。
									setRestartReason(d.lastRestartError);
									setManualRestartNeeded(true);
									setRestarting(false);
								} else if (++attempts < 60) pollTimerRef.current = setTimeout(poll, 2000);
								else {
									setRestartFailed(true);
									setRestarting(false);
								}
							})
							.catch(() => {
								if (!mountedRef.current) return;
								if (++attempts < 60) pollTimerRef.current = setTimeout(poll, 2000);
								else {
									setRestartFailed(true);
									setRestarting(false);
								}
							});
					};
					pollTimerRef.current = setTimeout(poll, 5000);
				} else if (data.ok && !data.restarting) {
					// 安装成功但宿主未能布防自动重启：不轮询，直接提示手动重启
					setInstalling(false);
					setManualRestartNeeded(true);
					setRestartReason(data.lastRestartError || null);
				} else {
					setUpdateResult(data);
					setInstalling(false);
				}
			}

			const onInstall = (version) => {
				if (!version || installing || restarting) return;
				// 安装期间前端 bundle 会被就地替换，旧宿主对新 rev 的请求会 404 并
				// 把 SPA 打崩；先布防白屏自救守卫（组件被卸载也不会失效）。
				armWhiteScreenGuard();
				setInstalling(true);
				updateJobRef.current = null;
				updateSubmissionRef.current = { version, at: Date.now() };
				setUpdateResult(null);
				setSelfHealed(false);
				setCompatibilityWarnings([]);
				setUpdateProgress(null);
				setLastFailure(null);
				fetch(ENDPOINT + "/update", {
					method: "POST",
					headers: { "content-type": "application/json" },
					// port：上报当前页面真实端口，宿主据此决定重启后探测哪个端口
					// （覆盖 argv 解析，避免配置级改端口 / --port 0 场景下端口推断错误）
					body: JSON.stringify({ version, port: Number(window.location.port) || undefined })
				})
					.then((res) => res.json())
					.then((data) => {
						if (data?.accepted) {
							if (handledUpdateRef.current === data.id) return;
							setInstalling(true);
							updateJobRef.current = { id: data.id, version };
							try { sessionStorage.setItem("dsh-about-update-job", JSON.stringify(updateJobRef.current)); } catch {}
							return;
						}
						updateSubmissionRef.current = null;
						handleInstallResult(data, version);
					})
					.catch((error) => {
						setUpdateProgress({ stage: "连接中断，正在恢复任务状态", target: version });
					});
			};

			const onRefresh = () => {
				if (refreshing) return;
				setRefreshing(true);
				// 刷新版本记录的同时顺手强刷本插件版本：两者都在问「有没有更新」，
				// 一次点击同步检查（force=1 绕过宿主 5 分钟缓存）。
				loadPluginInfo(true);
				// force=1：手动刷新始终实时拉取（绕过宿主的「当日已缓存/当日已尝试」门控）
				fetch(ENDPOINT + "/releases?force=1")
					.then((res) => res.json())
					.then((data) => {
						applyReleasesResult(data);
						setRefreshing(false);
					})
					.catch(() => {
						markFetchFailed();
						setRefreshing(false);
					});
			};

			/** 保存或清除 GitHub token：成功后立即用新凭据重拉版本记录（宿主侧保存即生效，不必重启）。
			 *  value 为空串表示清除（回退到 GITHUB_TOKEN 环境变量 / 未认证）。 */
			const submitToken = (value) => {
				if (savingToken) return;
				setSavingToken(true);
				fetch(ENDPOINT + "/auth", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ token: value })
				})
					.then((res) => res.json())
					.then((data) => {
						if (!data || data.ok !== true) {
							setAuthError(String((data && data.error) || "保存失败"));
							return;
						}
						setAuthState({
							configured: data.configured === true,
							fromEnv: data.fromEnv === true,
							masked: typeof data.masked === "string" ? data.masked : ""
						});
						setAuthTest(null);
						setAuthError(null);
						setTokenDraft("");
						// 保存后自动重拉：成功弹对勾动画，失败立刻显示新的失败原因
						onRefresh();
					})
					.catch((error) => setAuthError(String(error && error.message)))
					.finally(() => setSavingToken(false));
			};

			/** 测试连接：用输入框草稿（未保存也能先验）或已生效的凭据打一次 GitHub，回报配额余量。 */
			const testToken = () => {
				if (testingAuth) return;
				setTestingAuth(true);
				setAuthTest(null);
				fetch(ENDPOINT + "/auth-test", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ token: tokenDraft.trim() })
				})
					.then((res) => res.json())
					.then((data) => {
						if (!data || data.ok !== true) {
							setAuthError(String((data && data.error) || "测试失败"));
							return;
						}
						setAuthError(null);
						setAuthTest(data);
					})
					.catch((error) => setAuthError(String(error && error.message)))
					.finally(() => setTestingAuth(false));
			};

			/** 测试结果文案：成功显示认证形态与配额余量（含本机重置时刻），失败显示宿主给出的原因。 */
			const authTestText = (result) => {
				if (result.success !== true) return String(result.error || "GitHub 接口返回异常");
				const quota = result.remaining !== null && result.limit !== null ? `剩余配额 ${result.remaining}/${result.limit}` : "已连通";
				const reset = result.resetAt ? `，重置时刻 ${new Date(result.resetAt).toLocaleString()}` : "";
				return (result.authenticated ? "认证有效，" : "未使用 token，") + quota + reset;
			};

			/* ───────────── 在线认证（GitHub 设备码授权） ───────────── */
			/** onRefresh 每次渲染都是新函数：用 ref 取最新引用，
			 *  否则它进了依赖数组会把轮询 effect 每渲染重建一次，定时器永远等不到 3s。 */
			const onRefreshRef = useRef(onRefresh);
			useEffect(() => {
				onRefreshRef.current = onRefresh;
			});
			/** 验证页地址固定，宿主也会回传一份；这里只在同步开窗时用兜底值。 */
			const VERIFY_FALLBACK = "https://github.com/login/device";

			/** 打开 GitHub 授权页。放在用户手势里调用，避免被弹窗拦截。 */
			const openVerifyPage = (uri) => {
				try {
					window.open(uri || VERIFY_FALLBACK, "_blank", "noopener,noreferrer");
				} catch {
					/* 被拦截：页面上另有可点的链接兜底 */
				}
			};

			/** 在线认证第一步：取一次性码。未配置 client_id 时宿主回指引，前端就地展示。 */
			const startDeviceAuth = () => {
				if (deviceState === "starting" || deviceState === "waiting") return;
				setDeviceState("starting");
				setDeviceError(null);
				setDeviceSetup(null);
				setCopiedCode(false);
				// 只有确实能发起时才开窗，避免未配置时弹出一个没用的标签页
				if (authState !== null && authState.deviceAvailable === true) openVerifyPage(VERIFY_FALLBACK);
				fetch(ENDPOINT + "/auth-device/start", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({})
				})
					.then((res) => res.json())
					.then((data) => {
						if (!data || data.ok !== true) {
							if (data && data.code === "NO_CLIENT_ID") {
								// 未配置 client_id：这是「还没开通」而不是失败，就地给注册指引，按钮仍可再点
								setDeviceSetup({
									error: String(data.error || "尚未配置 GitHub OAuth App 的 client_id"),
									setupUrl: typeof data.setupUrl === "string" ? data.setupUrl : ""
								});
								setDeviceState("idle");
							} else {
								setDeviceError(String((data && data.error) || "发起授权失败"));
								setDeviceState("error");
							}
							return;
						}
						setDeviceInfo({
							userCode: String(data.userCode || ""),
							verificationUri: String(data.verificationUri || VERIFY_FALLBACK),
							expiresIn: typeof data.expiresIn === "number" ? data.expiresIn : null
						});
						setDeviceState("waiting");
					})
					.catch((error) => {
						setDeviceError(String(error && error.message));
						setDeviceState("error");
					});
			};

			/** 放弃本次授权：清宿主侧尝试，回到初始态。 */
			const cancelDeviceAuth = () => {
				setDeviceInfo(null);
				setDeviceState("idle");
				setDeviceError(null);
				setCopiedCode(false);
				fetch(ENDPOINT + "/auth-device/cancel", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({})
				}).catch(() => {
					/* 取消失败无需打扰用户：宿主侧尝试会自行过期 */
				});
			};

			/** 复制一次性码。localhost 属于安全上下文，clipboard API 可用。 */
			const copyUserCode = (code) => {
				try {
					navigator.clipboard?.writeText(code).then(
						() => setCopiedCode(true),
						() => setCopiedCode(false)
					);
				} catch {
					setCopiedCode(false);
				}
			};

			/** 等待授权期间每 3s 问一次宿主；真正打 GitHub 的节奏由宿主按 interval 自己节流。 */
			useEffect(() => {
				if (deviceState !== "waiting") return undefined;
				let alive = true;
				const tick = () => {
					fetch(ENDPOINT + "/auth-device/poll", {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({})
					})
						.then((res) => res.json())
						.then((data) => {
							if (!alive || !data || data.ok !== true) return;
							if (typeof data.userCode === "string" && data.userCode !== "") {
								setDeviceInfo((prev) =>
									prev === null
										? prev
										: {
												...prev,
												userCode: data.userCode,
												verificationUri: typeof data.verificationUri === "string" ? data.verificationUri : prev.verificationUri
											}
								);
							}
							if (data.state === "authorized") {
								setAuthState({
									configured: data.configured === true,
									fromEnv: data.fromEnv === true,
									masked: typeof data.masked === "string" ? data.masked : "",
									deviceAvailable: data.deviceAvailable === true
								});
								setAuthTest(null);
								setAuthError(null);
								setTokenDraft("");
								setDeviceState("authorized");
								// 与「自定义」保存后一致：立刻用新凭据重拉版本记录
								onRefreshRef.current();
								return;
							}
							if (data.state === "expired" || data.state === "denied" || data.state === "error") {
								if (typeof data.error === "string" && data.error !== "") setDeviceError(data.error);
								setDeviceState(data.state);
							}
						})
						.catch(() => {
							/* 单次轮询失败忽略：下一轮继续，不打断等待 */
						});
				};
				const timer = setInterval(tick, 3000);
				return () => {
					alive = false;
					clearInterval(timer);
				};
			}, [deviceState]);

			/** 点「在线认证」：**只**展开面板，不当场发起。
			 *  授权页要等用户读完说明、再点面板里的「开始认证」才弹——点一下入口就弹窗太突兀。
			 *  开窗仍发生在「开始认证」的点击手势里，弹窗拦截规则不受影响。 */
			const onDeviceButton = () => {
				if (authPanel === "device") {
					setAuthPanel(null);
					return;
				}
				setAuthPanel("device");
				setDeviceSetup(null);
			};

			/** 「自定义」面板：手动粘贴 token（原输入框整套挪进二级面板）。 */
			const toggleCustomPanel = () => {
				setAuthError(null);
				setAuthPanel((prev) => (prev === "custom" ? null : "custom"));
			};

			const retryDeviceButton = () => h("button", { className: "dsh-about-btn", type: "button", onClick: startDeviceAuth }, "重新认证");

			/** 「在线认证」二级面板：设备码流程的各阶段。 */
			const renderDevicePanel = () => {
				// 宿主没配 client_id：这是维护者的一次性动作，不是用户操作失误——给注册指引而非报错
				if (deviceSetup !== null) {
					return h(
						"div",
						{ className: "dsh-about-auth-panel" },
						h("div", { className: "dsh-about-status dsh-about-status-warn" }, String(deviceSetup.error)),
						h(
							"div",
							{ className: "dsh-about-source-hint" },
							"启用它需要注册一个 GitHub OAuth App 并勾选 “Enable Device Flow”，把 client_id 填进插件源码的 GITHUB_DEVICE_CLIENT_ID（或用 DSH_ABOUT_GITHUB_CLIENT_ID 环境变量）。设备码流程不需要 client_secret，因此 client_id 可以公开分发。"
						),
						h(
							"div",
							{ className: "dsh-about-auth-row" },
							deviceSetup.setupUrl !== ""
								? h("button", { className: "dsh-about-btn", type: "button", onClick: () => openVerifyPage(deviceSetup.setupUrl) }, "打开注册页")
								: null
						)
					);
				}
				if (deviceState === "starting") {
					return h("div", { className: "dsh-about-auth-panel" }, h("div", { className: "dsh-about-status" }, "正在向 GitHub 申请授权码…"));
				}
				if (deviceState === "waiting" && deviceInfo !== null) {
					return h(
						"div",
						{ className: "dsh-about-auth-panel" },
						h("div", { className: "dsh-about-source-hint" }, "在 GitHub 授权页输入下面的授权码，完成授权后本面板会自动刷新："),
						h(
							"div",
							{ className: "dsh-about-device-code" },
							h("code", { className: "dsh-about-device-code-value" }, deviceInfo.userCode),
							h("button", { className: "dsh-about-btn", type: "button", onClick: () => copyUserCode(deviceInfo.userCode) }, copiedCode ? "已复制" : "复制"),
							h("button", { className: "dsh-about-btn", type: "button", onClick: () => openVerifyPage(deviceInfo.verificationUri) }, "打开授权页")
						),
						h("div", { className: "dsh-about-status" }, "等待授权…"),
						h("div", { className: "dsh-about-auth-row" }, h("button", { className: "dsh-about-btn", type: "button", onClick: cancelDeviceAuth }, "取消"))
					);
				}
				if (deviceState === "authorized") {
					return h(
						"div",
						{ className: "dsh-about-auth-panel" },
						h("div", { className: "dsh-about-status dsh-about-status-ok" }, "授权成功，token 已保存并生效"),
						h("div", { className: "dsh-about-auth-row" }, h("button", { className: "dsh-about-btn", type: "button", onClick: startDeviceAuth }, "再认证一次"))
					);
				}
				if (deviceState === "expired") {
					return h(
						"div",
						{ className: "dsh-about-auth-panel" },
						h("div", { className: "dsh-about-status dsh-about-status-err" }, "授权码已过期（有效期 15 分钟），请重新认证"),
						h("div", { className: "dsh-about-auth-row" }, retryDeviceButton())
					);
				}
				if (deviceState === "denied") {
					return h(
						"div",
						{ className: "dsh-about-auth-panel" },
						h("div", { className: "dsh-about-status dsh-about-status-err" }, "你在 GitHub 上取消了授权"),
						h("div", { className: "dsh-about-auth-row" }, retryDeviceButton())
					);
				}
				if (deviceState === "error") {
					return h(
						"div",
						{ className: "dsh-about-auth-panel" },
						h("div", { className: "dsh-about-status dsh-about-status-err" }, String(deviceError || "在线认证失败")),
						h("div", { className: "dsh-about-auth-row" }, retryDeviceButton())
					);
				}
				// idle：上次已结束或首次展开——给一个明确的起点，而不是空白
				return h(
					"div",
					{ className: "dsh-about-auth-panel" },
					h("div", { className: "dsh-about-source-hint" }, "点「开始认证」会自动打开 GitHub 授权页，输入页面上显示的授权码即可；token 由插件直接保存，无需手动复制。"),
					h("div", { className: "dsh-about-auth-row" }, h("button", { className: "dsh-about-btn dsh-about-btn-primary", type: "button", onClick: startDeviceAuth }, "开始认证"))
				);
			};

			/** 「自定义」二级面板：粘贴 / 测试 / 保存 / 清除。 */
			const renderCustomPanel = () =>
				h(
					"div",
					{ className: "dsh-about-auth-panel" },
					h("div", { className: "dsh-about-source-hint" }, "在 GitHub 生成 token 后粘贴到这里。公开仓库无需勾选任何 scope(权限)，token 只存本机。"),
					h(
						"div",
						{ className: "dsh-about-auth-row" },
						h("input", {
							className: "dsh-about-auth-input",
							type: "password",
							value: tokenDraft,
							placeholder: authState !== null && (authState.configured || authState.fromEnv) ? "已设置，填写新值可替换" : "ghp_… 或 github_pat_…",
							autoComplete: "off",
							spellCheck: false,
							"aria-label": "GitHub personal access token",
							onChange: (e) => setTokenDraft(e.target.value),
							onKeyDown: (e) => {
								if (e.key === "Enter" && tokenDraft.trim() !== "" && !savingToken) submitToken(tokenDraft.trim());
							}
						}),
						h("button", { className: "dsh-about-btn dsh-about-btn-primary", type: "button", disabled: savingToken || tokenDraft.trim() === "", onClick: () => submitToken(tokenDraft.trim()) }, savingToken ? "保存中…" : "保存"),
						h("button", { className: "dsh-about-btn", type: "button", disabled: testingAuth, onClick: testToken }, testingAuth ? "测试中…" : "测试连接"),
						authState !== null && authState.configured ? h("button", { className: "dsh-about-btn", type: "button", disabled: savingToken, onClick: () => submitToken("") }, "清除") : null
					),
					authTest !== null ? h("div", { className: "dsh-about-status " + (authTest.success === true ? "dsh-about-status-ok" : "dsh-about-status-err") }, authTestText(authTest)) : null,
					authError !== null ? h("div", { className: "dsh-about-status dsh-about-status-err" }, String(authError)) : null
				);

			/** 版本记录下拉：切换某版本的描述展开状态（Set 增删，支持同时展开多个）。
			 *  只更新状态；展开/收起动画由下方 effect 统一驱动（量 scrollHeight 设 inline max-height 过渡）。 */
			const toggleRelease = (version) => {
				setExpandedReleases((prev) => {
					const next = new Set(prev);
					if (next.has(version)) next.delete(version);
					else next.add(version);
					return next;
				});
			};

			const row = (label, value, extra) =>
				h("div", { className: "dsh-about-row" }, h("dt", null, label), h("dd", null, value, extra !== undefined ? h("span", { className: "dsh-about-muted" }, " " + extra) : null));
			/** 同上，但标签/取值可以是任意节点（插件版本行要在标签右上角挂红点）。 */
			const rowNode = (labelNode, valueNode) =>
				h("div", { className: "dsh-about-row" }, h("dt", { className: "dsh-about-row-label" }, labelNode), h("dd", null, valueNode));

			/* 报错记录保留在磁盘，是否展示只看版本：目标版本 <= 当前安装版本时
			 * （或后端已标记 superseded）就不再当作“本次更新失败”提示。 */
			const runningForFailure = lastFailure === null ? null
				: lastFailure.kind === "plugin" ? pluginInfo?.version : info?.version;
			const visibleFailure = lastFailure === null || lastFailure.superseded === true ||
				(typeof runningForFailure === "string" && lastFailure.target === runningForFailure)
				? null : lastFailure;
			/** 当前弹窗要展示的诊断：历史条目优先，其次才是最近一次失败。 */
			const shownFailure = failureDetail ?? visibleFailure;

			/* ── 报错历史：感叹号悬停预览 + 单击二级菜单 + 更新行下方常驻列表 ── */
			const historyCount = Array.isArray(failureHistory) ? failureHistory.length : 0;
			/** 表面列表只放「仍需处理」的失败；悬停预览与二级菜单展示全部历史（含已覆盖）。 */
			const pendingHistory = Array.isArray(failureHistory)
				? failureHistory.filter((entry) => entry && entry.superseded !== true)
				: [];
			const pendingCount = pendingHistory.length;
			/** 首次读取与「暂无记录」是两件事，失败时也不能假装没有记录。 */
			const historyLoading = failureHistoryBusy && failureHistory === null;
			const historyFailed = failureHistoryError !== null;
			const bangAttention = historyCount > 0 || historyFailed;
			const historyKey = (entry, index) => String(entry.id || "entry") + ":" + String(entry.finishedAt || index);
			const historyTarget = (entry) => (entry.kind === "plugin" ? "dsh-about" : "DSH") + " v" + (entry.target || "?");
			const historyStage = (entry) => UPDATE_STAGES[entry.stage] || entry.stage || "更新失败";
			const historyTime = (entry) => entry.finishedAt ? new Date(entry.finishedAt).toLocaleString() : "时间未知";
			/** 复制提示只在对应的那块区域回显，避免同一条消息在历史区和失败卡片里重复出现。 */
			const copiedEntry = (entry) => copyStatus !== null && entry.id === copyStatus.id && entry.finishedAt === copyStatus.finishedAt;
			const historyCopyMessage = copyStatus !== null && Array.isArray(failureHistory) &&
				failureHistory.some(copiedEntry)
				? copyStatus.message : "";
			const pendingCopyMessage = copyStatus !== null && pendingHistory.some(copiedEntry)
				? copyStatus.message : "";
			const failureCopyMessage = copyStatus !== null && lastFailure !== null &&
				copyStatus.id === lastFailure.id && copyStatus.finishedAt === lastFailure.finishedAt
				? copyStatus.message : "";
			/** 常驻列表与二级菜单共用的一行：版本 / 阶段 / 摘要 / 详情与复制。 */
			const renderHistoryEntry = (entry, index) => h("div", {
				className: "dsh-about-history-item" + (entry.superseded === true ? " dsh-about-history-item-old" : ""),
				key: historyKey(entry, index)
			},
				h("div", { className: "dsh-about-history-main" },
					h("div", { className: "dsh-about-history-title" },
						h("span", null, historyTarget(entry)),
						h("span", { className: "dsh-about-history-badge" }, historyStage(entry)),
						entry.superseded === true ? h("span", { className: "dsh-about-status-ok-badge" }, "已被新版本覆盖") : null
					),
					h("div", { className: "dsh-about-history-summary" }, String(entry.summary || entry.error || "无摘要")),
					h("div", { className: "dsh-about-history-meta" }, historyTime(entry) + (entry.id ? " · " + entry.id : ""))
				),
				h("div", { className: "dsh-about-history-actions" },
					h("button", { type: "button", className: "dsh-about-btn", onClick: () => openHistoryDetail(entry) }, "详情"),
					h("button", { type: "button", className: "dsh-about-btn", onClick: () => copyFailure(entry) }, "复制")
				)
			);
			/** 悬停预览里的紧凑行：点击直接进入完整诊断。 */
			const renderHistoryPreviewEntry = (entry, index) => h("button", {
				type: "button",
				key: historyKey(entry, index),
				className: "dsh-about-bang-item" + (entry.superseded === true ? " dsh-about-bang-item-old" : ""),
				onClick: () => openHistoryDetail(entry),
				title: entry.superseded === true ? "已被当前版本覆盖；点击仍可查看完整诊断" : "查看这条报错的完整诊断"
			},
				h("span", { className: "dsh-about-bang-item-head" },
					h("span", null, historyTarget(entry)),
					h("span", { className: "dsh-about-history-badge" }, historyStage(entry)),
					entry.superseded === true
						? h("span", { className: "dsh-about-status-ok-badge", title: "目标版本已被当前版本覆盖" }, "已覆盖")
						: null,
					h("span", { className: "dsh-about-bang-item-time" }, historyTime(entry))
				),
				h("span", { className: "dsh-about-bang-item-summary" }, String(entry.summary || entry.error || "无摘要"))
			);

			return h("div", { className: "dsh-about" },
				platformNoticeVisible
					? h("div", { className: "dsh-about-overlay", onClick: (e) => { if (e.target === e.currentTarget) setPlatformNoticeOpen(false); } },
						h("div", { className: "dsh-about-dialog", role: "dialog", "aria-modal": "true", "aria-labelledby": "dsh-about-platform-notice-title", "aria-describedby": "dsh-about-platform-notice-body", ref: platformNoticeRef },
							h("div", { className: "dsh-about-dialog-title", id: "dsh-about-platform-notice-title" }, "平台支持调整"),
							h("div", { className: "dsh-about-dialog-hints", id: "dsh-about-platform-notice-body" },
								h("div", null, "dsh-about 计划在后续版本停止支持 Windows 和 macOS，推荐使用支持自动更新的官方桌面端。"),
								h("div", { className: "dsh-about-muted" }, "当前版本仍保留三平台支持。此提示仅显示一次。")
							),
							h("div", { className: "dsh-about-dialog-actions" },
								h("button", { className: "dsh-about-btn dsh-about-btn-primary", type: "button", onClick: () => setPlatformNoticeOpen(false) }, "我知道了")
							)
						)
					)
					: null,
				h("div", { className: "dsh-about-hero" },
					h("div", { className: "dsh-about-hero-main" },
						h("svg", { className: "dsh-about-logo", viewBox: "0 0 50 50", "aria-hidden": "true" },
							h("path", { d: LOGO_PATH })
						),
						h("div", null,
							h("div", { className: "dsh-about-name" }, "DeepSeek Harness"),
							h("div", { className: "dsh-about-sub" }, "DeepSeek 官方 AI 智能体工作台")
						)
					),
					// 页面右上角：本插件项目主页（GitHub）
					h("a", { className: "dsh-about-gh", href: PLUGIN_REPO, target: "_blank", rel: "noreferrer", title: "GitHub · dsh-about 项目主页", "aria-label": "在 GitHub 打开项目主页" },
						h("svg", { className: "dsh-about-gh-icon", viewBox: "0 0 24 24", "aria-hidden": "true" },
							h("path", { d: GITHUB_PATH })
						)
					)
				),
				describeError !== null
					? h("div", { className: "dsh-about-status dsh-about-status-err" }, "获取版本信息失败：" + describeError)
					: h("dl", { className: "dsh-about-rows" },
						row("平台", info ? info.platform : "加载中…"),
						row("当前版本", info ? "v" + info.version : "加载中…"),
						// 本插件自身的版本：标签「插件版本」右上角挂「有新版本」小红点，版本号可点击更新（带小箭头）
						rowNode(
							[
								h("span", { key: "t" }, "插件版本"),
								pluginHasUpdate ? h("span", { key: "d", className: "dsh-about-label-dot", "aria-hidden": "true" }) : null
							],
							pluginInfo
								? [
									h("button", {
										className: "dsh-about-ver-link",
										type: "button",
										key: "v",
										disabled: pluginBusy || pluginRestarting,
										title: pluginIsLocal
											? "本地源码安装（v" + pluginInfo.version + "）：自更新会覆盖开发目录，请手动同步源码"
											: pluginCanUpdate
												? "点击更新到 v" + pluginInfo.newest
												: "已是最新版本，点击重新检查",
										onClick: onPluginVersionClick
									}, "v" + pluginInfo.version,
										pluginCanUpdate ? h("span", { className: "dsh-about-ver-arrow", "aria-hidden": "true" }) : null),
									pluginIsLocal
										? h("span", { className: "dsh-about-muted dsh-about-ver-note", key: "local" }, pluginHasUpdate ? "npm 已有 v" + pluginInfo.newest + "，本地源码安装需手动同步" : "本地源码安装")
										: null
								]
								: pluginInfoError !== null
									? h("span", { className: "dsh-about-muted" }, "获取失败")
									: "加载中…"
						),
						// 作者署名：跟随「插件版本」行，指向 GitHub 主页
						row("作者", h("a", { href: AUTHOR_URL, target: "_blank", rel: "noreferrer" }, "@" + AUTHOR))
					),
					// 更新源不可达时的可执行提示（宿主在失败路径探测出备选源后带回）。
					// 单独占一行而不是塞进「插件版本」行：文案很长，塞进行里会把行标签挤断行。
					// 只在「还没点过检查更新」时显示，点了之后由下方检查结果那一行接管，避免重复。
					snapshot === null && pluginInfo && pluginInfo.sourceHint
						? h("div", { className: "dsh-about-update-line" },
							h("span", { className: "dsh-about-status dsh-about-status-warn" }, String(pluginInfo.sourceHint))
						)
						: null,
					// 「建议优先更新本插件」：紧跟「插件版本」行下方；不放按钮，引导点上面的版本号
					pluginHasUpdate && !pluginIsLocal
						? h("div", { className: "dsh-about-priority" },
							h("div", { className: "dsh-about-priority-title" }, "建议优先更新本插件"),
							h("div", null, "dsh-about v" + pluginInfo.version + " → v" + pluginInfo.newest + "：DSH 升级后旧版插件可能无法正常工作，点击上方 v" + pluginInfo.version + " 即可更新。")
						)
						: null,
					/* ───────────── 更新源选择 + 延迟检测（下拉样式） ───────────── */
					h("div", { className: "dsh-about-source" },
						h("div", { className: "dsh-about-source-head" },
							h("span", { className: "dsh-about-source-title" }, "更新源"),
							sourceState === null
								? h("span", { className: "dsh-about-muted" }, "加载中…")
								: h("div", { className: "dsh-about-source-select", role: "combobox", "aria-expanded": sourceOpen, tabIndex: 0, onClick: toggleSource, onKeyDown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleSource(); } } },
									h("span", { className: "dsh-about-source-select-value" }, sourceState.sources.find((s) => s.id === sourceState.current)?.label || sourceState.current),
									h("span", { className: "dsh-about-source-select-arrow" + (sourceOpen ? " dsh-about-source-select-arrow-open" : "") }, "▾")
								)
						),
						// 下拉容器：打开/收起动画都作用于它（收起动画结束后才卸载）。
						// 内容 = 提示行 + 源菜单。收起动画进行中 aria-hidden 屏蔽可访问性。
						(sourceOpen || sourceClosing) && sourceState !== null
							? h("div", {
								className: "dsh-about-source-drop" + (sourceClosing ? " dsh-about-source-drop-closing" : ""),
								"aria-hidden": sourceClosing
							},
								h("div", { className: "dsh-about-source-hint" }, "点击「未检测」测试该源延迟；点击源行切换。国内镜像（npmmirror）为官方源缓存代理，同步存在轻微延迟；「本地配置」跟随 npm config get registry。"),
								h("div", { className: "dsh-about-source-menu", role: "listbox" },
									sourceState.sources.map((s) => {
										const ping = pings ? pings[s.id] : null;
										const isCurrent = s.id === sourceState.current;
										// 注意: 逐个检测只写被测源一个 key, 其余源 pings[s.id] 是 undefined ——
										// 必须用 !ping(同时覆盖 null/undefined) 判「未检测」, 不能只判 === null
										const latText = !ping
											? "未检测"
											: ping.ok
												? ping.ms + " ms"
												: "不可达";
										const latCls = !ping
											? "dsh-about-source-lat dsh-about-source-lat-unknown"
											: ping.ok
												? "dsh-about-source-lat dsh-about-source-lat-ok"
												: "dsh-about-source-lat dsh-about-source-lat-err";
										// 每个选项行：点击整行 = 切换源（禁点当前源）；延迟文本单独可点（测该源），
										// 需 stopPropagation 防止冒泡到整行导致「点一下延迟却切了源」
										return h("div", {
											className: "dsh-about-source-opt" + (isCurrent ? " dsh-about-source-opt-current" : ""),
											key: s.id,
											role: "option",
											"aria-selected": isCurrent,
											onClick: () => { if (!isCurrent) switchSource(s.id); },
											title: isCurrent ? "当前源" : "点击切换到此源"
										},
											h("span", { className: "dsh-about-source-opt-name" }, s.label),
											h("span", { className: "dsh-about-source-opt-code" }, s.host),
											h("span", {
												className: latCls + " dsh-about-source-lat-clickable",
												role: "button",
												title: !ping ? "点击检测此源延迟" : (ping.ok ? "已检测，点击重新检测" : String(ping.error || "连接失败，点击重试")),
												onClick: (e) => { e.stopPropagation(); pingSource(s.id); }
											}, pingingSrc === s.id ? "检测中…" : latText)
										);
									})
								)
							)
							: null,
						sourceError !== null
							? h("div", { className: "dsh-about-status dsh-about-status-err" }, String(sourceError))
							: null
						),
						/* ───────────── GitHub 认证：在线认证（设备码授权）/ 自定义（粘贴 token） ───────────── */
						h("div", { className: "dsh-about-auth" },
							h("div", { className: "dsh-about-auth-head" },
								h("span", { className: "dsh-about-auth-title" }, "GitHub 认证"),
								authState === null
									? h("span", { className: "dsh-about-auth-state" }, "加载中…")
									: authState.masked === ""
										? h("span", { className: "dsh-about-auth-state" }, "未设置")
										: h("span", { className: "dsh-about-auth-state" }, "已设置 " + authState.masked + (authState.fromEnv ? "（来自 GITHUB_TOKEN 环境变量）" : "（账号级 5000 次/小时）")),
								// 两个入口按钮右对齐；当前展开的那个高亮
								h("div", { className: "dsh-about-auth-actions" },
									h("button", { className: "dsh-about-btn" + (authPanel === "device" ? " dsh-about-btn-on" : ""), type: "button", onClick: onDeviceButton }, "在线认证"),
									h("button", { className: "dsh-about-btn" + (authPanel === "custom" ? " dsh-about-btn-on" : ""), type: "button", onClick: toggleCustomPanel }, "自定义")
								)
							),
							// 未认证：出口 IP 共享 60 次/小时的匿名配额（认证后升到账号级 5000）
							authState !== null && authState.configured === false
								? h("div", { className: "dsh-about-status dsh-about-status-err dsh-about-auth-warn" }, "未认证出口IP限60次每小时，推荐认证")
								: null,
							authPanel === "device" ? renderDevicePanel() : null,
							authPanel === "custom" ? renderCustomPanel() : null
						),
						h("div", { className: "dsh-about-update" },
					h("div", { className: "dsh-about-update-line" },
						h("button", { className: "dsh-about-btn dsh-about-btn-primary", type: "button", onClick: onCheck, disabled: checking || installing || restarting },
							checking ? "正在检查…" : "检查更新"
						),
						/* 报错历史入口：悬停预览全部记录，单击打开可滚动的二级菜单。
						 * 没有记录时保留中性色感叹号，避免「报错历史」四个字单独占一行。 */
						h("span", { className: "dsh-about-bang", ref: bangRef, onMouseEnter: placeBangMenu },
							h("button", {
								type: "button",
								className: "dsh-about-bang-btn" + (bangAttention ? "" : " dsh-about-bang-btn-idle"),
								onClick: openHistoryMenu,
								"aria-haspopup": "dialog",
								"aria-label": "报错历史（" +
									(historyCount > 0 ? historyCount + " 条" : historyLoading ? "正在读取" : historyFailed ? "获取失败" : "暂无记录") +
									"）"
							}, "!"),
							h("div", { className: "dsh-about-bang-menu", role: "group", "aria-label": "报错历史预览", ref: bangMenuRef },
								h("div", { className: "dsh-about-bang-head" },
									h("span", { className: "dsh-about-bang-title" }, "报错历史"),
									h("span", { className: "dsh-about-muted" }, historyCount > 0
										? "共 " + historyCount + " 条" +
											(pendingCount === 0 ? " · 均已覆盖" : pendingCount < historyCount ? " · " + pendingCount + " 条待处理" : "") +
											" · 点击感叹号查看全部"
										: historyLoading ? "读取中…" : historyFailed ? "读取失败" : "暂无记录")
								),
								historyCount > 0
									? h("div", { className: "dsh-about-bang-list", ref: bangListRef }, failureHistory.map(renderHistoryPreviewEntry))
									: h("div", { className: "dsh-about-bang-empty" },
										historyLoading ? "正在读取…" : historyFailed ? String(failureHistoryError) : "暂无报错记录")
							)
						),
						snapshot !== null
							? snapshot.ok
								? snapshot.updateAvailable
									? h("span", { className: "dsh-about-status dsh-about-status-warn" }, "发现新版本 v" + snapshot.newest + (snapshot.newestKind === "alpha" ? "（开发者预览版 alpha）" : snapshot.newestKind === "beta" ? "（Beta 测试版）" : snapshot.source === "next" ? "（next 预览版）" : snapshot.newestKind === "rc" ? "（预览版 rc）" : "（latest 稳定版）"))
									: snapshot.github !== null && snapshot.github.aheadOfNpm === true
										? h("span", { className: "dsh-about-status dsh-about-status-warn" },
										"GitHub 已发布 " + (snapshot.github.kind === "alpha" ? "开发者预览版 " : snapshot.github.kind === "beta" ? "Beta 测试版 " : snapshot.github.prerelease ? "预览版 " : "") + "v" + snapshot.github.newest +
										(snapshot.github.onNpm === true ? "（npm 已发布但未标记 latest/next，可手动安装）" : "（npm 尚未发布，发布后即可一键更新）"))
										: h("span", { className: "dsh-about-status dsh-about-status-ok" }, "已是最新版本 v" + snapshot.current)
								: h("span", { className: "dsh-about-status dsh-about-status-err" }, String(snapshot.error || "检查失败"))
							: h("span", { className: "dsh-about-muted" }, "点「检查更新」后可从弹窗选择要安装的版本")
					),
					// 源不可达时的可操作提示：宿主已在失败路径探测出哪个内置源可用，
					// 直接把「fetch failed」翻译成「切到哪个源」（见 index.js unreachableSourceHint）
					snapshot !== null && snapshot.ok === false && snapshot.sourceHint
						? h("div", { className: "dsh-about-update-line" },
							h("span", { className: "dsh-about-status dsh-about-status-warn" }, String(snapshot.sourceHint))
						)
						: null,
					/* 报错历史：表面上只常驻「仍需处理」的失败；已覆盖的旧记录只进感叹号的
					 * 悬停预览与二级菜单，保持页面干净。 */
					failureHistoryError !== null || pendingCount > 0
						? h("div", { className: "dsh-about-history" },
							failureHistoryError !== null
								? h("div", { className: "dsh-about-status dsh-about-status-err" }, String(failureHistoryError))
								: null,
							pendingCount > 0
								? h("div", { className: "dsh-about-history-panel", role: "group", "aria-label": "待处理的报错", tabIndex: 0 },
									pendingHistory.map(renderHistoryEntry)
								)
								: null,
							pendingCopyMessage ? h("div", { role: "status", className: "dsh-about-muted" }, pendingCopyMessage) : null
						)
						: null,
					visibleFailure && h("details", { className: "dsh-about-failure-card", open: true },
						h("summary", { className: "dsh-about-failure-summary" },
							h("span", { className: "dsh-about-failure-summary-title" },
								h("svg", { className: "dsh-about-fail-icon", viewBox: "0 0 16 16", "aria-hidden": "true" },
									h("path", { d: "M8 14.5A6.5 6.5 0 1 1 8 1.5a6.5 6.5 0 0 1 0 13Zm0-9.3a.8.8 0 0 0-.8.8v3a.8.8 0 0 0 1.6 0V6a.8.8 0 0 0-.8-.8Zm0 6.6a.95.95 0 1 0 0-1.9.95.95 0 0 0 0 1.9Z" })
								),
								"上次更新失败 · " + (lastFailure.kind === "plugin" ? "dsh-about" : "DSH") +
									(lastFailure.target ? " v" + lastFailure.target : "")
							),
							lastFailure.rolledBack === true
								? h("span", { className: "dsh-about-status-ok-badge" }, "已安全回退到 " + (lastFailure.installedVersion || "旧版"))
								: lastFailure.stage === "preflight"
									? h("span", { className: "dsh-about-status-ok-badge" }, "预检拦截")
									: h("span", { className: "dsh-about-fail-badge" }, "更新失败")
						),
						h("div", { className: "dsh-about-failure-body" },
							h("div", { className: "dsh-about-failure-callout", "data-joi-spot": "1" },
								h("div", { className: "dsh-about-status dsh-about-status-err", "data-joi-spot": "1" }, lastFailure.summary),
								lastFailure.rolledBack === true
									? h("div", { className: "dsh-about-failure-rollback" }, "✓ 已恢复到 " + (lastFailure.installedVersion || "旧版") + "，系统未受改动")
									: lastFailure.stage === "preflight"
										? h("div", { className: "dsh-about-failure-rollback" }, "✓ 正式安装保持原版本")
										: null
							),
							lastFailure.checks && lastFailure.checks.length > 0
								? h("div", { className: "dsh-about-fail-steps" },
									h("div", { className: "dsh-about-fail-steps-list" },
										lastFailure.checks.map((chk, idx) => h("div", { key: idx, className: "dsh-about-fail-step-item" },
											h("span", { className: chk.ok ? "dsh-about-step-tag dsh-about-step-pass" : "dsh-about-step-tag dsh-about-step-fail" },
												chk.ok ? "通过" : "失败"
											),
											h("span", { className: "dsh-about-step-name" }, UPDATE_STAGES[chk.phase] || chk.phase),
											chk.code != null ? h("span", { className: "dsh-about-muted" }, `(退出码 ${chk.code})`) : null,
											chk.dependency ? h("span", { className: "dsh-about-step-dep" }, `${chk.dependency.name}${chk.dependency.version ? "@" + chk.dependency.version : ""}`) : null
										))
									)
								)
								: null,
							h("div", { className: "dsh-about-failure-actions" },
								h("button", { type: "button", className: "dsh-about-btn dsh-about-btn-primary", onClick: () => openFailureDetail(visibleFailure) }, "查看详细诊断"),
								h("button", { type: "button", className: "dsh-about-btn", onClick: () => copyFailure(visibleFailure) }, "复制诊断"),
								h("span", { role: "status", className: "dsh-about-muted" }, failureCopyMessage)
							),
							h("pre", { className: "dsh-about-tail", tabIndex: 0 }, formatUpdateFailure(lastFailure))
						)
					),
					compatibilityWarnings.length > 0
						? h("div", { className: "dsh-about-compat-line" },
							h("div", { className: "dsh-about-compat-summary" },
								h("span", { className: "dsh-about-status dsh-about-status-warn" }, "已安装插件存在 peer 依赖兼容性提示"),
								h("button", {
									type: "button",
									className: "dsh-about-compat-toggle",
									onClick: () => setCompatDetailsOpen((prev) => !prev),
									"aria-expanded": compatDetailsOpen
								}, compatDetailsOpen ? "收起详情" : "查看详情"),
								h("span", {
									className: "dsh-about-compat-icon-wrap",
									tabIndex: 0,
									role: "img",
									"aria-label": "兼容性提示说明",
									"aria-describedby": "dsh-about-compat-explanation"
								},
									h("span", { className: "dsh-about-compat-icon", "aria-hidden": "true" }, "!"),
									h("span", { id: "dsh-about-compat-explanation", className: "dsh-about-compat-menu", role: "tooltip" },
										"部分插件声明的依赖范围与当前 DSH 组件版本不匹配，也可能存在依赖缺失、版本范围无法解析或扫描失败。预发布版本可能尚未被插件声明支持；这不等于功能一定不可用，也不能保证兼容，请查看详情并确认插件适配情况。"
									)
								)
							),
							compatDetailsOpen
								? h("div", { className: "dsh-about-compat-details" },
									h("ul", { className: "dsh-about-compat-list" },
										compatibilityWarnings.map((w, idx) =>
											h("li", { key: idx, className: "dsh-about-compat-item" },
												w.plugin
													? [
														h("strong", { key: "name" }, `${w.plugin}@${w.version}: `),
														h("span", { key: "mismatches" }, w.mismatches.join("; "))
													]
													: String(w.error)
											)
										)
									)
								)
								: null
						)
						: null,
					snapshot !== null && snapshot.ok && snapshot.updateAvailable
						? h("div", { className: "dsh-about-dialog-hints" },
							snapshot.newestKind === "alpha" ? kindWarn("alpha") : snapshot.newestKind === "beta" ? kindWarn("beta") : null,
							compatWarn()
						)
						: null,
					snapshot !== null && snapshot.ok && !pickerOpen && !restarting && (snapshot.updateAvailable || (snapshot.github !== null && snapshot.github.aheadOfNpm === true && snapshot.github.onNpm === true))
						? h("div", { className: "dsh-about-update-line" },
							h("button", { className: "dsh-about-btn", type: "button", onClick: openPicker }, "选择版本安装")
						)
						: null,
					pickerOpen
						? h("div", { className: "dsh-about-overlay", onClick: (e) => { if (e.target === e.currentTarget && !installing && !restarting) setPickerOpen(false); } },
							h("div", { className: "dsh-about-dialog", role: "dialog", "aria-modal": "true", "aria-labelledby": "dsh-about-dialog-title", tabIndex: -1, ref: dialogRef },
								restartDone
									? h("div", null,
										h("div", { className: "dsh-about-dialog-title", id: "dsh-about-dialog-title" }, "重启完成"),
										h("div", { className: "dsh-about-status dsh-about-status-ok" }, "已安装 v" + selectedVersion + " 并自动重启成功，页面即将刷新…"),
										selfHealed ? h("div", { className: "dsh-about-muted" }, SELF_HEALED_NOTE) : null,
										compatibilityWarnings.length > 0 ? h("div", { className: "dsh-about-status dsh-about-status-warn" }, "检测到插件与当前 dsh 不兼容：" + compatibilityWarnings.map((w) => w.plugin ? `${w.plugin}@${w.version}: ${w.mismatches.join("; ")}` : w.error).join("；")) : null,
										h("div", { className: "dsh-about-dialog-actions" },
											h("button", { className: "dsh-about-btn dsh-about-btn-primary", type: "button", onClick: () => location.reload() }, "立即刷新")
										)
									)
									: restartFailed
										? h("div", null,
											h("div", { className: "dsh-about-dialog-title", id: "dsh-about-dialog-title" }, "自动重启未完成"),
											h("div", { className: "dsh-about-status dsh-about-status-err" }, "新版本未在 2 分钟内就绪。请手动运行 dsh web 启动新版本，或刷新页面重试。"),
											h("div", { className: "dsh-about-dialog-actions" },
												h("button", { className: "dsh-about-btn dsh-about-btn-primary", type: "button", onClick: () => location.reload() }, "刷新页面"),
												h("button", { className: "dsh-about-btn", type: "button", onClick: () => setPickerOpen(false) }, "知道了")
											)
										)
									: restarting
										? h("div", null,
											h("div", { className: "dsh-about-dialog-title", id: "dsh-about-dialog-title" }, "安装成功，正在自动重启"),
											h("div", { className: "dsh-about-status dsh-about-status-ok" }, "已安装 v" + selectedVersion + "，正在以新版本重新启动 dsh…（约需十几秒）"),
											compatibilityWarnings.length > 0 ? h("div", { className: "dsh-about-status dsh-about-status-warn" }, "检测到插件与当前 dsh 不兼容：" + compatibilityWarnings.map((w) => w.plugin ? `${w.plugin}@${w.version}: ${w.mismatches.join("; ")}` : w.error).join("；")) : null
										)
										: manualRestartNeeded
											? h("div", null,
												h("div", { className: "dsh-about-dialog-title", id: "dsh-about-dialog-title" }, "安装成功，需要手动重启"),
												h("div", { className: "dsh-about-status dsh-about-status-warn" }, "已安装 v" + selectedVersion + "，但自动重启未能启动，请手动运行：dsh web"),
												restartReason !== null ? h("div", { className: "dsh-about-muted" }, "原因：" + restartReason) : null,
											selfHealed ? h("div", { className: "dsh-about-muted" }, SELF_HEALED_NOTE) : null,
											compatibilityWarnings.length > 0 ? h("div", { className: "dsh-about-status dsh-about-status-warn" }, "检测到插件与当前 dsh 不兼容：" + compatibilityWarnings.map((w) => w.plugin ? `${w.plugin}@${w.version}: ${w.mismatches.join("; ")}` : w.error).join("；")) : null,
												h("div", { className: "dsh-about-dialog-actions" },
													h("button", { className: "dsh-about-btn", type: "button", onClick: () => setPickerOpen(false) }, "知道了")
												)
											)
										: installing
											? h("div", null,
												h("div", { className: "dsh-about-dialog-title", id: "dsh-about-dialog-title" }, (updateProgress?.stage === "preflight" ? "正在隔离预检 v" : "正在更新到 v") + selectedVersion),
												h("div", { className: "dsh-about-muted" }, updateProgress ? (UPDATE_STAGES[updateProgress.stage] || updateProgress.stage) : "正在启动独立更新任务…"),
												updateProgress?.preflightWarnings?.length > 0 ? h("div", { className: "dsh-about-status dsh-about-status-warn" }, "预检发现插件依赖兼容性提示") : null
											)
										: updateResult !== null && !updateResult.ok
											? h("div", { className: "dsh-about-fail-view" },
												h("div", { className: "dsh-about-dialog-title", id: "dsh-about-dialog-title" }, "更新未完成 · " + (selectedVersion ? "DSH v" + selectedVersion : "失败")),
												h("div", { className: "dsh-about-fail-callout", "data-joi-spot": "1" },
													h("div", { className: "dsh-about-fail-header-row", "data-joi-spot": "1" },
														h("span", { className: "dsh-about-fail-badge" }, "失败阶段：" + (UPDATE_STAGES[lastFailure?.stage || updateProgress?.stage] || "校验未通过")),
														lastFailure?.rolledBack === true
															? h("span", { className: "dsh-about-status-ok-badge" }, "已安全回退到 " + (lastFailure.installedVersion || "旧版"))
															: lastFailure?.stage === "preflight"
																? h("span", { className: "dsh-about-status-ok-badge" }, "隔离预检拦截（原版本未改动）")
																: null
													),
													h("div", { className: "dsh-about-fail-summary-text" }, String(lastFailure?.summary || updateResult.error || "更新校验未通过，请查看下方日志"))
												),
												lastFailure?.checks && lastFailure.checks.length > 0
													? h("div", { className: "dsh-about-fail-steps" },
														h("div", { className: "dsh-about-fail-section-header" }, "各环节执行结果"),
														h("div", { className: "dsh-about-fail-steps-list" },
															lastFailure.checks.map((chk, idx) => h("div", { key: idx, className: "dsh-about-fail-step-item" },
																h("span", { className: chk.ok ? "dsh-about-step-tag dsh-about-step-pass" : "dsh-about-step-tag dsh-about-step-fail" },
																	chk.ok ? "通过" : "失败"
																),
																h("span", { className: "dsh-about-step-name" }, UPDATE_STAGES[chk.phase] || chk.phase),
																chk.code != null ? h("span", { className: "dsh-about-muted" }, `(退出码 ${chk.code})`) : null,
																chk.dependency ? h("span", { className: "dsh-about-step-dep" }, `实际依赖: ${chk.dependency.name}${chk.dependency.version ? "@" + chk.dependency.version : ""}`) : null
															))
														)
													)
													: null,
												h("div", { className: "dsh-about-fail-details-wrap" },
													h("div", { className: "dsh-about-fail-section-header" }, "详细报错日志与输出"),
													h("pre", { className: "dsh-about-tail dsh-about-tail-dialog", tabIndex: 0 }, String(updateResult.tail || (lastFailure ? formatUpdateFailure(lastFailure) : "")))
												),
												lastFailure?.hint
													? h("div", { className: "dsh-about-fail-hint" },
														h("strong", null, "修复建议："),
														lastFailure.hint
													)
													: null,
												h("div", { className: "dsh-about-dialog-actions" },
													lastFailure?.kind === "dsh" && lastFailure.id === updateResult.id ? renderCopyFailure(lastFailure) : null,
													h("button", { className: "dsh-about-btn", type: "button", onClick: () => setUpdateResult(null) }, "重选版本"),
													h("button", { className: "dsh-about-btn", type: "button", onClick: () => setPickerOpen(false) }, "关闭")
												)
											)
											: h("div", null,
												h("div", { className: "dsh-about-dialog-title", id: "dsh-about-dialog-title" }, "选择要安装的版本"),
											pluginHasUpdate && !pluginIsLocal
												? h("div", { className: "dsh-about-priority" },
													h("div", { className: "dsh-about-priority-title" }, "建议先更新 dsh-about 插件"),
													h("div", null, "本插件 v" + pluginInfo.version + " 有新版本 v" + pluginInfo.newest + "。安装新版 DSH 后旧插件可能失效，建议先关闭本弹窗，点击「插件版本」行的版本号更新插件。")
												)
												: null,
												h("div", { className: "dsh-about-dialog-hints" },
													h("div", { className: "dsh-about-muted" }, "当前 v" + ((info && info.version) || "…") + " · 仅列出比当前更新的版本（来自 npm）"),
													h("div", { className: "dsh-about-muted" }, "会先在临时目录试装。安装完成后将自动重启 dsh web，进行中的会话与任务会中断，请确认已保存工作。")
												),
												versions === null && versionsError === null
													? h("div", { className: "dsh-about-muted" }, "正在获取版本列表…")
													: versionsError !== null
														? h("div", { className: "dsh-about-status dsh-about-status-err" }, versionsError)
														: versions.length === 0
															? h("div", { className: "dsh-about-muted" }, "已是最新版本，暂无可安装的更新")
															: h("div", { className: "dsh-about-versions", role: "radiogroup" }, versions.map((entry) => {
																const selected = selectedVersion === entry.version;
																const onKey = (e) => {
																	if (e.key === "Enter" || e.key === " ") {
																		e.preventDefault();
																		setSelectedVersion(entry.version);
																	} else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
																		e.preventDefault();
																		const idx = versions.findIndex((v) => v.version === entry.version);
																		const next = e.key === "ArrowDown" ? idx + 1 : idx - 1;
																		if (next >= 0 && next < versions.length) setSelectedVersion(versions[next].version);
																	}
																};
																return h("div", {
																	className: "dsh-about-version" + (selected ? " dsh-about-version-sel" : ""),
																	key: entry.version,
																	role: "radio",
																	"aria-checked": selected,
																	tabIndex: selected ? 0 : -1,
																	onClick: () => setSelectedVersion(entry.version),
																	onKeyDown: onKey
																},
																	h("span", { className: "dsh-about-version-radio" }, selected ? "●" : "○"),
																	h("span", { className: "dsh-about-version-no" }, "v" + entry.version),
																	kindBadge(entry.kind),
																	entry.tags.filter((tag) => !(tag === "alpha" && entry.kind === "alpha") && !(tag === "beta" && entry.kind === "beta") && !(tag === "rc" && entry.kind === "rc")).map((tag) => h("span", { className: "dsh-about-release-badge", key: tag }, tag === "latest" ? "稳定版 latest" : tag === "next" ? "预览版 next" : tag)),
																	entry.onNpm === false ? h("span", { className: "dsh-about-release-badge dsh-about-release-badge-unsynced" }, "npm 未发布") : null
																);
															})),
												selectedVersion !== null && Array.isArray(versions)
													? (() => {
														const sel = versions.find((v) => v.version === selectedVersion);
														if (sel === undefined) return null;
														const warn = kindWarn(sel.kind);
														const npmNote = sel.onNpm === false
															? h("div", { className: "dsh-about-muted" }, "此版本尚未发布到 npm，无法一键安装；请等待 npm 同步，或从 GitHub 源码构建。")
															: null;
														return h("div", { className: "dsh-about-dialog-hints" }, warn, npmNote, compatWarn());
													})()
													: null,
												h("div", { className: "dsh-about-dialog-actions" },
													h("button", { className: "dsh-about-btn", type: "button", onClick: () => setPickerOpen(false), disabled: installing || restarting }, "取消"),
													h("button", { className: "dsh-about-btn dsh-about-btn-primary", type: "button", onClick: () => onInstall(selectedVersion), disabled: !selectedVersion || installing || restarting || (versions !== null && Array.isArray(versions) && versions.find((v) => v.version === selectedVersion)?.onNpm === false) },
														installing ? "正在安装…" : (versions !== null && Array.isArray(versions) && versions.find((v) => v.version === selectedVersion)?.onNpm === false) ? "npm 未发布，无法安装" : "安装所选版本"
													)
												)
											)
							)
						)
						: null,
				historyMenuOpen
					? h("div", { className: "dsh-about-overlay", onClick: (e) => { if (e.target === e.currentTarget) closeHistoryMenu(); } },
						h("div", { className: "dsh-about-dialog dsh-about-dialog-wide", role: "dialog", "aria-modal": "true", "aria-labelledby": "dsh-about-history-title", tabIndex: -1, ref: historyDialogRef },
							h("div", { className: "dsh-about-dialog-title", id: "dsh-about-history-title" }, "报错历史"),
							historyCount > 0
								? h("div", { className: "dsh-about-dialog-hints" },
									h("div", { className: "dsh-about-muted" },
										"共 " + historyCount + " 条" +
										(pendingCount === 0
											? "，均已覆盖（目标版本 ≤ 当前安装版本），发灰显示"
											: pendingCount < historyCount
												? "，其中 " + pendingCount + " 条仍需处理；已覆盖的记录发灰显示"
												: "，按时间倒序") +
										"；列表可上下滚动查看全部记录。")
								)
								: null,
							historyFailed ? h("div", { className: "dsh-about-status dsh-about-status-err" }, String(failureHistoryError)) : null,
							historyLoading
								? h("div", { className: "dsh-about-muted" }, "正在读取…")
								: historyCount > 0
									? h("div", { className: "dsh-about-history-dialog-list", role: "group", "aria-label": "报错历史列表", tabIndex: 0 },
										failureHistory.map(renderHistoryEntry)
									)
									: historyFailed
										? null
										: h("div", { className: "dsh-about-muted" }, "暂无报错记录"),
							h("div", { className: "dsh-about-dialog-actions" },
								historyCopyMessage ? h("span", { role: "status", className: "dsh-about-muted", style: { alignSelf: "center", marginRight: "auto" } }, historyCopyMessage) : null,
								h("button", { type: "button", className: "dsh-about-btn", onClick: () => loadFailureHistory(), disabled: failureHistoryBusy }, failureHistoryBusy ? "刷新中…" : "刷新"),
								h("button", { type: "button", className: "dsh-about-btn dsh-about-btn-primary", onClick: closeHistoryMenu }, "关闭")
							)
						)
					)
					: null,
				failureDialogOpen && shownFailure
					? h("div", { className: "dsh-about-overlay", onClick: (e) => { if (e.target === e.currentTarget) closeFailureDialog(); } },
						h("div", { className: "dsh-about-dialog dsh-about-dialog-wide", role: "dialog", "aria-modal": "true", "aria-labelledby": "dsh-about-failure-title", tabIndex: -1, ref: failureDialogRef },
							h("div", { className: "dsh-about-dialog-title", id: "dsh-about-failure-title" },
								"更新失败诊断 · " + (shownFailure.kind === "plugin" ? "dsh-about" : "DSH") + (shownFailure.target ? " v" + shownFailure.target : "")
							),
							h("div", { className: "dsh-about-fail-callout", "data-joi-spot": "1" },
								h("div", { className: "dsh-about-fail-header-row", "data-joi-spot": "1" },
									h("span", { className: "dsh-about-fail-badge" }, "失败阶段：" + (UPDATE_STAGES[shownFailure.stage] || shownFailure.stage || "校验未通过")),
									shownFailure.rolledBack === true
										? h("span", { className: "dsh-about-status-ok-badge" }, "已安全回退到 " + (shownFailure.installedVersion || "旧版"))
										: shownFailure.stage === "preflight"
											? h("span", { className: "dsh-about-status-ok-badge" }, "隔离预检拦截（原版本未改动）")
											: null
								),
								h("div", { className: "dsh-about-fail-summary-text" }, shownFailure.summary)
							),
							shownFailure.checks && shownFailure.checks.length > 0
								? h("div", { className: "dsh-about-fail-steps" },
									h("div", { className: "dsh-about-fail-section-header" }, "各环节执行结果"),
									h("div", { className: "dsh-about-fail-steps-list" },
										shownFailure.checks.map((chk, idx) => h("div", { key: idx, className: "dsh-about-fail-step-item" },
											h("span", { className: chk.ok ? "dsh-about-step-tag dsh-about-step-pass" : "dsh-about-step-tag dsh-about-step-fail" },
												chk.ok ? "通过" : "失败"
											),
											h("span", { className: "dsh-about-step-name" }, UPDATE_STAGES[chk.phase] || chk.phase),
											chk.code != null ? h("span", { className: "dsh-about-muted" }, `(退出码 ${chk.code})`) : null,
											chk.dependency ? h("span", { className: "dsh-about-step-dep" }, `实际依赖: ${chk.dependency.name}${chk.dependency.version ? "@" + chk.dependency.version : ""}`) : null
										))
									)
								)
								: null,
							h("div", { className: "dsh-about-fail-details-wrap" },
								h("div", { className: "dsh-about-fail-section-header" }, "详细诊断与调用栈"),
								h("pre", { className: "dsh-about-tail dsh-about-tail-dialog", tabIndex: 0 }, formatUpdateFailure(shownFailure))
							),
							shownFailure.hint
								? h("div", { className: "dsh-about-fail-hint" },
									h("strong", null, "修复建议："),
									shownFailure.hint
								)
								: null,
							h("div", { className: "dsh-about-dialog-actions" },
								h("button", { type: "button", className: "dsh-about-btn dsh-about-btn-primary", onClick: () => copyFailure(shownFailure) }, "复制诊断"),
								copyMessage ? h("span", { role: "status", className: "dsh-about-muted", style: { alignSelf: "center", marginRight: "auto" } }, copyMessage) : null,
								h("button", { className: "dsh-about-btn", type: "button", onClick: closeFailureDialog }, "关闭")
							)
						)
					)
					: null
				),
				pluginDialog
					? h("div", { className: "dsh-about-overlay", onClick: (e) => { if (e.target === e.currentTarget && !pluginBusy && !pluginRestarting) setPluginDialog(false); } },
						h("div", { className: "dsh-about-dialog", role: "dialog", "aria-modal": "true", "aria-labelledby": "dsh-about-plugin-dialog-title", tabIndex: -1, ref: pluginDialogRef },
							pluginRestartDone
								? h("div", null,
									h("div", { className: "dsh-about-dialog-title", id: "dsh-about-plugin-dialog-title" }, "插件更新完成"),
									h("div", { className: "dsh-about-status dsh-about-status-ok" }, "dsh-about 已更新到 v" + pluginTarget + " 并自动重启成功，页面即将刷新…"),
									h("div", { className: "dsh-about-dialog-actions" },
										h("button", { className: "dsh-about-btn dsh-about-btn-primary", type: "button", onClick: () => location.reload() }, "立即刷新")
									)
								)
								: pluginRestartFailed
									? h("div", null,
										h("div", { className: "dsh-about-dialog-title", id: "dsh-about-plugin-dialog-title" }, "插件已更新，自动重启未完成"),
										h("div", { className: "dsh-about-status dsh-about-status-err" }, "新版本插件未在 2 分钟内就绪。请手动重启 dsh web，或刷新页面重试。"),
										h("div", { className: "dsh-about-dialog-actions" },
											h("button", { className: "dsh-about-btn dsh-about-btn-primary", type: "button", onClick: () => location.reload() }, "刷新页面"),
											h("button", { className: "dsh-about-btn", type: "button", onClick: () => setPluginDialog(false) }, "知道了")
										)
									)
									: pluginRestarting
										? h("div", null,
											h("div", { className: "dsh-about-dialog-title", id: "dsh-about-plugin-dialog-title" }, "正在更新插件并重启"),
											h("div", { className: "dsh-about-status dsh-about-status-ok" }, "已更新到 v" + pluginTarget + "，正在重启 dsh…（约需十几秒）")
										)
										: pluginManualRestart
											? h("div", null,
												h("div", { className: "dsh-about-dialog-title", id: "dsh-about-plugin-dialog-title" }, "插件已更新，需要手动重启"),
												h("div", { className: "dsh-about-status dsh-about-status-warn" }, "已更新到 v" + pluginTarget + "，但自动重启未能启动，请手动运行：dsh web"),
												pluginRestartReason !== null ? h("div", { className: "dsh-about-muted" }, "原因：" + pluginRestartReason) : null,
												h("div", { className: "dsh-about-dialog-actions" },
													h("button", { className: "dsh-about-btn", type: "button", onClick: () => setPluginDialog(false) }, "知道了")
												)
											)
											: pluginBusy
												? h("div", null,
													h("div", { className: "dsh-about-dialog-title", id: "dsh-about-plugin-dialog-title" }, "正在更新插件到 v" + pluginTarget),
													h("div", { className: "dsh-about-muted" }, "正在执行 dsh plugin add（从 npm 拉取并写入 profile），可能需要一两分钟，请勿关闭页面")
												)
												: pluginIsLocal
													? h("div", null,
														h("div", { className: "dsh-about-dialog-title", id: "dsh-about-plugin-dialog-title" }, "本地源码安装，不能自动更新"),
														h("div", { className: "dsh-about-muted" }, "本插件是以 " + String(pluginInfo.depSpec || "link:") + " 方式安装的（开发态）：自动更新会把这份源码目录替换成 npm 包，因此不提供。"),
														pluginHasUpdate ? h("div", { className: "dsh-about-muted" }, "npm 上已有 v" + pluginInfo.newest + "，请手动同步源码，或改为 npm 安装以启用一键更新。") : null,
														h("div", { className: "dsh-about-muted" }, "改为 npm 安装：dsh plugin --profile " + String(pluginInfo.profile || "web") + " add " + PLUGIN_PKG + (pluginInfo.newest ? "@" + pluginInfo.newest : "")),
														h("div", { className: "dsh-about-dialog-actions" },
															h("button", { className: "dsh-about-btn", type: "button", onClick: () => setPluginDialog(false) }, "知道了")
														)
														)
													: h("div", null,
												h("div", { className: "dsh-about-dialog-title", id: "dsh-about-plugin-dialog-title" }, "更新 dsh-about 插件"),
													h("div", { className: "dsh-about-dialog-hints" },
														h("div", { className: "dsh-about-muted" }, "v" + (pluginInfo ? pluginInfo.version : "…") + " → v" + pluginTarget + "（来自 " + (pluginInfo && pluginInfo.source ? pluginInfo.source : "npm") + "）"),
														h("div", { className: "dsh-about-muted" }, "更新会执行 dsh plugin add " + PLUGIN_PKG + "@" + pluginTarget + "，装完自动重启 dsh web；进行中的会话与任务会中断。"),
														h("div", { className: "dsh-about-muted" }, h("a", { href: PLUGIN_REPO + "/releases/tag/v" + pluginTarget, target: "_blank", rel: "noreferrer" }, "查看该版本更新说明"))
													),
													pluginResult !== null && !pluginResult.ok
														? h("div", { className: "dsh-about-status dsh-about-status-err" },
															"更新失败" + (pluginResult.code !== null && pluginResult.code !== undefined ? "（退出码 " + pluginResult.code + "）" : "") + "：" + String(pluginResult.error || "请查看下方输出"),
															h("pre", { className: "dsh-about-tail" }, String(pluginResult.tail || ""))
														)
														: null,
													h("div", { className: "dsh-about-dialog-actions" },
														h("button", { className: "dsh-about-btn", type: "button", onClick: () => setPluginDialog(false) }, "取消"),
														h("button", { className: "dsh-about-btn dsh-about-btn-primary", type: "button", onClick: () => onPluginUpdate(pluginTarget), disabled: pluginBusy || pluginRestarting }, "更新到 v" + pluginTarget)
													)
												)
						)
					)
					: null,
				h("div", { className: "dsh-about-releases" },
					h("div", { className: "dsh-about-releases-head" },
						h("span", { className: "dsh-about-releases-title" }, "版本更新记录"),
						failBadge
							? h("span", { className: "dsh-about-fail-badge" },
								h("svg", { className: "dsh-about-fail-icon", viewBox: "0 0 16 16", "aria-hidden": "true" },
									h("path", { d: "M8 14.5A6.5 6.5 0 1 1 8 1.5a6.5 6.5 0 0 1 0 13Zm0-9.3a.8.8 0 0 0-.8.8v3a.8.8 0 0 0 1.6 0V6a.8.8 0 0 0-.8-.8Zm0 6.6a.95.95 0 1 0 0-1.9.95.95 0 0 0 0 1.9Z" })
								),
								"拉取失败"
							)
							: null,
						h("span", { className: "dsh-about-muted" }, "（官方 GitHub · 每日首次打开自动拉取 · 最多 10 个版本 · 刷新同时检查插件版本）"),
						h("button", { className: "dsh-about-btn dsh-about-refresh", type: "button", onClick: onRefresh, disabled: refreshing },
							refreshing ? "刷新中…" : "刷新"
						)
					),
					releases === null
						? h("div", { className: "dsh-about-muted" }, "正在获取版本记录…")
						: releases.ok === false
							? h("div", { className: "dsh-about-status dsh-about-status-err" }, String(releases.error || "获取版本记录失败"))
							: releases.releases.length === 0
								? h("div", { className: "dsh-about-muted" }, "暂无版本记录")
								: h("div", null, releases.releases.map((release, index) => {
									const hasBody = typeof release.body === "string" && release.body !== "";
									const expanded = expandedReleases.has(release.version);
									return h("div", { className: "dsh-about-release", key: release.version },
										h("div", { className: "dsh-about-release-head", role: hasBody ? "button" : undefined, tabIndex: hasBody ? 0 : undefined, "aria-expanded": hasBody ? expanded : undefined, onClick: hasBody ? () => toggleRelease(release.version) : undefined, onKeyDown: hasBody ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleRelease(release.version); } } : undefined },
											h("span", { className: "dsh-about-release-ver" }, "v" + release.version),
											index === 0 ? h("span", { className: "dsh-about-release-hot" }, "最新") : null,
											release.kind === "alpha" ? h("span", { className: "dsh-about-badge-alpha" }, "开发者预览版") : release.kind === "beta" ? h("span", { className: "dsh-about-badge-beta" }, "Beta 测试版") : release.kind === "rc" ? h("span", { className: "dsh-about-release-badge" }, "预览版") : release.prerelease ? h("span", { className: "dsh-about-release-badge" }, "预览版") : null,
											release.publishedAt !== "" ? h("span", { className: "dsh-about-muted" }, release.publishedAt) : null,
											hasBody ? h("span", { className: "dsh-about-release-toggle", title: expanded ? "收起描述" : "展开描述", "aria-label": expanded ? "收起描述" : "展开描述" },
												h("span", { className: "dsh-about-release-arrow" + (expanded ? " dsh-about-release-arrow-open" : "") })
											) : null
										),
										hasBody ? h("div", { className: "dsh-about-release-body", "data-rel": release.version, ref: (el) => { if (el) releaseBodyEls.current.set(release.version, el); else releaseBodyEls.current.delete(release.version); } }, renderReleaseBody(release.body)) : null
									);
								}))
				),
				successShow
					? h("div", { className: "dsh-about-success-overlay" },
						h("div", { className: "dsh-about-success-card" },
							h("svg", { className: "dsh-about-success-icon", viewBox: "0 0 52 52", "aria-hidden": "true" },
								h("circle", { className: "dsh-about-success-circle", cx: "26", cy: "26", r: "24" }),
								h("path", { className: "dsh-about-success-check", d: "M15 27l8 8 15-18" })
							),
							h("div", { className: "dsh-about-success-text" }, "拉取成功")
						)
					)
					: null
			);
		}

		/* ───────────── 插件注册 ───────────── */
		const plugin = {
			name: PLUGIN_ID,
			inject: ["slots", "locale"],
			apply(ctx) {
				const tag = ensureCss();
				// 「关于」导航红点：本插件有新版时，在设置导航的本分区单元格右上角挂一个小红点
				navDotCtl = createNavDot(() => t("nav"), () => "dsh-about 有新版本可更新");
				ctx.effect(() => () => {
					tag.remove();
					if (navDotCtl !== null) {
						navDotCtl.dispose();
						navDotCtl = null;
					}
				}, PLUGIN_ID + ": styles");
				ctx.effect(() => ctx.locale.register(NS, DICT), PLUGIN_ID + ": dictionaries");
				const t = ctx.locale.bind(NS);
				ctx.slots.inject("settings.section", () =>
					ctx.slots.register({
						name: "settings.section",
						id: "about",
						order: 90,
						label: () => t("nav")
					}, AboutSection)
				);
			}
		};

		Object.assign(exports, plugin);
		return module.exports;
	}
});

//# sourceURL=dsh-about/client.js
