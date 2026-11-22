import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

// Execute the shipped browser module with a minimal hook/DOM harness. Only the
// selected effects are mounted; no network, browser dependencies or real timers.
function mountStatus(initial = { ok: true, inProgress: false, stage: "idle" }, options = {}) {
	const effects = [], states = [], refs = [], intervals = new Map(), listeners = new Map(), storage = new Map();
	const mountedEffects = new Map(), localStorage = options.storage || new Map();
	let data = initial, now = 0, calls = 0, stateIndex = 0, refIndex = 0, timerId = 0, component, plugin, dirty = false;
	const previousFocus = { isConnected: true, focus() { document.activeElement = this; } };
	const noticeButton = { focus() { document.activeElement = this; } };
	const React = {
		useState(value) {
			const index = stateIndex++;
			if (!(index in states)) states[index] = typeof value === "function" ? value() : value;
			return [states[index], (next) => {
				const value = typeof next === "function" ? next(states[index]) : next;
				if (!Object.is(value, states[index])) { states[index] = value; dirty = true; }
			}];
		},
		useRef(value) { const index = refIndex++; return refs[index] ||= { current: value }; },
		useEffect(fn, deps) { effects.push({ fn, deps }); },
		createElement(type, props, ...children) {
			if (props?.["aria-labelledby"] === "dsh-about-platform-notice-title") props.ref.current = { querySelector: () => noticeButton };
			return { type, props, children };
		}
	};
	const events = (surface) => ({
		addEventListener(event, fn) { listeners.set(`${surface}:${event}`, fn); },
		removeEventListener(event, fn) { if (listeners.get(`${surface}:${event}`) === fn) listeners.delete(`${surface}:${event}`); }
	});
	const document = { ...events("document"), activeElement: previousFocus, visibilityState: "visible", body: { innerText: "fixture" }, querySelector: () => null, createElement: () => ({ dataset: {}, remove() {} }), head: { appendChild() {} } };
	const context = vm.createContext({
		window: { ...events("window"), location: { port: "3080" },
			localStorage: {
				getItem(key) { if (options.storageBlocked) throw new Error("Storage blocked"); return localStorage.get(key) ?? null; },
				setItem(key, value) { if (options.storageBlocked) throw new Error("Storage blocked"); localStorage.set(key, value); }
			}, __ModuleLoader__: { load({ factory }) { plugin = factory(() => React); } } },
		navigator: { platform: options.browserPlatform || "Win32", clipboard: options.clipboard },
		document, Date: class extends Date { static now() { return now; } },
		sessionStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
		fetch: async (url) => {
			if (url.endsWith("/describe")) return { json: async () => options.describe || { ok: true, platform: options.platform, version: "1.0.0" } };
			if (url.endsWith("/failure-history")) return { json: async () => options.failureHistory || { ok: true, failures: [] } };
			calls++; return { json: async () => data };
		},
		setInterval(fn, ms) { const id = ++timerId; intervals.set(id, { fn, ms }); return id; },
		clearInterval(id) { intervals.delete(id); }, setTimeout() { return ++timerId; }, clearTimeout() {}
	});
	vm.runInContext(fs.readFileSync(new URL("../lib/client.js", import.meta.url), "utf8"), context);
	plugin.apply({ effect(fn) { return fn(); }, locale: { register() {}, bind() { return () => "关于"; } }, slots: { inject(name, fn) { fn(); }, register(spec, view) { component = view; } } });
	const render = () => { stateIndex = refIndex = 0; effects.length = 0; return component(); };
	const commitEffects = () => {
		for (const [index, effect] of effects.entries()) {
			const source = effect.fn.toString();
			const selected = options.notice
				? source.includes("claimPlatformNotice") || source.includes("platformNoticeVisible") || source.includes('fetch(ENDPOINT + "/describe")')
				: (options.mountDescribe && source.includes('fetch(ENDPOINT + "/describe")')) || source.includes('"/update-status"') || source.includes("loadFailureHistory()") || source.includes("historyMenuOpen");
			if (!selected) continue;
			const previous = mountedEffects.get(index);
			if (previous && effect.deps?.every((value, i) => Object.is(value, previous.deps?.[i]))) continue;
			previous?.cleanup?.();
			mountedEffects.set(index, { deps: effect.deps, cleanup: effect.fn() });
		}
	};
	const cleanup = () => { for (const effect of mountedEffects.values()) effect.cleanup?.(); mountedEffects.clear(); };
	render(); commitEffects();
	const tick = async () => { for (const timer of [...intervals.values()]) if (timer.ms === 1500) await timer.fn(); };
	return {
		set(next) { data = next; }, advance(ms) { now += ms; }, tick, render, cleanup, storage,
		localStorage,
		get noticeFocused() { return document.activeElement === noticeButton; },
		get focusRestored() { return document.activeElement === previousFocus; },
		key(event) { listeners.get("document:keydown")?.(event); },
		remount() { cleanup(); states.length = refs.length = 0; render(); commitEffects(); },
		get calls() { return calls; },
		async focus() { listeners.get("window:focus")?.(); await new Promise(resolve => setImmediate(resolve)); },
		async visible() { listeners.get("document:visibilitychange")?.(); await new Promise(resolve => setImmediate(resolve)); },
		async flush() {
			await new Promise(resolve => setImmediate(resolve));
			for (let n = 0; dirty; n++) {
				assert(n < 10, "effects must settle"); dirty = false; render(); commitEffects();
			}
		}
	};
}

