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
		navigator: { platform: options.browserPlatform || "Win32" },
		document, Date: class extends Date { static now() { return now; } },
		sessionStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
		fetch: async (url) => {
			if (url.endsWith("/describe")) return { json: async () => options.describe || { ok: true, platform: options.platform, version: "1.0.0" } };
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
				: source.includes('"/update-status"');
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
const notice = (page) => findNode(page.render(), node => node.props?.["aria-labelledby"] === "dsh-about-platform-notice-title");

for (const platform of ["win32 x64", "darwin arm64"]) {
	test(`${platform}: notice is dismissible and persists across remounts and reloads`, async () => {
		const storage = new Map();
		const page = mountStatus(undefined, { notice: true, platform, storage });
		assert.equal(notice(page), null, "wait for the host platform before displaying");
		await page.flush();
		assert(notice(page));
		assert.match(JSON.stringify(notice(page)), /从下一个版本起，dsh-about 将不再支持 Windows 和 macOS/);
		assert.match(JSON.stringify(notice(page)), /官方桌面端/);
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
