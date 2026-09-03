// dsh-about — 设置中心「关于」分区的浏览器半体。
//
// 注册一个 settings.section 分区（id: "about"，导航标签「关于」），
// 页面内容：DeepSeek 官方图标、产品名、当前版本 / 平台 / 项目主页，
// 「检查更新」（npm latest+next 取新）+「一键更新」（npm install -g），
// 以及底部「版本更新记录」（官方 GitHub Releases，最多 10 个版本）：
// 每日首次打开自动拉取一次（内容与日期标记由宿主落盘到本地电脑），其余时间仅点「刷新」才拉取。
// 版本与更新数据来自宿主半体的 /dsh-about 路由（见 ./index.js）。
window.__ModuleLoader__.load({
	id: "dsh-about",
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
		/** 版本记录的内容缓存与「当日已尝试」标记不再存浏览器 localStorage，
		 * 而是由宿主半体落到本地磁盘（$DSH_HOME/dsh-about/releases-cache.json）。
		 * 浏览器侧只负责请求 /dsh-about/releases 并渲染结果。 */

		/* ───────────── 官方 DeepSeek 标识（与前端 favicon.svg 同款路径） ───────────── */
		const LOGO_PATH =
			"M48.8354 10.0479C48.3232 9.79199 48.1025 10.2798 47.8032 10.5278C47.7007 10.6079 47.6143 10.7119 47.5273 10.8076C46.7793 11.624 45.9048 12.1597 44.7622 12.0957C43.0923 12 41.666 12.5356 40.4058 13.8398C40.1377 12.2319 39.2476 11.272 37.8926 10.6558C37.1836 10.3359 36.4668 10.0156 35.9702 9.31982C35.6235 8.82373 35.5293 8.27197 35.356 7.72754C35.2456 7.3999 35.1353 7.06396 34.7651 7.00781C34.3633 6.94385 34.2056 7.2876 34.0479 7.57568C33.418 8.75195 33.1733 10.0479 33.1973 11.3599C33.2524 14.312 34.4736 16.6641 36.8999 18.3359C37.1758 18.5278 37.2466 18.7197 37.1597 19C36.9946 19.5757 36.7974 20.1357 36.624 20.7119C36.5137 21.0801 36.3486 21.1597 35.9624 21C34.6309 20.4321 33.481 19.5918 32.4644 18.5757C30.7393 16.8721 29.1792 14.9917 27.2334 13.52C26.7764 13.1758 26.3193 12.856 25.8467 12.5518C23.8618 10.584 26.1069 8.96777 26.627 8.77588C27.1704 8.57568 26.8159 7.8877 25.0591 7.896C23.3022 7.90381 21.6953 8.50391 19.647 9.30371C19.3477 9.42383 19.0322 9.51172 18.7095 9.58398C16.8501 9.22363 14.9199 9.14355 12.9033 9.37598C9.10596 9.80762 6.07275 11.6396 3.84326 14.7681C1.16455 18.5278 0.53418 22.7998 1.30664 27.2559C2.11768 31.9521 4.46582 35.8398 8.07373 38.8799C11.8159 42.0322 16.1255 43.5762 21.041 43.2803C24.0269 43.104 27.3516 42.6963 31.1016 39.4561C32.0469 39.936 33.0396 40.1279 34.686 40.272C35.9546 40.3921 37.1758 40.208 38.1211 40.0078C39.6021 39.688 39.4995 38.2881 38.9639 38.0322C34.623 35.9678 35.5762 36.8081 34.71 36.1279C36.9155 33.4639 40.2402 30.6958 41.54 21.728C41.6426 21.0161 41.5557 20.5679 41.54 19.9917C41.5322 19.6396 41.6108 19.5039 42.0049 19.4639C43.0923 19.3359 44.1479 19.0317 45.1167 18.4878C47.9292 16.9199 49.064 14.3438 49.3315 11.2559C49.3711 10.7837 49.3237 10.2959 48.8354 10.0479ZM24.3262 37.8398C20.1196 34.4639 18.0791 33.3521 17.2358 33.3999C16.4482 33.4482 16.5898 34.3682 16.7632 34.9678C16.9443 35.5601 17.1812 35.9683 17.5117 36.4878C17.7402 36.832 17.8979 37.3442 17.2832 37.728C15.9282 38.584 13.5728 37.4399 13.4624 37.3838C10.7207 35.7358 8.42822 33.5601 6.81348 30.584C5.25342 27.7197 4.34766 24.6479 4.19775 21.3677C4.1582 20.5757 4.38672 20.2959 5.15869 20.1519C6.17529 19.96 7.22314 19.9199 8.23926 20.0718C12.5327 20.7119 16.1885 22.6719 19.2529 25.7759C21.002 27.5439 22.3252 29.6558 23.6885 31.7202C25.1377 33.9121 26.6978 36 28.6831 37.7119C29.3843 38.312 29.9434 38.7681 30.479 39.104C28.8643 39.2881 26.1699 39.3281 24.3262 37.8398ZM26.3433 24.6001C26.3433 24.248 26.6191 23.9678 26.9658 23.9678C27.0444 23.9678 27.1152 23.9839 27.1782 24.0078C27.2651 24.04 27.3438 24.0879 27.4067 24.1602C27.5171 24.272 27.5801 24.4321 27.5801 24.6001C27.5801 24.9521 27.3042 25.2319 26.9575 25.2319C26.6108 25.2319 26.3433 24.9521 26.3433 24.6001ZM32.6064 27.8799C32.2046 28.0479 31.8027 28.1919 31.4165 28.208C30.8179 28.2397 30.1641 27.9922 29.8096 27.688C29.2583 27.2158 28.8643 26.9521 28.6987 26.1279C28.6279 25.7759 28.6675 25.2319 28.7305 24.9199C28.8721 24.248 28.7144 23.8159 28.2495 23.4238C27.8716 23.104 27.3911 23.0161 26.8633 23.0161C26.666 23.0161 26.4849 22.9277 26.3511 22.856C26.1304 22.7441 25.9492 22.4639 26.1226 22.1201C26.1777 22.0078 26.4458 21.7358 26.5088 21.688C27.2256 21.272 28.0527 21.4077 28.8169 21.7197C29.5259 22.0161 30.0615 22.5601 30.834 23.3281C31.6216 24.2559 31.7632 24.5117 32.2124 25.208C32.5669 25.752 32.8901 26.312 33.1104 26.9521C33.2446 27.3521 33.0713 27.6802 32.6064 27.8799Z";

		/* ───────────── 样式（主题中立，跟随宿主主题规则） ───────────── */
		const CSS = `
.dsh-about { display: flex; flex-direction: column; gap: 18px; padding: 6px 2px 16px; font-family: inherit; color: var(--dsw-alias-label-primary, #1f1f1f); }
.dsh-about * { box-sizing: border-box; }
.dsh-about-hero { display: flex; align-items: center; gap: 14px; }
.dsh-about-logo { width: 52px; height: 52px; flex: none; color: #141414; }
.dsh-about-logo path { fill: currentColor; }
@media (prefers-color-scheme: dark) { .dsh-about-logo { color: #ffffff; } }
.dsh-about-name { font-size: 18px; font-weight: 700; line-height: 1.3; }
.dsh-about-sub { font-size: 13px; color: var(--dsw-alias-label-tertiary, #7a7a7a); margin-top: 3px; }
.dsh-about-rows { margin: 0; display: flex; flex-direction: column; }
.dsh-about-row { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 9px 0; border-bottom: 1px solid rgba(128, 128, 128, 0.22); font-size: 13.5px; }
.dsh-about-row:last-child { border-bottom: none; }
.dsh-about-row dt { color: var(--dsw-alias-label-tertiary, #7a7a7a); }
.dsh-about-row dd { margin: 0; font-variant-numeric: tabular-nums; text-align: right; overflow-wrap: anywhere; }
.dsh-about-row a { color: var(--dsw-static-blue-400, #0a66c2); text-decoration: none; }
.dsh-about-update { display: flex; flex-direction: column; gap: 10px; padding-top: 4px; }
.dsh-about-update-line { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.dsh-about-btn { font-family: inherit; font-size: 13.5px; padding: 7px 14px; border-radius: 6px; cursor: pointer; border: 1px solid rgba(128, 128, 128, 0.4); background: var(--dsw-alias-bg-layer-2, #f5f5f5); color: var(--dsw-alias-label-primary, #1f1f1f); }
.dsh-about-btn:hover:not(:disabled) { background: var(--dsw-alias-bg-layer-3, #ffffff); }
.dsh-about-btn:disabled { opacity: 0.55; cursor: default; }
.dsh-about-btn-primary { background: var(--dsw-static-blue-400, #0a66c2); color: #ffffff; border-color: transparent; }
.dsh-about-btn-primary:hover:not(:disabled) { background: #0958b0; }
.dsh-about-status { font-size: 13px; display: inline-flex; align-items: center; gap: 6px; }
.dsh-about-status-ok { color: var(--dsw-alias-state-success-primary, #1a7f37); }
.dsh-about-status-warn { color: var(--dsw-alias-state-warn-primary, #9a6700); }
.dsh-about-status-err { color: var(--dsw-alias-state-error-primary, #cf222e); }
.dsh-about-muted { color: var(--dsw-alias-label-tertiary, #7a7a7a); font-size: 12.5px; line-height: 1.6; }
.dsh-about-tail { margin: 0; max-height: 140px; overflow: auto; white-space: pre-wrap; word-break: break-all; font-size: 11.5px; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; background: rgba(128, 128, 128, 0.1); border-radius: 6px; padding: 8px 10px; color: var(--dsw-alias-label-primary, #1f1f1f); }
.dsh-about-releases { margin-top: 6px; border-top: 1px solid rgba(128, 128, 128, 0.22); padding-top: 14px; }
.dsh-about-releases-head { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; flex-wrap: wrap; }
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
.dsh-about-success-overlay { position: fixed; inset: 0; z-index: 99999; display: flex; align-items: center; justify-content: center; background: rgba(0, 0, 0, 0.25); }
.dsh-about-success-card { display: flex; flex-direction: column; align-items: center; gap: 14px; background: var(--dsw-alias-bg-layer-3, #ffffff); color: var(--dsw-alias-label-primary, #1f1f1f); border-radius: 16px; padding: 26px 44px; box-shadow: 0 12px 40px rgba(0, 0, 0, 0.22); animation: dsh-about-success-pop 0.3s ease-out; }
.dsh-about-success-icon { width: 56px; height: 56px; }
.dsh-about-success-circle { fill: none; stroke: #34c759; stroke-width: 2.5; }
.dsh-about-success-check { fill: none; stroke: #34c759; stroke-width: 5; stroke-linecap: round; stroke-linejoin: round; stroke-dasharray: 64; stroke-dashoffset: 64; animation: dsh-about-success-draw 0.45s ease-out 0.15s forwards; }
.dsh-about-success-text { font-size: 16px; font-weight: 600; }
.dsh-about-source { margin-top: 2px; border-top: 1px solid rgba(128, 128, 128, 0.22); padding-top: 12px; }
.dsh-about-source-head { display: flex; align-items: center; gap: 8px; margin-bottom: 2px; flex-wrap: wrap; }
.dsh-about-source-title { font-size: 14.5px; font-weight: 700; }
.dsh-about-source-hint { font-size: 12px; line-height: 1.5; color: var(--dsw-alias-label-tertiary, #7a7a7a); margin-bottom: 6px; }
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
@keyframes dsh-about-success-pop { from { transform: scale(0.9); opacity: 0; } to { transform: scale(1); opacity: 1; } }`;

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

		/* ───────────── 「关于」分区组件 ───────────── */
		function AboutSection() {
			const [info, setInfo] = useState(null);
			const [describeError, setDescribeError] = useState(null);
			const [checking, setChecking] = useState(false);
			const [snapshot, setSnapshot] = useState(null);
			const [installing, setInstalling] = useState(false);
			const [updateResult, setUpdateResult] = useState(null);
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
					// 客户端超时兜底：网络层悬挂时主动结束「检测中」态
					if (seq !== pingSeqRef.current) return;
					setSourceError("延迟检测超时，请重试");
					pingSeqRef.current += 1; // 使本次请求的后续回调全部失效
					cleanup();
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
				fetch(ENDPOINT + "/versions")
					.then((res) => res.json())
					.then((data) => {
						// 过期响应（用户已关闭并重开弹窗）直接丢弃，避免旧错误压过新数据
						if (seq !== versionsSeqRef.current) return;
						if (data && data.ok) setVersions(data.versions || []);
						else setVersionsError(String((data && data.error) || "获取版本列表失败"));
					})
					.catch((error) => {
						if (seq !== versionsSeqRef.current) return;
						setVersionsError(String(error && error.message));
					});
			};

			const onInstall = (version) => {
				if (!version || installing || restarting) return;
				setInstalling(true);
				setUpdateResult(null);
				fetch(ENDPOINT + "/update", {
					method: "POST",
					headers: { "content-type": "application/json" },
					// port：上报当前页面真实端口，宿主据此决定重启后探测哪个端口
					// （覆盖 argv 解析，避免配置级改端口 / --port 0 场景下端口推断错误）
					body: JSON.stringify({ version, port: Number(window.location.port) || undefined })
				})
					.then((res) => res.json())
					.then((data) => {
						if (!data) throw new Error("空响应");
						if (data.ok && data.restarting) {
							setInstalling(false);
							setRestarting(true);
							// 等新进程以「目标版本」就绪后自动刷新页面：
							//  - 首轮轮询延迟到 5s，避开宿主 2.5s 的退出窗口，防止旧进程假响应
							//  - 每轮都必须比对 describe 返回的版本号，确认应答的是新服务而非旧进程
							//  - 轮询定时器统一登记在 pollTimerRef：组件卸载即清理，不再「幽灵刷新」
							let attempts = 0;
							const poll = () => {
								pollTimerRef.current = null;
								fetch(ENDPOINT + "/describe", { cache: "no-store" })
									.then((r) => r.json())
									.then((d) => {
										if (!mountedRef.current) return;
										if (d && d.ok && d.version === version) {
											setRestartDone(true);
											setRestarting(false);
											pollTimerRef.current = setTimeout(() => location.reload(), 1500);
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
						} else {
							setUpdateResult(data);
							setInstalling(false);
						}
					})
					.catch((error) => {
						setUpdateResult({ ok: false, error: String(error && error.message), tail: "" });
						setInstalling(false);
					});
			};

			const onRefresh = () => {
				if (refreshing) return;
				setRefreshing(true);
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

			return h("div", { className: "dsh-about" },
				h("div", { className: "dsh-about-hero" },
					h("svg", { className: "dsh-about-logo", viewBox: "0 0 50 50", "aria-hidden": "true" },
						h("path", { d: LOGO_PATH })
					),
					h("div", null,
						h("div", { className: "dsh-about-name" }, "DeepSeek Harness"),
						h("div", { className: "dsh-about-sub" }, "DeepSeek 官方 AI 智能体工作台")
					)
				),
				describeError !== null
					? h("div", { className: "dsh-about-status dsh-about-status-err" }, "获取版本信息失败：" + describeError)
					: h("dl", { className: "dsh-about-rows" },
						row("当前版本", info ? "v" + info.version : "加载中…"),
						row("平台", info ? info.platform : "加载中…"),
						row("项目主页", info
							? typeof info.repo === "string" && /^https?:\/\//i.test(info.repo)
								? h("a", { href: info.repo, target: "_blank", rel: "noreferrer" }, "GitHub · deepseek-harness")
								: "GitHub · deepseek-harness"
							: "加载中…")
					),
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
						h("div", { className: "dsh-about-update" },
					h("div", { className: "dsh-about-update-line" },
						h("button", { className: "dsh-about-btn dsh-about-btn-primary", type: "button", onClick: onCheck, disabled: checking || installing || restarting },
							checking ? "正在检查…" : "检查更新"
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
											h("div", { className: "dsh-about-status dsh-about-status-ok" }, "已安装 v" + selectedVersion + "，正在以新版本重新启动 dsh…（约需十几秒）")
										)
										: manualRestartNeeded
											? h("div", null,
												h("div", { className: "dsh-about-dialog-title", id: "dsh-about-dialog-title" }, "安装成功，需要手动重启"),
												h("div", { className: "dsh-about-status dsh-about-status-warn" }, "已安装 v" + selectedVersion + "，但自动重启未能启动，请手动运行：dsh web"),
												h("div", { className: "dsh-about-dialog-actions" },
													h("button", { className: "dsh-about-btn", type: "button", onClick: () => setPickerOpen(false) }, "知道了")
												)
											)
										: installing
											? h("div", null,
												h("div", { className: "dsh-about-dialog-title", id: "dsh-about-dialog-title" }, "正在安装 v" + selectedVersion),
												h("div", { className: "dsh-about-muted" }, "正在从 npm 下载并执行 npm install -g …，可能需要几分钟，请勿关闭页面")
											)
											: h("div", null,
												h("div", { className: "dsh-about-dialog-title", id: "dsh-about-dialog-title" }, "选择要安装的版本"),
												h("div", { className: "dsh-about-dialog-hints" },
													h("div", { className: "dsh-about-muted" }, "当前 v" + ((info && info.version) || "…") + " · 仅列出比当前更新的版本（来自 npm）"),
													h("div", { className: "dsh-about-muted" }, "提示：安装完成后将自动重启 dsh web，进行中的会话与任务会中断，请确认已保存工作。")
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
												),
												updateResult !== null && !updateResult.ok
													? h("div", { className: "dsh-about-status dsh-about-status-err" },
														"安装失败" + (updateResult.code !== null && updateResult.code !== undefined ? "（退出码 " + updateResult.code + "）" : "") + "：" + String(updateResult.error || "请查看下方输出"),
														h("pre", { className: "dsh-about-tail" }, String(updateResult.tail || "")),
														selectedVersion !== null ? h("div", { className: "dsh-about-muted" }, "可手动执行：npm install -g @deepseek-ai/dsh@" + selectedVersion) : null
													)
													: null
											)
							)
						)
						: null
				),
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
						h("span", { className: "dsh-about-muted" }, "（官方 GitHub · 每日首次打开自动拉取 · 最多 10 个版本）"),
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
				ctx.effect(() => () => {
					tag.remove();
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