test("an idle page discovers another tab's update and resumes fast polling", async () => {
	const page = mountStatus(); await page.flush(); assert.equal(page.calls, 1);
	page.set({ ok: true, id: "external-job", kind: "dsh", target: "2.0.0", inProgress: true, stage: "installing" });
	page.advance(1500); await page.tick(); assert.equal(page.calls, 1, "idle polling should be throttled");
	page.advance(15000); await page.tick();
	assert.equal(JSON.parse(page.storage.get("dsh-about-update-job")).id, "external-job");
	page.advance(1500); await page.tick(); assert.equal(page.calls, 3, "active updates should poll every tick");
	page.set({ ok: true, id: "external-job", kind: "dsh", target: "2.0.0", inProgress: false, result: { ok: false, error: "fixture rollback", out: "restored" } });
	await page.tick(); assert(!page.storage.has("dsh-about-update-job"));
	assert.match(JSON.stringify(page.render()), /fixture rollback/);
	page.cleanup();
});

test("focus and visibility refresh immediately and unsubscribe on unmount", async () => {
	const page = mountStatus(); await page.flush();
	await page.focus(); assert.equal(page.calls, 2);
	await page.visible(); assert.equal(page.calls, 3);
	page.cleanup(); await page.focus(); await page.visible(); await page.tick();
	assert.equal(page.calls, 3);
});

test("plugin recovery errors are displayed in the plugin dialog", async () => {
	const page = mountStatus({ ok: true, id: "plugin-job", kind: "plugin", target: "1.8.3", inProgress: false, needsRecovery: true, result: { ok: false, error: "fixture plugin recovery", out: "" } });
	await page.flush();
	const tree = JSON.stringify(page.render());
	assert.match(tree, /fixture plugin recovery/);
	assert.match(tree, /dsh-about-plugin-dialog/);
	page.cleanup();
});

function findNode(tree, predicate) {
	if (Array.isArray(tree)) {
		for (const child of tree) { const found = findNode(child, predicate); if (found) return found; }
	} else if (tree && typeof tree === "object") {
		if (predicate(tree)) return tree;
		return findNode(tree.children, predicate);
	}
	return null;
}

