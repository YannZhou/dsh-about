// dsh-about — 设置中心「关于」分区的宿主半体。
//
// 职责（同源 HTTP 路由，前缀 /dsh-about，仅回环地址可访问；浏览器跨站请求被拒）：
//   GET  /dsh-about/describe — 当前版本、平台、运行环境详情
//   GET  /dsh-about/releases — 官方 GitHub Releases（最多 10 个版本，落盘每日缓存；?force=1 手动强刷）
//   POST /dsh-about/check    — 查询 npm dist-tags，取 latest/next 中较新者对比
//   GET  /dsh-about/versions — npm 完整版本列表（仅比当前新的，最多 10 个，供弹窗选择）
//   POST /dsh-about/update   — npm install -g 安装所选版本；成功后自动重启 dsh
//
// 浏览器半体在 ./client.js；本文件是宿主侧插件（随 cordis 组合启动，
// 与其余客户端插件同一机制，重启后依然生效）。
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
// 内嵌迷你 semver（严格解析 + 优先级比较，语义对齐 node-semver，见 ./semver.js）：
// 本包以 link: 方式被 dsh plugin 安装时不会携带外部依赖，内嵌后零运行时依赖。
import * as semver from "./semver.js";
import { promises as fsp } from "node:fs";
import path from "node:path";

export const name = "dsh-about";
export const inject = ["webServer"];

const require = createRequire(import.meta.url);

/** 读取一个已安装 npm 包的版本号；失败时返回占位符。 */
function readPackageVersion(spec, fallback) {
	try {
		const pkg = require(`${spec}/package.json`);
		return typeof pkg.version === "string" && pkg.version !== "" ? pkg.version : fallback;
	} catch {
		return fallback;
	}
}

/** 宿主应用（apps/cli，即 @deepseek-ai/dsh）版本。 */
function currentVersion() {
	return readPackageVersion("@deepseek-ai/dsh", "unknown");
}

/** Web 前端（@deepseek-ai/dsh-web-frontend）版本。 */
function webVersion() {
	return readPackageVersion("@deepseek-ai/dsh-web-frontend", "unknown");
}

/** 回环主机名判定：localhost / [::1] / 127.x。 */
function isLoopbackHostname(hostname) {
	if (hostname === "localhost" || hostname === "[::1]") return true;
	const parts = hostname.split(".");
	return (
		parts.length === 4 &&
		parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255) &&
		parts[0] === "127"
	);
}

/** 回环地址判定（防 DNS 重绑定）：仅允许 localhost / [::1] / 127.x 访问本插件的路由。 */
function isLoopbackRequest(req) {
	const host = req.headers.host;
	if (typeof host !== "string" || host === "") return false;
	try {
		return isLoopbackHostname(new URL(`http://${host}`).hostname);
	} catch {
		return false;
	}
}

/** 跨站请求防护：浏览器跨站 POST 若带 Origin 头，必须来自回环来源才放行。 */
function isSafeOrigin(req) {
	const origin = req.headers.origin;
	if (typeof origin !== "string" || origin === "") return true;
	try {
		return isLoopbackHostname(new URL(origin).hostname);
	} catch {
		return false;
	}
}

/** 浏览器跨站特征：Sec-Fetch-Site: cross-site 表明请求来自其他站点的页面。
 * GET 端点用它兜底（img/表单等标签可无预检触发），POST 端点走 Origin 校验。 */
function isCrossSiteRequest(req) {
	const site = req.headers["sec-fetch-site"];
	return typeof site === "string" && site.toLowerCase() === "cross-site";
}

/** 写一个 JSON 响应（extraHeaders 可选，用于 no-store 等缓存指令）。 */
function sendJson(res, status, body, extraHeaders = {}) {
	const payload = JSON.stringify(body);
	res.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"content-length": Buffer.byteLength(payload),
		...extraHeaders
	});
	res.end(payload);
}

