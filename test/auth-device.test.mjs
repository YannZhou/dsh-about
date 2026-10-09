// 「在线认证」（GitHub 设备码授权）的集成测试。
//
// 覆盖三段：发起（start）→ 轮询（poll，含宿主自身节流）→ 落地（token 写入同一个 auth.json）。
// 出站 fetch 全部替换为进程内 stub，不访问外网；两个 6 秒的用例专门验证节流窗口是真的生效。
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { AUTH_FILE, readAuthFile, cleanup } from "./helpers/env.mjs";
import { importHost, startHost, request, installFetchStub, deviceCodeResponse, deviceTokenResponse, npmPackumentResponse } from "./helpers/host.mjs";

const mod = await importHost();
const host = await startHost(mod);
const stub = installFetchStub();
stub.setRegistry(npmPackumentResponse());

const CLIENT_ID = "Iv1_test_client_id_00000000";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test.after(async () => {
	await host.close();
	stub.restore();
	cleanup();
});

/** 每个用例从干净状态开始：清掉宿主侧尝试 + 清掉磁盘上的 token。 */
test.beforeEach(async () => {
	await request(host.port, "/dsh-about/auth-device/cancel", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({})
	});
	fs.rmSync(AUTH_FILE, { force: true });
	delete process.env.DSH_ABOUT_GITHUB_CLIENT_ID;
});

const post = (path, body = {}) =>
	request(host.port, path, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body)
	});

const start = () => post("/dsh-about/auth-device/start");
const poll = () => post("/dsh-about/auth-device/poll");

// ───────────── start ─────────────

test("未配置 client_id 时 start 回 NO_CLIENT_ID 与注册入口，而不是报错", async () => {
	process.env.DSH_ABOUT_GITHUB_CLIENT_ID = ""; // 显式置空：压掉发布包里的默认值
	const res = await start();
	assert.equal(res.status, 200);
	assert.equal(res.json.ok, false);
	assert.equal(res.json.code, "NO_CLIENT_ID");
	assert.match(res.json.error, /client_id/);
	assert.equal(res.json.setupUrl, "https://github.com/settings/applications/new");
});

test("/auth 的 deviceAvailable 反映是否配了 client_id", async () => {
	process.env.DSH_ABOUT_GITHUB_CLIENT_ID = ""; // 先显式置空，再验「配了没有」
	let res = await request(host.port, "/dsh-about/auth");
	assert.equal(res.json.deviceAvailable, false);

	process.env.DSH_ABOUT_GITHUB_CLIENT_ID = CLIENT_ID;
	res = await request(host.port, "/dsh-about/auth");
	assert.equal(res.json.deviceAvailable, true);
});

test("出厂默认：未设 env 时用的是源码里烧入的 client_id", async () => {
	delete process.env.DSH_ABOUT_GITHUB_CLIENT_ID;
	const res = await request(host.port, "/dsh-about/auth");
	assert.equal(res.json.deviceAvailable, true, "发布包必须带一个可用的默认 client_id");
});

test("配置后 start 返回一次性码与验证页地址", async () => {
	process.env.DSH_ABOUT_GITHUB_CLIENT_ID = CLIENT_ID;
	stub.setDeviceCode(deviceCodeResponse({ userCode: "ABCD-1234", expiresIn: 900, interval: 5 }));

	const res = await start();
	assert.equal(res.status, 200);
	assert.equal(res.json.ok, true);
	assert.equal(res.json.userCode, "ABCD-1234");
	assert.equal(res.json.verificationUri, "https://github.com/login/device");
	assert.equal(res.json.expiresIn, 900);
	assert.ok(res.json.intervalMs >= 5000, "轮询间隔不得低于 GitHub 要求的 5s");
});

test("start 的请求体带 client_id 且不请求任何 scope（公开仓库只读）", async () => {
	process.env.DSH_ABOUT_GITHUB_CLIENT_ID = CLIENT_ID;
	stub.setDeviceCode(deviceCodeResponse());
	await start();

	const call = stub.deviceCodeCalls().at(-1);
	const body = String(call.init.body);
	assert.match(body, new RegExp(`client_id=${CLIENT_ID}`));
	assert.equal(body.includes("scope"), false, "不应请求任何 scope");
	assert.equal(call.init.method, "POST");
});