test("last failure is available after reload and copies separate npm and CLI outcomes", async () => {
	const copied = [];
	const page = mountStatus({
		ok: true, stage: "installed", inProgress: false,
		lastFailure: {
			id: "old", kind: "dsh", target: "2.0.0", stage: "verifying", summary: "缺少 EntryValidationError",
			rolledBack: true, installedVersion: "1.0.0", checks: [
				{ phase: "install", ok: true, code: 0 },
				{ phase: "cli", ok: false, code: 1, dependency: { name: "fixture-loader", version: "1.1.0" } }
			]
		}
	}, { clipboard: { async writeText(text) { copied.push(text); } } });
	await page.flush();
	page.remount(); await page.flush();
	const report = findNode(page.render(), node => node.type === "details" && JSON.stringify(node).includes("上次更新失败"));
	assert(report);
	const button = findNode(report, node => node.type === "button" && node.children.includes("复制诊断"));
	await button.props.onClick();
	assert.match(copied[0], /正式 npm 安装：通过（退出码 0）/);
	assert.match(copied[0], /正式 CLI 校验：失败（退出码 1）/);
	assert.match(copied[0], /fixture-loader@1\.1\.0/);
	assert.match(copied[0], /已恢复到 1\.0\.0/);
	assert.match(JSON.stringify(page.render()), /诊断已复制/);
	page.cleanup();
});

test("failure dialog can be opened from failure card and shows detailed diagnostics", async () => {
	const copied = [];
	const page = mountStatus({
		ok: true, stage: "installed", inProgress: false,
		lastFailure: {
			id: "diag-test", kind: "dsh", target: "0.2.3-alpha.1", stage: "verifying",
			summary: "SyntaxError: missing EntryValidationError",
			rolledBack: true, installedVersion: "0.2.2-rc.5", checks: [
				{ phase: "install", ok: true, code: 0 },
				{ phase: "cli", ok: false, code: 1, dependency: { name: "@deepseek-ai/cordis-plugin-loader", version: "1.1.0" } }
			],
			hint: "请在隔离环境复现并核对实际解析到的依赖版本。"
		}
	}, { clipboard: { async writeText(text) { copied.push(text); } } });
	await page.flush();

	const card = findNode(page.render(), node => node.type === "details" && JSON.stringify(node).includes("上次更新失败"));
	assert(card);
	const viewDialogBtn = findNode(card, node => node.type === "button" && node.children.includes("查看详细诊断"));
	assert(viewDialogBtn);

	await viewDialogBtn.props.onClick();
	const dialog = findNode(page.render(), node => node.props?.["aria-labelledby"] === "dsh-about-failure-title");
	assert(dialog);
	assert.match(JSON.stringify(dialog), /更新失败诊断 · DSH v0\.2\.3-alpha\.1/);
	assert.match(JSON.stringify(dialog), /已安全回退到 0\.2\.2-rc\.5/);

	const copyBtn = findNode(dialog, node => node.type === "button" && node.children.includes("复制诊断"));
	assert(copyBtn);
	await copyBtn.props.onClick();
	assert.match(copied[0], /【DSH 更新失败诊断报告与修复请求】/);
	assert.match(copied[0], /@deepseek-ai\/cordis-plugin-loader@1\.1\.0/);

	const closeBtn = findNode(dialog, node => node.type === "button" && node.children.includes("关闭"));
	assert(closeBtn);
	await closeBtn.props.onClick();
	assert.equal(findNode(page.render(), node => node.props?.["aria-labelledby"] === "dsh-about-failure-title"), null);
	page.cleanup();
});

test("a failure for the version that is already running is not shown again", async () => {
	const page = mountStatus({
		ok: true, stage: "installed", inProgress: false,
		lastFailure: {
			id: "stale-preflight", kind: "dsh", target: "0.2.3-alpha.2", stage: "preflight",
			summary: "npm 安装超时", finishedAt: 1, checks: [{ phase: "preflight-install", ok: false, timedOut: true, code: null }]
		}
	}, { mountDescribe: true, describe: { ok: true, version: "0.2.3-alpha.2" } });
	await page.flush();
	await page.flush();
	assert.equal(findNode(page.render(), node => node.type === "details" && JSON.stringify(node).includes("上次更新失败")), null);
	assert.equal(findNode(page.render(), node => node.props?.["aria-labelledby"] === "dsh-about-failure-title"), null);
	page.cleanup();
});