/** 读取并解析请求体 JSON（限流：64 KiB 足够承载一个版本号字符串；
 * 空闲超时兜底：body 迟迟未完成时主动拒绝，避免 updateInFlight 互斥被
 * 慢速客户端拖到连接超时（默认 300s）才释放）。 */
function readBody(req, timeoutMs = 30_000) {
	return new Promise((resolve, reject) => {
		let settled = false;
		let overflow = false;
		let size = 0;
		const chunks = [];
		const settle = (fn, value) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			fn(value);
		};
		// 空闲超时：30s 内未收完 body 即拒绝（尽快释放互斥），
		// 继续排空数据，400 响应照常送达
		const timer = setTimeout(() => {
			overflow = true;
			req.resume();
			settle(reject, new Error("请求体读取超时"));
		}, timeoutMs);
		const declared = Number.parseInt(String(req.headers["content-length"] ?? ""), 10);
		if (Number.isFinite(declared) && declared > 64 * 1024) {
			// 按 content-length 预检拒绝：不 destroy 连接，400 响应才能正常送达；
			// resume 把剩余请求体排空，避免连接挂起
			settle(reject, new Error("body too large"));
			req.on("error", () => { /* 排空期间的连接错误静默忽略 */ });
			req.resume();
			return;
		}
		req.on("data", (chunk) => {
			if (overflow) return;
			size += chunk.length;
			if (size > 64 * 1024) {
				// 超限时只拒绝、不断开：继续把剩余数据排空，让 400 响应送达
				overflow = true;
				settle(reject, new Error("body too large"));
				return;
			}
			chunks.push(chunk);
		});
		req.on("end", () => {
			if (overflow) return;
			try {
				settle(resolve, JSON.parse(Buffer.concat(chunks).toString("utf8")));
			} catch (error) {
				settle(reject, new Error(`invalid json body: ${String(error)}`));
			}
		});
		req.on("error", (error) => settle(reject, error));
	});
}

const REGISTRY_TAGS_URL = "https://registry.npmjs.org/-/package/@deepseek-ai/dsh/dist-tags";
const REGISTRY_FETCH_TIMEOUT_MS = 15_000;

const GITHUB_RELEASES_URL = "https://api.github.com/repos/deepseek-ai/deepseek-harness/releases?per_page=10";
/** 进程内并发合并：同一时刻的 GitHub 请求合并为一次；是否实际访问 GitHub 由 /releases 路由按磁盘缓存状态决定。 */
let releasesInflight = null;

/** 拉取官方 GitHub Releases（最多 10 个），规整为最小展示字段。 */
async function fetchReleases() {
	const res = await fetch(GITHUB_RELEASES_URL, {
		headers: {
			"User-Agent": "dsh-about",
			Accept: "application/vnd.github+json"
		},
		signal: AbortSignal.timeout(REGISTRY_FETCH_TIMEOUT_MS)
	});
	if (!res.ok) throw new Error(`GitHub 接口返回 ${res.status}`);
	const arr = await res.json();
	if (!Array.isArray(arr)) throw new Error("GitHub 返回格式异常");
	return arr
		.filter((release) => typeof release.tag_name === "string")
		.slice(0, 10)
		.map((release) => ({
			version: release.tag_name.replace(/^dsh-v/i, ""),
			name: typeof release.name === "string" && release.name !== "" ? release.name : release.tag_name,
			prerelease: release.prerelease === true,
			publishedAt: typeof release.published_at === "string" ? release.published_at.slice(0, 10) : "",
			body: typeof release.body === "string" ? release.body : ""
		}));
}

/** 版本记录读取：不缓存，并发请求合并（组件重挂载时不会重复打 GitHub）。 */
async function getReleases() {
	if (releasesInflight === null) {
		releasesInflight = fetchReleases().finally(() => {
			releasesInflight = null;
		});
	}
	return releasesInflight;
}