test("device_code 绝不下发到前端（响应体里不含它）", async () => {
	process.env.DSH_ABOUT_GITHUB_CLIENT_ID = CLIENT_ID;
	stub.setDeviceCode(deviceCodeResponse({ deviceCode: "super-secret-device-code" }));

	const res = await start();
	assert.equal(res.body.includes("super-secret-device-code"), false, "device_code 应留在宿主内存");
	assert.equal(res.body.includes("device_code"), false);
});

test("连点 start 复用同一次尝试，不会向 GitHub 再要一个码", async () => {
	process.env.DSH_ABOUT_GITHUB_CLIENT_ID = CLIENT_ID;
	stub.setDeviceCode(deviceCodeResponse({ userCode: "SAME-CODE" }));

	const first = await start();
	const before = stub.deviceCodeCalls().length;
	const second = await start();
	assert.equal(second.json.userCode, first.json.userCode);
	assert.equal(stub.deviceCodeCalls().length, before, "第二次 start 不应再打 GitHub");
});

test("GitHub 拒绝设备码请求（404 Not Found = client_id 无效或没开通 Device Flow）翻译成人话", async () => {
	process.env.DSH_ABOUT_GITHUB_CLIENT_ID = "bad_client_id";
	stub.setDeviceCode(deviceCodeResponse({ status: 404, body: { error: "Not Found" } }));

	const res = await start();
	assert.equal(res.json.ok, false);
	assert.equal(res.json.code, "BAD_CLIENT_ID");
	assert.match(res.json.error, /Not Found/);
});

// ───────────── poll ─────────────

test("poll：authorization_pending 保持等待", async () => {
	process.env.DSH_ABOUT_GITHUB_CLIENT_ID = CLIENT_ID;
	stub.setDeviceCode(deviceCodeResponse({ userCode: "WAIT-CODE" }));
	await start();
	stub.setDeviceToken(deviceTokenResponse({ error: "authorization_pending" }));

	const res = await poll();
	assert.equal(res.json.ok, true);
	assert.equal(res.json.state, "pending");
	assert.equal(res.json.userCode, "WAIT-CODE");
});

test("poll：授权成功后 token 落盘 0600 并立即生效", async () => {
	process.env.DSH_ABOUT_GITHUB_CLIENT_ID = CLIENT_ID;
	stub.setDeviceCode(deviceCodeResponse());
	await start();
	const token = "gho_devicelowsuccess0000000000000000";
	stub.setDeviceToken(deviceTokenResponse({ token }));

	const res = await poll();
	assert.equal(res.json.state, "authorized");
	assert.equal(res.json.configured, true);
	assert.equal(res.body.includes(token), false, "响应不得回显明文 token");

	// 与「自定义」保存走同一条落地路径
	assert.equal(readAuthFile()?.token, token);
	if (process.platform !== "win32") {
		assert.equal(fs.statSync(AUTH_FILE).mode & 0o777, 0o600);
	}
	const status = await request(host.port, "/dsh-about/auth");
	assert.equal(status.json.configured, true);
	assert.ok(status.json.masked.length > 0);
});

test("poll：access_denied 记为「用户取消」而非故障", async () => {
	process.env.DSH_ABOUT_GITHUB_CLIENT_ID = CLIENT_ID;
	stub.setDeviceCode(deviceCodeResponse());
	await start();
	stub.setDeviceToken(deviceTokenResponse({ error: "access_denied" }));

	const res = await poll();
	assert.equal(res.json.state, "denied");
	assert.equal(readAuthFile(), null, "拒绝授权不应写入任何 token");
});

test("poll：expired_token 记为过期", async () => {
	process.env.DSH_ABOUT_GITHUB_CLIENT_ID = CLIENT_ID;
	stub.setDeviceCode(deviceCodeResponse());
	await start();
	stub.setDeviceToken(deviceTokenResponse({ error: "expired_token" }));

	const res = await poll();
	assert.equal(res.json.state, "expired");
});

test("poll：网络异常不中断授权（保持 pending，而不是报错态）", async () => {
	process.env.DSH_ABOUT_GITHUB_CLIENT_ID = CLIENT_ID;
	stub.setDeviceCode(deviceCodeResponse());
	await start();
	stub.setDeviceToken(() => {
		throw new Error("network down");
	});

	const res = await poll();
	assert.equal(res.json.state, "pending", "单次网络抖动应继续等待");
	assert.match(String(res.json.error), /network down/);
});

test("poll：GitHub 返回非 JSON 时保持等待", async () => {
	process.env.DSH_ABOUT_GITHUB_CLIENT_ID = CLIENT_ID;
	stub.setDeviceCode(deviceCodeResponse());
	await start();
	stub.setDeviceToken(() => new Response("<html>oops</html>", { status: 200, headers: { "content-type": "text/html" } }));

	const res = await poll();
	assert.equal(res.json.state, "pending");
	assert.match(String(res.json.error), /非 JSON/);
});