test("the same failure still renders while its target is not installed", async () => {
	const page = mountStatus({
		ok: true, stage: "installed", inProgress: false,
		lastFailure: {
			id: "current-preflight", kind: "dsh", target: "0.2.4", stage: "preflight",
			summary: "npm 安装超时", finishedAt: 1, checks: []
		}
	}, { mountDescribe: true, describe: { ok: true, version: "0.2.3-alpha.2" } });
	await page.flush();
	await page.flush();
	assert(findNode(page.render(), node => node.type === "details" && JSON.stringify(node).includes("上次更新失败")));
	page.cleanup();
});

test("covered failures stay out of the surface list but remain in the history menu", async () => {
	const page = mountStatus({
		ok: true, stage: "installed", inProgress: false, lastFailure: null
	}, {
		failureHistory: { ok: true, failures: [
			{
				id: "archived", kind: "dsh", target: "0.2.3-alpha.1", stage: "preflight", summary: "旧版本的 npm 安装超时",
				finishedAt: 1000, superseded: true, checks: [{ phase: "preflight-install", ok: false, timedOut: true, code: null }],
				hint: "请切换更新源后重试"
			}
		] }
	});
	await page.flush();
	await page.flush();
	// 表面（常驻列表）不展示已覆盖的旧记录
	assert.equal(findNode(page.render(), node => node.props?.className?.includes("dsh-about-history-panel")), null);
	assert.equal(findNode(page.render(), node => node.props?.className?.includes("dsh-about-history-item")), null);
	// 感叹号入口仍指向完整历史，并且能在悬停内容里看到旧记录
	const trigger = findNode(page.render(), node => node.props?.["aria-haspopup"] === "dialog");
	assert(trigger, "检查更新行末尾仍保留感叹号入口");
	assert.match(trigger.props["aria-label"], /报错历史（1 条）/);
	assert.doesNotMatch(trigger.props.className, /dsh-about-bang-btn-idle/);
	const bang = findNode(page.render(), node => node.props?.className === "dsh-about-bang");
	assert(bang);
	assert.match(JSON.stringify(bang), /旧版本的 npm 安装超时/, "悬停预览应包含全部历史");
	assert.match(JSON.stringify(bang), /均已覆盖/);
	// 二级菜单同样展示全部历史，并标注已覆盖
	await trigger.props.onClick();
	await page.flush();
	const dialog = findNode(page.render(), node => node.props?.["aria-labelledby"] === "dsh-about-history-title");
	assert(dialog);
	assert.match(JSON.stringify(dialog), /旧版本的 npm 安装超时/);
	assert.match(JSON.stringify(dialog), /已被新版本覆盖/);
	assert.match(JSON.stringify(dialog), /共 1 条，均已覆盖/);
	const oldRow = findNode(dialog, node => node.props?.className?.includes("dsh-about-history-item-old"));
	assert(oldRow, "已覆盖记录在菜单里发灰显示");
	page.cleanup();
});