/* ───────────── 本地磁盘持久化（替代浏览器 localStorage） ───────────── */
/** 版本记录内容缓存与「当日已尝试」标记统一落盘到这一文件。 */
const DATA_DIR = path.join(process.env.DSH_HOME || path.join(process.env.HOME || "", ".dsh"), "dsh-about");
const RELEASES_CACHE_FILE = path.join(DATA_DIR, "releases-cache.json");

/** 本地时区的今天，形如 2026-08-21。 */
function todayStr() {
	const d = new Date();
	const m = String(d.getMonth() + 1).padStart(2, "0");
	const day = String(d.getDate()).padStart(2, "0");
	return `${d.getFullYear()}-${m}-${day}`;
}

/** 从磁盘读取缓存状态；文件缺失或损坏时返回空状态。 */
async function readReleasesState() {
	try {
		const raw = await fsp.readFile(RELEASES_CACHE_FILE, "utf8");
		const parsed = JSON.parse(raw);
		if (parsed !== null && typeof parsed === "object") {
			return {
				fetchedOn: typeof parsed.fetchedOn === "string" ? parsed.fetchedOn : "",
				attemptedOn: typeof parsed.attemptedOn === "string" ? parsed.attemptedOn : "",
				releases: Array.isArray(parsed.releases) ? parsed.releases : []
			};
		}
	} catch {
		/* 首次运行 / 文件缺失 / 解析失败：视为无缓存 */
	}
	return { fetchedOn: "", attemptedOn: "", releases: [] };
}

/** 把缓存状态写入磁盘（目录不存在时自动创建）。 */
async function writeReleasesState(state) {
	try {
		await fsp.mkdir(DATA_DIR, { recursive: true });
		await fsp.writeFile(RELEASES_CACHE_FILE, JSON.stringify(state, null, 2), "utf8");
	} catch {
		/* 写失败不影响本次响应，仅退化为无缓存 */
	}
}

const PACKUMENT_URL = "https://registry.npmjs.org/@deepseek-ai/dsh";
/** 拉取 npm 缩写 packument（一次请求同时拿到 dist-tags 与全部版本号）。 */
async function fetchPackument() {
	const res = await fetch(PACKUMENT_URL, {
		headers: { Accept: "application/vnd.npm.install-v1+json" },
		signal: AbortSignal.timeout(REGISTRY_FETCH_TIMEOUT_MS)
	});
	if (!res.ok) throw new Error(`npm registry responded ${res.status}`);
	const packument = await res.json();
	const tags = typeof packument["dist-tags"] === "object" && packument["dist-tags"] !== null ? packument["dist-tags"] : {};
	const all = Array.isArray(packument.versions)
		? packument.versions
		: typeof packument.versions === "object" && packument.versions !== null
			? Object.keys(packument.versions)
			: [];
	return {
		latest: typeof tags.latest === "string" ? tags.latest : null,
		next: typeof tags.next === "string" ? tags.next : null,
		versions: all
	};
}

/** 可安装版本列表：仅比当前新的合法版本，降序取前 10，供弹窗选择。 */
async function getInstallableVersions() {
	const { latest, next, versions: all } = await fetchPackument();
	const current = currentVersion();
	const currentValid = semver.valid(current) !== null;
	const newer = all
		.filter((v) => typeof v === "string" && semver.valid(v) !== null && (!currentValid || semver.gt(v, current)))
		.sort((a, b) => semver.rcompare(a, b))
		.slice(0, 10)
		.map((v) => {
			const entry = { version: v, tags: [] };
			if (v === latest) entry.tags.push("latest");
			if (v === next) entry.tags.push("next");
			return entry;
		});
	return {
		current,
		latest,
		next,
		versions: newer,
		newest: newer.length > 0 ? newer[0].version : null
	};
}

