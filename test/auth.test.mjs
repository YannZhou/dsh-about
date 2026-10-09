// /dsh-about/auth 与 /dsh-about/auth-test 的集成测试。
//
// 全部走真实 HTTP：起一个只挂本插件路由的 http server，用 node:http 发请求，
// 覆盖 网关层（回环 / Origin / content-type / 请求体限制）→ 业务层（保存 / 掩码 /
// 清除 / 环境变量兜底）→ 出站层（Authorization 头 / 配额回显）三段。
// 出站 fetch 被替换为进程内 stub，不碰外网。
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { DSH_HOME, AUTH_FILE, DATA_DIR, readAuthFile, authFileMode, cleanup } from "./helpers/env.mjs";
import { importHost, startHost, request, installFetchStub, githubReleaseResponse, npmPackumentResponse } from "./helpers/host.mjs";

const mod = await importHost();
const host = await startHost(mod);
const stub = installFetchStub();
stub.setRegistry(npmPackumentResponse());

test.after(async () => {
	await host.close();
	stub.restore();
	cleanup();
});

/** 每个用例前把 token 复位为未配置（清盘 + 走一次 POST 清空内存态）。 */
async function resetAuth() {
	await request(host.port, "/dsh-about/auth", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ token: "" })
	});
	fs.rmSync(AUTH_FILE, { force: true });
}

// ───────────── GET /auth：状态读取 ─────────────

test("GET /auth 未配置时返回 configured=false、masked 为空", async () => {
	await resetAuth();
	const res = await request(host.port, "/dsh-about/auth");
	assert.equal(res.status, 200);
	assert.equal(res.json.ok, true);
	assert.equal(res.json.configured, false);
	assert.equal(res.json.fromEnv, false);
	assert.equal(res.json.masked, "");
	assert.equal(res.headers["cache-control"], "no-store", "认证状态不得被缓存");
});

test("GET /auth 不泄露明文 token", async () => {
	await resetAuth();
	const secret = "ghp_AAAABBBBCCCCDDDDEEEEFFFFGGGGHHHH1234";
	await request(host.port, "/dsh-about/auth", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ token: secret })
	});
	const res = await request(host.port, "/dsh-about/auth");
	assert.equal(res.json.configured, true);
	assert.equal(res.body.includes(secret), false, "响应体不得包含明文 token");
	assert.notEqual(res.json.masked, secret);
});

// ───────────── POST /auth：保存 ─────────────

test("POST /auth 保存 token 后落盘 auth.json 且权限为 0600", async () => {
	await resetAuth();
	const secret = "ghp_111122223333444455556666777788889999";
	const res = await request(host.port, "/dsh-about/auth", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ token: secret })
	});
	assert.equal(res.status, 200);
	assert.equal(res.json.ok, true);
	assert.equal(res.json.configured, true);

	const onDisk = readAuthFile();
	assert.ok(onDisk, "auth.json 应当已创建");
	assert.equal(onDisk.token, secret, "落盘的应当是完整 token（不回显给界面）");
	assert.equal(res.body.includes(secret), false, "保存回执不得回显明文");

	if (process.platform !== "win32") {
		assert.equal(authFileMode(), 0o600, "auth.json 权限必须是 0600");
	}
});

test("保存后立即生效，无需重启：GET /auth 立刻反映新状态", async () => {
	await resetAuth();
	const secret = "ghp_loader_immediate_effect_token_000";
	await request(host.port, "/dsh-about/auth", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ token: secret })
	});
	const get = await request(host.port, "/dsh-about/auth");
	assert.equal(get.json.configured, true, "同一进程内保存后应立刻生效");
	assert.ok(get.json.masked.length > 0);
});

test("掩码规则：只露前 4 后 4（长 token）；短值只露前 2 位", async () => {
	await resetAuth();
	const long = "ghp_AAAABBBBCCCCDDDDWWWWXXXXYYYYZZZZ";
	let res = await request(host.port, "/dsh-about/auth", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ token: long })
	});
	assert.equal(res.json.masked, `${long.slice(0, 4)}…${long.slice(-4)}`);

	await resetAuth();
	const short = "abc1234567"; // 长度 10 → 走「短值」分支
	res = await request(host.port, "/dsh-about/auth", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ token: short })
	});
	assert.equal(res.json.masked, `${short.slice(0, 2)}…`);
	assert.equal(res.body.includes(short), false);
});

// ───────────── POST /auth：清除 ─────────────