test("current error history is displayed and opens its diagnostics", async () => {
	const copied = [];
	const page = mountStatus({
		ok: true, stage: "installed", inProgress: false, lastFailure: null
	}, {
		clipboard: { async writeText(text) { copied.push(text); } },
		failureHistory: { ok: true, failures: [
			{
				id: "current", kind: "dsh", target: "0.2.3-alpha.3", stage: "preflight", summary: "npm 安装超时",
				finishedAt: 1000, superseded: false, checks: [{ phase: "preflight-install", ok: false, timedOut: true, code: null }],
				hint: "请切换更新源后重试"
			}
		] }
	});
	await page.flush();
	await page.flush();
	const tree = JSON.stringify(page.render());
	assert.match(tree, /npm 安装超时/);
	assert.doesNotMatch(tree, /已被新版本覆盖/);
	const trigger = findNode(page.render(), node => node.props?.["aria-haspopup"] === "dialog");
	assert(trigger);
	assert.match(trigger.props["aria-label"], /报错历史（1 条）/);
	assert.doesNotMatch(trigger.props.className, /dsh-about-bang-btn-idle/);
	const bang = findNode(page.render(), node => node.props?.className === "dsh-about-bang");
	assert(bang);
	assert.match(JSON.stringify(bang), /点击感叹号查看全部/, "悬停预览内容随触发器一起渲染");
	const panel = findNode(page.render(), node => node.props?.className?.includes("dsh-about-history-panel"));
	assert(panel, "报错历史列表常驻在检查更新与版本更新记录之间");
	const detail = findNode(page.render(), node => node.type === "button" && node.children?.includes("详情"));
	assert(detail);
	await detail.props.onClick();
	const dialog = findNode(page.render(), node => node.props?.["aria-labelledby"] === "dsh-about-failure-title");
	assert(dialog);
	assert.match(JSON.stringify(dialog), /0\.2\.3-alpha\.3/);
	assert.match(JSON.stringify(dialog), /请切换更新源后重试/);
	const copy = findNode(dialog, node => node.type === "button" && node.children?.includes("复制诊断"));
	await copy.props.onClick();
	assert.match(copied[0], /【DSH 更新失败诊断报告与修复请求】/);
	page.cleanup();
});

test("the surface lists only pending errors while the history menu lists all", async () => {
	const page = mountStatus({
		ok: true, stage: "installed", inProgress: false, lastFailure: null
	}, {
		failureHistory: { ok: true, failures: [
			{ id: "newer", kind: "dsh", target: "0.2.3-alpha.2", stage: "verifying", summary: "第二条报错", finishedAt: 2000, superseded: false, checks: [] },
			{ id: "older", kind: "plugin", target: "1.8.4", stage: "preflight", summary: "第一条报错", finishedAt: 1000, superseded: true, checks: [] }
		] }
	});
	await page.flush();
	await page.flush();
	const trigger = findNode(page.render(), node => node.props?.["aria-haspopup"] === "dialog");
	assert(trigger);
	assert.match(trigger.props["aria-label"], /报错历史（2 条）/, "入口计数按全部历史计算");
	assert.doesNotMatch(trigger.props.className, /dsh-about-bang-btn-idle/, "有历史记录时感叹号保持琥珀色");
	const panel = findNode(page.render(), node => node.props?.className?.includes("dsh-about-history-panel"));
	assert(panel, "表面列表仍展示待处理记录");
	assert.match(JSON.stringify(panel), /第二条报错/);
	assert.doesNotMatch(JSON.stringify(panel), /第一条报错/, "已覆盖的记录不进入表面列表");
	await trigger.props.onClick();
	await page.flush();
	const dialog = findNode(page.render(), node => node.props?.["aria-labelledby"] === "dsh-about-history-title");
	assert(dialog);
	assert.match(JSON.stringify(dialog), /共 2 条/);
	const list = findNode(dialog, node => node.props?.className?.includes("dsh-about-history-dialog-list"));
	assert(list, "二级菜单使用可滚动列表");
	assert.equal((JSON.stringify(list).match(/className":"dsh-about-history-item/g) || []).length, 2);
	assert.match(JSON.stringify(list), /第二条报错/);
	assert.match(JSON.stringify(list), /第一条报错/, "二级菜单展示全部历史");
	assert.match(JSON.stringify(list), /已被新版本覆盖/);
	assert.match(JSON.stringify(dialog), /其中 1 条仍需处理/);
	// Escape 关闭二级菜单
	page.key({ key: "Escape" });
	await page.flush();
	assert.equal(findNode(page.render(), node => node.props?.["aria-labelledby"] === "dsh-about-history-title"), null);
	// 重新打开后可用「关闭」按钮退出
	const reopen = findNode(page.render(), node => node.props?.["aria-haspopup"] === "dialog");
	await reopen.props.onClick();
	await page.flush();
	const reopened = findNode(page.render(), node => node.props?.["aria-labelledby"] === "dsh-about-history-title");
	assert(reopened);
	const close = findNode(reopened, node => node.type === "button" && node.children?.includes("关闭"));
	assert(close);
	await close.props.onClick();
	await page.flush();
	assert.equal(findNode(page.render(), node => node.props?.["aria-labelledby"] === "dsh-about-history-title"), null);
	page.cleanup();
});