/** 查询 npm dist-tags；latest 与 next 任一失败都不阻断整个检查。 */
async function fetchDistTags() {
	const res = await fetch(REGISTRY_TAGS_URL, { signal: AbortSignal.timeout(REGISTRY_FETCH_TIMEOUT_MS) });
	if (!res.ok) throw new Error(`npm registry responded ${res.status}`);
	const tags = await res.json();
	return {
		latest: typeof tags.latest === "string" ? tags.latest : null,
		next: typeof tags.next === "string" ? tags.next : null
	};
}

/** 在一组候选版本里取语义版本最大的一个；全部非法时返回 null。 */
function newestOf(candidates) {
	let best = null;
	for (const candidate of candidates) {
		if (typeof candidate !== "string" || !semver.valid(candidate)) continue;
		if (best === null || semver.gt(candidate, best)) best = candidate;
	}
	return best;
}

/** 检查更新：对比当前版本与 npm latest/next 中较新者。 */
async function checkUpdate() {
	const current = currentVersion();
	let tags;
	try {
		tags = await fetchDistTags();
	} catch (error) {
		return {
			ok: false,
			error: `检查更新失败：${error.message}`,
			current
		};
	}
	const candidates = [tags.latest, tags.next].filter((v) => v !== null);
	const newest = newestOf(candidates);
	if (newest === null) {
		return {
			ok: false,
			error: "未能从 npm 获取有效的版本信息",
			current,
			latest: tags.latest,
			next: tags.next
		};
	}
	const updateAvailable = semver.valid(current) !== null ? semver.lt(current, newest) : true;
	return {
		ok: true,
		current,
		latest: tags.latest,
		next: tags.next,
		newest,
		updateAvailable,
		source: newest === tags.latest ? "latest" : "next"
	};
}

/** 执行 npm 全局更新；等待退出（最久 5 分钟），返回结果与输出尾部。 */
function runUpdate(target) {
	const command = "npm";
	// 固定官方 registry：与 fetchPackument 的校验源一致，避免镜像投递同名不同内容
	const args = ["install", "-g", "--no-audit", "--no-fund", "--registry=https://registry.npmjs.org/", `@deepseek-ai/dsh@${target}`];
	return new Promise((resolve) => {
		// detached：让 npm 进入独立进程组，超时时可以连子进程一起终止
		const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], detached: true });
		let out = "";
		const append = (chunk) => {
			out += String(chunk);
		};
		child.stdout?.on("data", append);
		child.stderr?.on("data", append);
		const timer = setTimeout(() => {
			// 终止整个进程组（npm 会派生子进程），避免超时后安装仍在后台继续；
			// SIGTERM 未奏效时 2.5s 后升级 SIGKILL
			try {
				process.kill(-child.pid, "SIGTERM");
			} catch {
				try { child.kill("SIGTERM"); } catch { /* 进程已退出 */ }
			}
			const killer = setTimeout(() => {
				try {
					process.kill(-child.pid, "SIGKILL");
				} catch {
					try { child.kill("SIGKILL"); } catch { /* 进程已退出 */ }
				}
			}, 2500);
			killer.unref?.();
			resolve({ ok: false, timedOut: true, code: null, out: out.slice(-4000) });
		}, 5 * 60 * 1000);
		child.on("error", (error) => {
			clearTimeout(timer);
			resolve({ ok: false, timedOut: false, code: null, out: `启动 npm 失败：${error.message}` });
		});
		child.on("close", (code) => {
			clearTimeout(timer);
			resolve({ ok: code === 0, timedOut: false, code, out: out.slice(-4000) });
		});
	});
}

/* ───────────── 自动重启（委托外部一次性看护 dsh-watchdog once） ───────────── */
/**
 * 更新成功后不再由插件内嵌进程做裸拉起（旧实现会在 systemd 场景下与
 * dsh-web.service 抢 3080 端口、触发 StartLimit 导致单元 failed、必须手动启动）。
 *
 * 改为委托外部一次性脚本 ~/.local/bin/dsh-watchdog once（纯 bash、与 dsh/npm/
 * 插件完全独立，不常驻、零常驻资源）：
 *   1) 等待宿主（本进程）退出；
 *   2) 数 3 秒（DSH_WATCH_COUNTDOWN）；
 *   3) 优先 systemctl --user start dsh-web（单元挂死则 restart，systemd 不可用
 *      才退回原命令裸拉起，均带 --no-open 不弹浏览器）；
 *   4) 端口就绪后自动退出。
 * 决策日志统一写入 ~/.dsh/dsh-watchdog.log。
 */