test("POST /auth 传空串清除 token：内存与磁盘同时清空", async () => {
	await resetAuth();
	await request(host.port, "/dsh-about/auth", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ token: "ghp_to_be_removed_0000000000" })
	});
	assert.ok(readAuthFile(), "前置条件：应先有 auth.json");

	const res = await request(host.port, "/dsh-about/auth", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ token: "" })
	});
	assert.equal(res.status, 200);
	assert.equal(res.json.configured, false);
	assert.equal(readAuthFile(), null, "清除后 auth.json 应当被删除");
});

test("前后空白被裁剪后再落盘", async () => {
	await resetAuth();
	const secret = "ghp_trim_me_0000000000000000";
	const res = await request(host.port, "/dsh-about/auth", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ token: `  ${secret}  ` })
	});
	assert.equal(res.status, 200);
	assert.equal(readAuthFile().token, secret, "落盘值不应含首尾空白");
});

// ───────────── 跨进程持久化 ─────────────

test("auth.json 跨进程持久化：新宿主进程启动即从磁盘读到已保存 token", async () => {
	await resetAuth();
	const secret = "ghp_persisted_across_process_0001";
	await request(host.port, "/dsh-about/auth", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ token: secret })
	});
	assert.equal(readAuthFile()?.token, secret, "前置条件：token 已落盘");

	// 真进程边界：模块级 `let githubToken = readGithubToken()` 只在新进程里重新求值，
	// 同进程内再 apply 一次验证不了「重启后还在」，必须另起 node。
	const { execFileSync } = await import("node:child_process");
	const { fileURLToPath } = await import("node:url");
	const probe = fileURLToPath(new URL("./helpers/probe-auth.mjs", import.meta.url));
	const out = execFileSync(process.execPath, [probe], {
		env: { ...process.env, DSH_HOME },
		encoding: "utf8"
	});
	const parsed = JSON.parse(out);
	assert.equal(parsed.status, 200);
	assert.equal(parsed.json.configured, true, "新进程应看到已保存的 token");
	assert.equal(parsed.body.includes(secret), false, "跨进程读取也不得回显明文");
});

test("清除后新进程也读不到 token", async () => {
	await resetAuth();
	await request(host.port, "/dsh-about/auth", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ token: "ghp_remove_then_probe_000000" })
	});
	await request(host.port, "/dsh-about/auth", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ token: "" })
	});

	const { execFileSync } = await import("node:child_process");
	const { fileURLToPath } = await import("node:url");
	const probe = fileURLToPath(new URL("./helpers/probe-auth.mjs", import.meta.url));
	const out = execFileSync(process.execPath, [probe], {
		env: { ...process.env, DSH_HOME, GITHUB_TOKEN: "" },
		encoding: "utf8"
	});
	assert.equal(JSON.parse(out).json.configured, false, "清除对新进程同样生效");
});

// ───────────── 环境变量兜底 ─────────────

test("无 auth.json 但存在 GITHUB_TOKEN 时按环境变量上报 fromEnv", async () => {
	await resetAuth();
	// effectiveGithubToken() 读 process.env，逐次取值，可直接注入
	process.env.GITHUB_TOKEN = "ghp_from_env_0000000000000000";
	try {
		const res = await request(host.port, "/dsh-about/auth");
		assert.equal(res.json.configured, false, "环境变量不算「已配置」（不能通过界面清除）");
		assert.equal(res.json.fromEnv, true);
		assert.ok(res.json.masked.length > 0);
		assert.equal(res.body.includes("ghp_from_env_0000000000000000"), false);
	} finally {
		delete process.env.GITHUB_TOKEN;
	}
});

test("auth.json 优先于 GITHUB_TOKEN 环境变量", async () => {
	await resetAuth();
	process.env.GITHUB_TOKEN = "ghp_env_should_lose_0000000";
	try {
		await request(host.port, "/dsh-about/auth", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ token: "ghp_file_should_win_00000000" })
		});
		const res = await request(host.port, "/dsh-about/auth");
		assert.equal(res.json.configured, true);
		assert.equal(res.json.fromEnv, false, "文件里的 token 生效时不应标记 fromEnv");
	} finally {
		delete process.env.GITHUB_TOKEN;
	}
});

// ───────────── 入站网关防护 ─────────────

test("非 JSON content-type 一律 415", async () => {
	await resetAuth();
	const res = await request(host.port, "/dsh-about/auth", {
		method: "POST",
		headers: { "content-type": "application/x-www-form-urlencoded" },
		body: JSON.stringify({ token: "ghp_x" })
	});
	assert.equal(res.status, 415);
	assert.equal(res.json.ok, false);
});

test("缺少 token 字段 → 400", async () => {
	await resetAuth();
	const res = await request(host.port, "/dsh-about/auth", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ notToken: "x" })
	});
	assert.equal(res.status, 400);
	assert.match(res.json.error, /token/);
});