test("poll：没有进行中的尝试时回 idle", async () => {
	await post("/dsh-about/auth-device/cancel");
	const res = await poll();
	assert.equal(res.json.ok, true);
	assert.equal(res.json.state, "idle");
});

test("cancel 之后 poll 回 idle，且不再打 GitHub", async () => {
	process.env.DSH_ABOUT_GITHUB_CLIENT_ID = CLIENT_ID;
	stub.setDeviceCode(deviceCodeResponse());
	await start();

	const res = await post("/dsh-about/auth-device/cancel");
	assert.equal(res.json.ok, true);
	assert.equal(res.json.canceled, true);

	const after = await poll();
	assert.equal(after.json.state, "idle");
});

// ───────────── 宿主侧节流（真等 6 秒，验证窗口确实生效） ─────────────

test("节流：同一间隔内连续 poll 不重复打扰 GitHub", async () => {
	process.env.DSH_ABOUT_GITHUB_CLIENT_ID = CLIENT_ID;
	stub.setDeviceCode(deviceCodeResponse({ interval: 5 }));
	await start();
	stub.setDeviceToken(deviceTokenResponse({ error: "authorization_pending" }));

	// 注意：stub 的调用记录是整个测试文件累积的，必须用相对基线计数
	const beforeFirst = stub.deviceTokenCalls().length;
	await poll(); // 第一次：真的打 GitHub
	assert.equal(stub.deviceTokenCalls().length, beforeFirst + 1);

	await poll(); // 立刻再问：应被宿主挡下
	await poll();
	assert.equal(stub.deviceTokenCalls().length, beforeFirst + 1, "间隔内不应再打 GitHub（否则会触发 slow_down）");
});

test("节流：超过间隔后确实会再问 GitHub", async () => {
	process.env.DSH_ABOUT_GITHUB_CLIENT_ID = CLIENT_ID;
	stub.setDeviceCode(deviceCodeResponse({ interval: 5 }));
	await start();
	stub.setDeviceToken(deviceTokenResponse({ error: "authorization_pending" }));

	await poll();
	const before = stub.deviceTokenCalls().length;
	await sleep(5700); // intervalMs = 5s + 0.5s 余量
	await poll();
	assert.ok(stub.deviceTokenCalls().length > before, "过了间隔就应继续轮询");
});

test("slow_down 会把间隔再加 5s：过了原间隔仍不打扰 GitHub", async () => {
	process.env.DSH_ABOUT_GITHUB_CLIENT_ID = CLIENT_ID;
	stub.setDeviceCode(deviceCodeResponse({ interval: 5 }));
	await start();
	stub.setDeviceToken(deviceTokenResponse({ error: "slow_down" }));

	const first = await poll();
	assert.equal(first.json.state, "pending", "slow_down 对用户仍是等待");
	const before = stub.deviceTokenCalls().length;

	await sleep(5700); // 原间隔已过，但 slow_down 后应变成 10.5s
	await poll();
	assert.equal(stub.deviceTokenCalls().length, before, "slow_down 后间隔应变长，不应在原间隔就再问");
});

// ───────────── 入站防护（与 /auth 同级） ─────────────

test("跨站 Origin → 403", async () => {
	const res = await request(host.port, "/dsh-about/auth-device/start", {
		method: "POST",
		headers: { "content-type": "application/json", origin: "https://evil.example.com" },
		body: "{}"
	});
	assert.equal(res.status, 403);
});

test("非回环 Host → 403（防 DNS 重绑定）", async () => {
	const res = await request(host.port, "/dsh-about/auth-device/poll", {
		method: "POST",
		headers: { "content-type": "application/json", host: "attacker.example.com" },
		body: "{}"
	});
	assert.equal(res.status, 403);
});

test("非 JSON content-type → 415", async () => {
	const res = await request(host.port, "/dsh-about/auth-device/start", {
		method: "POST",
		headers: { "content-type": "text/plain" },
		body: "{}"
	});
	assert.equal(res.status, 415);
});

test("未知子路径不会命中 auth-device 处理逻辑", async () => {
	process.env.DSH_ABOUT_GITHUB_CLIENT_ID = CLIENT_ID;
	const res = await post("/dsh-about/auth-device/bogus");
	assert.equal(res.status, 404, "未识别的动作应落到 404");
});