let restartArmed = false;
/** /update 互斥：同一时刻只允许一个 npm 安装任务（多标签页防护）。 */
let updateInFlight = false;

/** 本包内置的一次性看护脚本（随 dsh plugin add 拷入 profile node_modules）。 */
const BUNDLED_WATCHDOG = fileURLToPath(new URL("../bin/dsh-watchdog", import.meta.url));

/** 解析可用的一次性看护脚本：优先用户安装位置（~/.local/bin，可自行升级），
 *  次选本包内置副本；两者都不可执行时返回 null（此时不退出宿主、由客户端提示手动重启）。 */
function resolveWatchdog() {
	const home = process.env.HOME || "";
	for (const candidate of [`${home}/.local/bin/dsh-watchdog`, BUNDLED_WATCHDOG]) {
		try {
			fs.accessSync(candidate, fs.constants.X_OK);
			return candidate;
		} catch {
			/* 不存在或不可执行，试下一个 */
		}
	}
	return null;
}

/**
 * 在安装成功后调度自动重启：派发外部一次性看护 `dsh-watchdog once`
 * （等待宿主退出 → 数 3 秒 → 拉起 dsh web → 端口就绪自动退出），随后
 * 本进程优雅退出（延迟给响应留出送达时间）。
 * @param delayMs - 给响应落盘/送达的缓冲毫秒数。
 * @param portOverride - 浏览器上报的真实端口（覆盖 argv 解析，防配置级改端口/--port 0）。
 */
function scheduleAutoRestart(delayMs = 2500, portOverride) {
	if (restartArmed) return false;
	restartArmed = true;
	let exitTimer = null;
	// 重新拉起时追加 --no-open：让已打开的 PWA/浏览器窗口在原地刷新重连，
	// 而不是再把默认浏览器弹一个新的标签/窗口出来。
	const restartArgs = process.argv.slice(2).filter((a) => a !== "--open" && a !== "--no-open");
	restartArgs.push("--no-open");
	// 端口：优先浏览器上报（最权威），其次解析 --port，缺省 3080
	let port = 3080;
	if (Number.isInteger(portOverride) && portOverride > 0 && portOverride <= 65535) {
		port = portOverride;
	} else {
		const portIdx = restartArgs.indexOf("--port");
		if (portIdx !== -1 && restartArgs[portIdx + 1]) port = Number(restartArgs[portIdx + 1]) || 3080;
	}
	const rawCmd = [process.execPath, process.argv[1], ...restartArgs].filter(Boolean).join(" ");
	// 看护脚本不可用（用户未安装、内置副本缺失）：不退出宿主，
	// 保持当前服务在线，交由客户端提示「手动重启」
	const watchdogBin = resolveWatchdog();
	if (watchdogBin === null) {
		restartArmed = false;
		return false;
	}
	try {
		// 派发外部一次性看护（bash 独立于 dsh/npm/插件，不常驻）：
		// 优先 systemd 拉起 dsh-web，systemd 不可用才退回 rawCmd 裸拉起。
		const restarter = spawn(
			"/usr/bin/bash",
			["-c", `exec "${watchdogBin}" once`],
			{
				detached: true,
				stdio: "ignore",
				env: {
					...process.env,
					DSH_WATCH_PID: String(process.pid),
					DSH_WATCH_PORT: String(port),
					DSH_WATCH_RAW_CMD: rawCmd,
					DSH_WATCH_UNIT: "dsh-web"
				}
			}
		);
		restarter.on("error", () => {
			// 看护派生失败（极罕见，如 bash 路径失效）：取消宿主退出，
			// 避免「进程退出却无人拉起」，客户端轮询超时后会提示手动重启
			if (exitTimer !== null) clearTimeout(exitTimer);
			restartArmed = false;
		});
		restarter.unref();
	} catch {
		/* 看护无法派生时不再自动重启，转入手动提示 */
		restartArmed = false;
		return false;
	}
	exitTimer = setTimeout(() => {
		process.exit(0);
	}, delayMs);
	return true;
}