test("token 字段非字符串 → 400", async () => {
	await resetAuth();
	const res = await request(host.port, "/dsh-about/auth", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ token: 12345 })
	});
	assert.equal(res.status, 400);
});

test("token 超长（>255）→ 400", async () => {
	await resetAuth();
	const res = await request(host.port, "/dsh-about/auth", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ token: "g".repeat(256) })
	});
	assert.equal(res.status, 400);
	assert.match(res.json.error, /不合法|格式/);
});

test("token 含换行 → 400", async () => {
	await resetAuth();
	const res = await request(host.port, "/dsh-about/auth", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ token: "ghp_line1\nline2" })
	});
	assert.equal(res.status, 400);
});

test("非法 JSON 请求体 → 400（而非 500）", async () => {
	await resetAuth();
	const res = await request(host.port, "/dsh-about/auth", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: "{ this is not json"
	});
	assert.equal(res.status, 400);
	assert.equal(res.json.ok, false);
});

test("跨站 Origin 的 POST → 403，且 token 不被写入", async () => {
	await resetAuth();
	const res = await request(host.port, "/dsh-about/auth", {
		method: "POST",
		headers: { "content-type": "application/json", origin: "https://evil.example.com" },
		body: JSON.stringify({ token: "ghp_cross_site_should_be_rejected" })
	});
	assert.equal(res.status, 403);
	assert.equal(readAuthFile(), null, "被拒的跨站请求不得落盘 token");
});

test("回环 Origin 的 POST 被放行", async () => {
	await resetAuth();
	const res = await request(host.port, "/dsh-about/auth", {
		method: "POST",
		headers: {
			"content-type": "application/json",
			origin: `http://127.0.0.1:${host.port}`
		},
		body: JSON.stringify({ token: "ghp_loopback_origin_ok_000000" })
	});
	assert.equal(res.status, 200);
	assert.equal(res.json.configured, true);
});

test("非回环 Host 头 → 403（防 DNS 重绑定）", async () => {
	await resetAuth();
	const res = await request(host.port, "/dsh-about/auth", {
		method: "POST",
		headers: { "content-type": "application/json", host: "attacker.example.com" },
		body: JSON.stringify({ token: "ghp_rebind_should_be_rejected" })
	});
	assert.equal(res.status, 403);
	assert.equal(readAuthFile(), null);
});

test("非回环 Host 的 GET /auth → 403", async () => {
	const res = await request(host.port, "/dsh-about/auth", {
		headers: { host: "attacker.example.com" }
	});
	assert.equal(res.status, 403);
});

test("跨站 GET（Sec-Fetch-Site: cross-site）→ 403", async () => {
	const res = await request(host.port, "/dsh-about/auth", {
		headers: { "sec-fetch-site": "cross-site" }
	});
	assert.equal(res.status, 403);
});

// ───────────── POST /auth-test：配额回显与凭据校验 ─────────────

test("auth-test 用已保存 token 试打 GitHub，回显剩余配额与重置时刻", async () => {
	await resetAuth();
	const secret = "ghp_authtest_saved_000000000000";
	await request(host.port, "/dsh-about/auth", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ token: secret })
	});

	const resetEpoch = Math.floor(Date.now() / 1000) + 900;
	let seenAuth = null;
	stub.setGithub((url, init) => {
		seenAuth = init?.headers?.Authorization ?? init?.headers?.authorization ?? null;
		return githubReleaseResponse({ status: 200, remaining: 4999, limit: 5000, reset: resetEpoch, body: [] })();
	});

	const res = await request(host.port, "/dsh-about/auth-test", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({})
	});
	assert.equal(res.status, 200);
	assert.equal(res.json.ok, true);
	assert.equal(res.json.authenticated, true, "应识别为已认证请求");
	assert.equal(res.json.success, true);
	assert.equal(res.json.limit, 5000);
	assert.equal(res.json.remaining, 4999);
	assert.equal(res.json.resetAt, new Date(resetEpoch * 1000).toISOString());
	assert.equal(res.json.error, null);
	assert.equal(seenAuth, `Bearer ${secret}`, "出站请求应带 Bearer token");
	assert.equal(res.body.includes(secret), false, "auth-test 回执不得回显明文 token");
});