const notice = (page) => findNode(page.render(), node => node.props?.["aria-labelledby"] === "dsh-about-platform-notice-title");

for (const platform of ["win32 x64", "darwin arm64"]) {
	test(`${platform}: notice is dismissible and persists across remounts and reloads`, async () => {
		const storage = new Map();
		const page = mountStatus(undefined, { notice: true, platform, storage });
		assert.equal(notice(page), null, "wait for the host platform before displaying");
		await page.flush();
		assert(notice(page));
		assert.match(JSON.stringify(notice(page)), /计划在后续版本停止支持 Windows 和 macOS/);
		assert.match(JSON.stringify(notice(page)), /官方桌面端/);
		assert.match(JSON.stringify(notice(page)), /当前版本仍保留三平台支持/);
		assert(page.noticeFocused, "focus moves to the close button");
		findNode(notice(page), node => node.type === "button").props.onClick();
		await page.flush(); assert.equal(notice(page), null); assert(page.focusRestored);
		page.remount(); await page.flush(); assert.equal(notice(page), null); page.cleanup();
		const reloaded = mountStatus(undefined, { notice: true, platform, storage });
		await reloaded.flush(); assert.equal(notice(reloaded), null); reloaded.cleanup();
	});
}

for (const platform of ["linux x64", "linux arm64", undefined, "freebsd x64"]) {
	test(`${platform}: no desktop support notice and no storage marker`, async () => {
		const page = mountStatus(undefined, { notice: true, platform, browserPlatform: "MacIntel" });
		await page.flush(); assert.equal(notice(page), null); assert.equal(page.localStorage.size, 0); page.cleanup();
	});
}

test("Escape closes the notice and Tab keeps focus inside it", async () => {
	const page = mountStatus(undefined, { notice: true, platform: "win32 x64" });
	await page.flush();
	let prevented = false;
	page.key({ key: "Tab", shiftKey: true, preventDefault() { prevented = true; } });
	assert(prevented); assert(page.noticeFocused);
	page.key({ key: "Escape" }); await page.flush(); assert.equal(notice(page), null); assert(page.focusRestored);
	page.cleanup();
});

test("clicking inside the notice keeps it open; clicking the backdrop dismisses it", async () => {
	const page = mountStatus(undefined, { notice: true, platform: "darwin arm64" });
	await page.flush();
	const overlay = findNode(page.render(), node => node.props?.className === "dsh-about-overlay");
	overlay.props.onClick({ target: {}, currentTarget: overlay }); await page.flush(); assert(notice(page));
	overlay.props.onClick({ target: overlay, currentTarget: overlay }); await page.flush(); assert.equal(notice(page), null);
	page.cleanup();
});

test("disabled browser storage still shows a dismissible notice once per page lifetime", async () => {
	const page = mountStatus(undefined, { notice: true, platform: "win32 x64", storageBlocked: true });
	await page.flush(); assert(notice(page));
	page.key({ key: "Escape" }); await page.flush(); assert.equal(notice(page), null);
	page.remount(); await page.flush(); assert.equal(notice(page), null); page.cleanup();
});

test("a failed host description does not guess the platform from the browser", async () => {
	const page = mountStatus(undefined, { notice: true, describe: { ok: false, platform: "win32 x64" } });
	await page.flush(); assert.equal(notice(page), null); assert.equal(page.localStorage.size, 0); page.cleanup();
});