export function apply(ctx) {
	const webServer = ctx.webServer;
	ctx.effect(
		() =>
			webServer.register({
				kind: "prefix",
				path: "/dsh-about",
				handler: async (req, res) => {
					if (!isLoopbackRequest(req)) {
						res.writeHead(403);
						res.end("forbidden");
						return;
					}
					if (req.method === "GET" && isCrossSiteRequest(req)) {
						// GET 端点可被 <img>/<script> 等跨站标签触发（无预检），
						// 用 Sec-Fetch-Site 拦下跨站页面请求，避免被当作出站请求放大器
						res.writeHead(403);
						res.end("forbidden");
						return;
					}
					let url;
					try {
						url = new URL(req.url ?? "/", "http://dsh.internal");
					} catch {
						res.writeHead(400);
						res.end("bad request");
						return;
					}
					try {
						if (req.method === "GET" && url.pathname === "/dsh-about/describe") {
							sendJson(res, 200, {
								ok: true,
								product: "DeepSeek Harness",
								version: currentVersion(),
								webVersion: webVersion(),
								node: process.version,
								platform: `${process.platform} ${process.arch}`,
								repo: "https://github.com/deepseek-ai/deepseek-harness"
							}, { "cache-control": "no-store" });
							return;
						}
						if (req.method === "POST" && url.pathname === "/dsh-about/check") {
							// 与 /update 同级的同源防护：跨站 form 的 Origin 无法伪装为回环
							if (!isSafeOrigin(req)) {
								sendJson(res, 403, { ok: false, error: "跨站请求被拒绝" });
								return;
							}
							sendJson(res, 200, await checkUpdate());
							return;
						}
						if (req.method === "GET" && url.pathname === "/dsh-about/releases") {
							const today = todayStr();
							const force = url.searchParams.get("force") === "1";
							if (force) {
								// 手动刷新：无条件实时拉取，成功后覆盖本地缓存；失败则返回本地已有内容 + 失败状态
								const state = await readReleasesState();
								try {
									const releases = await getReleases();
									await writeReleasesState({ fetchedOn: today, attemptedOn: today, releases });
									sendJson(res, 200, { ok: true, releases, fresh: true }, { "cache-control": "no-store" });
								} catch (error) {
									sendJson(res, 200, {
										ok: false,
										error: `获取版本更新失败：${error.message}`,
										releases: state.releases
									}, { "cache-control": "no-store" });
								}
								return;
							}
							const state = await readReleasesState();
							// 当天已有成功缓存 → 直接返回本地内容，不再访问网络
							if (state.fetchedOn === today) {
								sendJson(res, 200, { ok: true, releases: state.releases, fresh: false }, { "cache-control": "no-store" });
								return;
							}
							// 当天已自动尝试但失败 → 不再重复拉取，返回旧内容 + 失败状态
							if (state.attemptedOn === today) {
								sendJson(res, 200, { ok: false, error: "当日自动拉取已失败", releases: state.releases }, { "cache-control": "no-store" });
								return;
							}
							// 首次进入当天 → 实时拉取：成功写缓存，失败记「当日已尝试」
							try {
								const releases = await getReleases();
								await writeReleasesState({ fetchedOn: today, attemptedOn: today, releases });
								sendJson(res, 200, { ok: true, releases, fresh: true }, { "cache-control": "no-store" });
							} catch (error) {
								await writeReleasesState({ fetchedOn: state.fetchedOn, attemptedOn: today, releases: state.releases });
								sendJson(res, 200, {
									ok: false,
									error: `获取版本更新失败：${error.message}`,
									releases: state.releases
								}, { "cache-control": "no-store" });
							}
							return;
						}
						if (req.method === "GET" && url.pathname === "/dsh-about/versions") {
							try {
								sendJson(res, 200, { ok: true, ...(await getInstallableVersions()) }, { "cache-control": "no-store" });
							} catch (error) {
								sendJson(res, 200, { ok: false, error: `获取版本列表失败：${error.message}` }, { "cache-control": "no-store" });
							}
							return;
						}
						if (req.method === "POST" && url.pathname === "/dsh-about/update") {
							// 破坏性端点：先做并发互斥与 CSRF 防护，再解析与校验
							if (restartArmed) {
								// 安装已完成、进程即将退出：窗口期内的新请求一律拒绝，
								// 避免无意义重装并误报「需要手动重启」
								sendJson(res, 409, { ok: false, error: "dsh 即将重启，请稍后再试" });
								return;
							}
							if (updateInFlight) {
								sendJson(res, 409, { ok: false, error: "已有安装任务正在进行，请稍候重试" });
								return;
							}
							const contentType = String(req.headers["content-type"] ?? "");
							if (!contentType.toLowerCase().startsWith("application/json")) {
								// JSON 请求会触发浏览器 CORS 预检，跨站页面无法伪造，作为第一道 CSRF 防线
								sendJson(res, 415, { ok: false, error: "仅接受 application/json 请求" });
								return;
							}
							if (!isSafeOrigin(req)) {
								sendJson(res, 403, { ok: false, error: "跨站请求被拒绝" });
								return;
							}
							updateInFlight = true;
							try {
								let body;
								try {
									body = await readBody(req);
								} catch (error) {
									sendJson(res, 400, { ok: false, error: error.message });
									return;
								}
								const target = typeof body?.version === "string" && semver.valid(body.version) !== null ? body.version : null;
								if (target === null) {
									sendJson(res, 400, { ok: false, error: "缺少合法的目标版本号" });
									return;
								}
								// 校验目标版本确实已发布在 npm（与 /versions 口径一致，
								// 防止手改请求体安装列表外/不存在的版本）
								try {
									const published = await fetchPackument();
									if (!published.versions.includes(target)) {
										sendJson(res, 400, { ok: false, error: "该版本不存在于 npm 注册表" });
										return;
									}
								} catch (error) {
									sendJson(res, 502, { ok: false, error: `无法校验版本是否已发布：${error.message}` });
									return;
								}
								const current = currentVersion();
								if (target === current) {
									sendJson(res, 400, { ok: false, error: "该版本与当前安装版本相同，无需安装" });
									return;
								}
								if (semver.valid(current) !== null && !semver.gt(target, current)) {
									sendJson(res, 400, { ok: false, error: "仅支持安装比当前更新的版本" });
									return;
								}
								const result = await runUpdate(target);
								if (!result.ok) {
									sendJson(res, 200, {
										ok: false,
										timedOut: result.timedOut ?? false,
										code: result.code,
										tail: result.out,
										version: target,
										error: result.out.length > 0 ? undefined : "安装失败"
									});
									return;
								}
								// 安装成功：先调度自动重启，再把真实布防状态回给浏览器——
								// 看护进程派生失败时 restarting:false，由客户端提示手动重启
								const restarting = scheduleAutoRestart(2500, body?.port);
								sendJson(res, 200, {
									ok: true,
									restarting,
									version: target
								});
							} finally {
								updateInFlight = false;
							}
							return;
						}
						res.writeHead(404);
						res.end("not found");
					} catch (error) {
						sendJson(res, 500, { ok: false, error: String(error instanceof Error ? error.message : error) });
					}
				}
			}),
		"dsh-about: routes"
	);
}