test("auth-test 用界面草稿 token 覆盖已保存值（保存前即可试连）", async () => {
	await resetAuth();
	const draft = "ghp_draft_token_000000000000000";
	let seenAuth = null;
	stub.setGithub((url, init) => {
		seenAuth = init?.headers?.Authorization ?? null;
		return githubReleaseResponse({ status: 200, remaining: 4998, limit: 5000 })();
	});

	const res = await request(host.port, "/dsh-about/auth-test", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ token: draft })
	});
	assert.equal(res.status, 200);
	assert.equal(res.json.authenticated, true);
	assert.equal(seenAuth, `Bearer ${draft}`, "应使用草稿而不是已保存值");
	assert.equal(readAuthFile(), null, "试连不得写盘");
});

test("假 token 被 GitHub 拒绝时报 401 语义（而不是 403 限流）", async () => {
	await resetAuth();
	stub.setGithub((url, init) => {
		const auth = init?.headers?.Authorization ?? "";
		return githubReleaseResponse({
			status: auth === "" ? 403 : 401,
			remaining: 60,
			limit: 60,
			body: { message: auth === "" ? "rate limited" : "Bad credentials" }
		})();
	});

	// 未带 token：403 限流
	let res = await request(host.port, "/dsh-about/auth-test", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({})
	});
	assert.equal(res.json.authenticated, false);
	assert.equal(res.json.success, false);
	assert.equal(res.json.status, 403);
	assert.match(res.json.error, /配额|限流|拒绝/);

	// 带假 token：401 凭据无效
	res = await request(host.port, "/dsh-about/auth-test", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ token: "ghp_fake_token_value_000000000" })
	});
	assert.equal(res.json.authenticated, true);
	assert.equal(res.json.status, 401);
	assert.match(res.json.error, /无效|过期/);
});

test("auth-test 网络异常时返回结构化失败（不抛 500）", async () => {
	await resetAuth();
	stub.setGithub(() => {
		throw new Error("network down");
	});
	const res = await request(host.port, "/dsh-about/auth-test", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ token: "ghp_network_error_0000000000" })
	});
	assert.equal(res.status, 200);
	assert.equal(res.json.ok, true, "外站失败也应回 200 + ok:true，由 success=false 表达结果");
	assert.equal(res.json.success, false);
	assert.match(String(res.json.error), /network down/);
});

test("auth-test 拒绝非 JSON content-type（415）", async () => {
	const res = await request(host.port, "/dsh-about/auth-test", {
		method: "POST",
		headers: { "content-type": "text/plain" },
		body: "{}"
	});
	assert.equal(res.status, 415);
});

test("auth-test 拒绝跨站 Origin（403）", async () => {
	const res = await request(host.port, "/dsh-about/auth-test", {
		method: "POST",
		headers: { "content-type": "application/json", origin: "https://evil.example.com" },
		body: JSON.stringify({ token: "ghp_x" })
	});
	assert.equal(res.status, 403);
});

test("auth-test 的 token 超长 / 含换行 → 400", async () => {
	let res = await request(host.port, "/dsh-about/auth-test", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ token: "g".repeat(256) })
	});
	assert.equal(res.status, 400);

	res = await request(host.port, "/dsh-about/auth-test", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ token: "a\nb" })
	});
	assert.equal(res.status, 400);
});

// ───────────── 与 /releases 的联动：token 真的用在了出站请求上 ─────────────

test("配置 token 后 /releases 的出站请求带上 Authorization 并恢复成功", async () => {
	await resetAuth();
	stub.setGithub((url, init) => {
		const auth = init?.headers?.Authorization ?? init?.headers?.authorization ?? "";
		if (auth === "") {
			return githubReleaseResponse({ status: 403, remaining: 0, limit: 60 })();
		}
		return githubReleaseResponse({
			status: 200,
			remaining: 4999,
			limit: 5000,
			body: [{ tag_name: "v9.9.9", name: "v9.9.9", published_at: "2026-01-01T00:00:00Z", prerelease: false, body: "" }]
		})();
	});

	// 未配置：匿名 403 → 界面文案「获取版本更新失败」
	let res = await request(host.port, "/dsh-about/releases?force=1");
	assert.equal(res.json.ok, false);
	assert.match(res.json.error, /403/);

	// 配置后：带 Bearer → 200
	await request(host.port, "/dsh-about/auth", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ token: "ghp_fixes_releases_000000000" })
	});
	res = await request(host.port, "/dsh-about/releases?force=1");
	assert.equal(res.json.ok, true, "配置 token 后应恢复正常拉取");
	assert.ok(Array.isArray(res.json.releases) && res.json.releases.length >= 1);

	const lastGithubCall = stub.githubCalls().at(-1);
	assert.equal(
		lastGithubCall.init.headers.Authorization,
		"Bearer ghp_fixes_releases_000000000",
		"releases 出站请求必须携带 Authorization"
	);
});
