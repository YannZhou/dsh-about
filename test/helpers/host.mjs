// 测试用宿主：把 lib/index.js 注册的 /dsh-about/* 路由挂到一个真实 HTTP 服务上。
//
// 为什么不 import 后直接调函数：宿主半体只通过 ctx.webServer.register 暴露 handler，
// 没有导出任何可单测的入口。用一个最小 ctx 捕获路由，再套真实 http server，
// 就能用真实请求覆盖「回环限制 / Origin / content-type / 请求体」这些防护层——
// 它们全都在 handler 内部，绕过 HTTP 层单测等于没测。
import http from "node:http";

/** 动态 import 宿主半体。DSH_HOME / GITHUB_TOKEN 必须在 import 之前设好：
 *  DATA_DIR、AUTH_FILE、SOURCE_FILE 和初始 githubToken 都在模块加载时求值。 */
export async function importHost() {
	return import(new URL("../../lib/index.js", import.meta.url).href);
}

/** 启动一个只服务 /dsh-about 的最小宿主。 */
export async function startHost(mod) {
	const routes = [];
	const ctx = {
		// 真实 ctx.effect 负责注册/清理副作用；测试里同步执行拿到注册结果即可。
		effect(fn) {
			return fn();
		},
		webServer: {
			register(route) {
				routes.push(route);
				return () => {};
			}
		}
	};
	mod.apply(ctx);
	const route = routes.find((r) => r.path === "/dsh-about" && r.kind === "prefix");
	if (!route) throw new Error("宿主未注册 /dsh-about 前缀路由");
	const server = http.createServer((req, res) => {
		Promise.resolve(route.handler(req, res)).catch(() => {
			if (!res.headersSent) res.writeHead(500);
			res.end();
		});
	});
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	const { port } = server.address();
	return {
		port,
		url: `http://127.0.0.1:${port}`,
		close: () => new Promise((resolve) => server.close(resolve))
	};
}

/** 用 node:http 发请求（而不是 fetch）：测试要显式伪造 Host / Origin 头，
 *  fetch 会拒绝或忽略 Host，只有底层 http 能如实发出。 */
export function request(port, path, { method = "GET", headers = {}, body } = {}) {
	return new Promise((resolve, reject) => {
		const payload = body === undefined ? null : Buffer.from(body);
		const finalHeaders = { ...headers };
		if (payload !== null && finalHeaders["content-length"] === undefined) {
			finalHeaders["content-length"] = payload.length;
		}
		const req = http.request(
			{ host: "127.0.0.1", port, path, method, headers: finalHeaders },
			(res) => {
				let raw = "";
				res.setEncoding("utf8");
				res.on("data", (chunk) => {
					raw += chunk;
				});
				res.on("end", () => {
					let json = null;
					try {
						json = JSON.parse(raw);
					} catch {
						/* 非 JSON 响应（如 403 forbidden 纯文本）保持 null */
					}
					resolve({ status: res.statusCode, headers: res.headers, body: raw, json });
				});
			}
		);
		req.on("error", reject);
		req.end(payload ?? undefined);
	});
}

/** 把 GitHub + npm registry 的 fetch 全部拦在进程内，测试不碰外网。
 *  被测代码用的是全局 fetch，因此替换 globalThis.fetch 即可，无需改动被测源码。 */
export function installFetchStub() {
	const original = globalThis.fetch;
	const calls = [];
	let githubHandler = null;
	let registryHandler = null;

	const stub = (url, init) => {
		const target = String(url);
		calls.push({ url: target, init: init ?? {} });
		if (target.includes("api.github.com")) {
			if (githubHandler === null) throw new Error(`未配置 GitHub 响应：${target}`);
			return Promise.resolve(githubHandler(target, init ?? {}));
		}
		if (registryHandler === null) throw new Error(`未配置 registry 响应：${target}`);
		return Promise.resolve(registryHandler(target, init ?? {}));
	};

	globalThis.fetch = stub;

	return {
		calls,
		/** 设定 api.github.com 的响应。status 之外的配额头由 headers 指定。 */
		setGithub(handler) {
			githubHandler = handler;
		},
		/** 设定 npm registry 的响应（默认给一个干净的最小 packument）。 */
		setRegistry(handler) {
			registryHandler = handler;
		},
		/** 按 URL 过滤出被拦截的调用。 */
		githubCalls() {
			return calls.filter((c) => c.url.includes("api.github.com"));
		},
		restore() {
			globalThis.fetch = original;
		}
	};
}

/** 造一个 GitHub Releases 响应（默认 403 + 配额耗尽，即插件报「拉取失败」的真实场景）。 */
export function githubReleaseResponse({
	status = 403,
	remaining = 0,
	limit = 60,
	reset = Math.floor(Date.now() / 1000) + 1800,
	body = []
} = {}) {
	return () =>
		new Response(typeof body === "string" ? body : JSON.stringify(body), {
			status,
			headers: {
				"content-type": "application/json",
				"x-ratelimit-limit": String(limit),
				"x-ratelimit-remaining": String(remaining),
				"x-ratelimit-reset": String(reset)
			}
		});
}

/** 造一个 npm packument 响应。 */
export function npmPackumentResponse({ latest = "1.8.0", versions = ["1.8.0"] } = {}) {
	return () =>
		new Response(
			JSON.stringify({
				"dist-tags": { latest },
				versions: Object.fromEntries(versions.map((v) => [v, { version: v }]))
			}),
			{ status: 200, headers: { "content-type": "application/json" } }
		);
}
