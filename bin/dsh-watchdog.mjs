#!/usr/bin/env node
// dsh-watchdog — DeepSeek Harness web 后台服务「一次性」看护（跨平台 Node 版）。
//
// 作用（与 bin/dsh-watchdog 的 once 子命令等价，但纯 Node 实现）：
//   node 是 dsh 运行时必有依赖，故本脚本在 Linux / macOS / Windows 三平台
//   零新增依赖即可运行，供 dsh-about「一键更新 → 自动重启」链路的宿主侧调度：
//   「当检测到 dsh web 后台服务关闭时，计时 3 秒，然后重新拉起后台服务
//    （--no-open，不自动打开浏览器）；用户只需刷新当前页面即可恢复使用。」
//
// 子命令：
//   once    — 一次性看护：等宿主(旧 dsh)退出 → 数秒 → 拉起 → 端口就绪即自动退出
//   check   — 只检查一次当前状态并退出（诊断用）
//   无参数  — 打印用法（本文件不做常驻；常驻请用 bin/dsh-watchdog bash 版）
//
// 与 bash 版的分工：
//   bin/dsh-watchdog（bash）保留「常驻主循环 + systemd 用户服务 + 崩溃退避」的
//   高级 Linux 场景；本文件只实现「一次性重启」最小核心，三平台通用。
//   决策日志与 bash 版共用 $DSH_HOME/dsh-watchdog.log，互不冲突。
//
// 移植自 bash once_main / start_service（语义对齐），阶段：
//   阶段0   等宿主 PID 退出（HOST_WAIT 上限；Linux 用 /proc/<pid>/stat 的
//           starttime 做 PID 复用防护，非 Linux 退回 ps 启动时刻指纹，尽力而为）
//   阶段0.5 等端口“掉下来”（≤15s，避开 TIME_WAIT / 关闭竞态误判）
//   阶段1   数 COUNTDOWN 秒 → 复查 → 拉起（优先 systemd；本进程在 transient
//           单元内则用独立 transient 单元裸拉起，避免 cgroup 清理连带；否则
//           detached 裸 spawn——macOS/Windows 兜底）→ 等端口就绪 → 自动退出
// 任一阶段到上限都记日志退出，绝不静默长驻。
import { connect } from "node:net";
import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, openSync, writeFileSync, rmSync, readFileSync, closeSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const env = process.env;
const isWin = process.platform === "win32";
const isLinux = process.platform === "linux";

// ----------------------------- 可变运行参数 ----------------------------------
// （非 const：允许命令行 --port/--unit/--pid 覆盖，诊断/手工使用）
let homeDir = env.DSH_HOME || path.join(os.homedir(), ".dsh");
let PORT = Number(env.DSH_WATCH_PORT || 3080);
let UNIT = env.DSH_WATCH_UNIT || "dsh-web";
let pid = Number(env.DSH_WATCH_PID || 0);

const COUNTDOWN = Number(env.DSH_WATCH_COUNTDOWN || 3);
const POLL = Number(env.DSH_WATCH_POLL || 2);
const START_TIMEOUT = Number(env.DSH_WATCH_START_TIMEOUT || 45);
const HOST_WAIT = Number(env.DSH_WATCH_HOST_WAIT || 180);
const MAX_RUNTIME = Number(env.DSH_WATCH_MAX_RUNTIME || 600);
const NO_SYSTEMD = env.DSH_WATCH_NO_SYSTEMD === "1";
const IN_TRANSIENT = env.DSH_WATCH_IN_TRANSIENT === "1";
const LOG = env.DSH_WATCH_LOG || path.join(homeDir, "dsh-watchdog.log");
const LOCKFILE = env.DSH_WATCH_LOCK || path.join(homeDir, ".dsh-watchdog-once.lock");

// 裸拉起命令：优先 JSON argv 数组（宿主侧传入，无 shell 注入面）；兼容旧 shell 串。
let RAW_ARGV = null;
try {
	const parsed = JSON.parse(env.DSH_WATCH_ARGV || "null");
	if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] === "string") RAW_ARGV = parsed;
} catch { /* 非法 JSON → 退回 shell 串 */ }
const RAW_CMD_STR = env.DSH_WATCH_RAW_CMD || env.DSH_WATCH_START_CMD || "";

try { mkdirSync(path.dirname(LOG), { recursive: true }); } catch { /* 忽略 */ }
try { mkdirSync(homeDir, { recursive: true }); } catch { /* 忽略 */ }

// ----------------------------- 基础工具 --------------------------------------
function ts() {
	const d = new Date();
	const p = (n) => String(n).padStart(2, "0");
	return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
function log(kind, msg) {
	try { appendFileSync(LOG, `${ts()} [${kind}] ${msg}\n`); } catch { /* 写不进就静默 */ }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function hasBin(cmd) {
	if (isWin) return spawnSync("where", [cmd], { stdio: "ignore", shell: true }).status === 0;
	// 用 `command -v` 而非 `which`：极简 Linux 容器/系统可能未装 which（debianutils
	// 成员），而 command -v 是 POSIX 内建、恒可用。
	return spawnSync("sh", ["-c", `command -v ${cmd} >/dev/null 2>&1`]).status === 0;
}
const HAS_SYSTEMCTL = !NO_SYSTEMD && !isWin && hasBin("systemctl");
const HAS_SYSTEMD_RUN = !NO_SYSTEMD && !isWin && hasBin("systemd-run");

// ----------------------------- 健康检查 --------------------------------------
// 端口可用：能建立 TCP 连接即算“在线”（与 bash 的 /dev/tcp 探测一致，
// 不需要 curl；HTTP 语义由拉起后的真实服务保证）。
function portUp(port) {
	return new Promise((resolve) => {
		const sock = connect({ host: "127.0.0.1", port: port || PORT });
		let done = false;
		const finish = (ok) => {
			if (done) return;
			done = true;
			sock.destroy();
			resolve(ok);
		};
		sock.setTimeout(2000);
		sock.once("connect", () => finish(true));
		sock.once("timeout", () => finish(false));
		sock.once("error", () => finish(false));
	});
}

// ----------------------------- 进程存活 / PID 复用防护 -----------------------
// Linux：/proc/<pid>/stat 的 starttime（field 22，comm 可能含空格/括号，先掐掉）。
// 非 Linux：ps -o lstart= 取启动时刻字符串作指纹（尽力而为）。
function procFingerprint(pidNum) {
	if (isLinux) {
		try {
			const stat = readFileSync(`/proc/${pidNum}/stat`, "utf8");
			// comm 可能含空格/括号：用最后一个 ")" 作为 (comm) 的边界（内核会把 comm
			// 括进一对括号，含 ")" 的命令名不会转义，故只能取 lastIndexOf）。
			const rest = stat.slice(stat.lastIndexOf(")") + 2).trim();
			// rest 从 field 3（state）开始，字段22 = starttime → 0 基索引 19。
			// 取错索引会落到 rss 等运行期变化字段，导致 PID 指纹不稳定。
			return rest.split(/\s+/)[19] ?? null; // field 22 = starttime
		} catch {
			return null;
		}
	}
	try {
		const r = spawnSync("ps", ["-o", "lstart=", "-p", String(pidNum)], { stdio: ["ignore", "pipe", "ignore"] });
		const s = String(r.stdout || "").trim();
		return s === "" ? null : s;
	} catch {
		return null;
	}
}

// 进程是否存活：kill(pid,0) 抛 ESRCH = 已退出。expectedFp 传入时，
// 指纹读得到且与期望不符 → PID 已被复用，视为“原进程已退出”。
function pidAlive(pidNum, expectedFp) {
	if (!pidNum || pidNum <= 0) return false;
	try {
		process.kill(pidNum, 0);
	} catch {
		return false;
	}
	if (expectedFp === undefined || expectedFp === null) return true; // 无指纹可用
	const fp = procFingerprint(pidNum);
	if (fp === null) return true; // 读不到指纹（权限等）→ 保守判定存活
	return fp === expectedFp;
}

// systemd 单元状态：active / activating / inactive / failed / unknown / nosystemd
function unitState(unit) {
	if (!HAS_SYSTEMCTL) return "nosystemd";
	try {
		const r = spawnSync("systemctl", ["--user", "is-active", unit || UNIT], { stdio: ["ignore", "pipe", "ignore"] });
		const st = String(r.stdout || "").trim();
		return st === "" ? "unknown" : st;
	} catch {
		return "unknown";
	}
}

// ----------------------------- 拉起服务 --------------------------------------
function describeRaw() {
	if (RAW_ARGV) return RAW_ARGV.join(" ");
	if (RAW_CMD_STR) return RAW_CMD_STR;
	return "(no start command provided)";
}

// detached 裸 spawn（macOS/Windows / 无 systemd 的 Linux 兜底）。返回是否已派发。
function spawnRawDetached() {
	let argv = null;
	if (RAW_ARGV && RAW_ARGV.length > 0) argv = RAW_ARGV;
	else if (RAW_CMD_STR) argv = ["/bin/sh", "-c", RAW_CMD_STR];
	if (!argv) {
		log("warn", "no raw launch command (DSH_WATCH_ARGV/DSH_WATCH_RAW_CMD missing)");
		return false;
	}
	const [cmd, ...rest] = argv;
	try {
		const child = spawn(cmd, rest, {
			cwd: homeDir,
			detached: true,
			stdio: "ignore",
			env: process.env
		});
		child.on("error", () => {});
		child.unref();
		return true;
	} catch {
		log("warn", `raw launch spawn failed: ${cmd}`);
		return false;
	}
}

// 分层拉起（返回是否已发出启动请求）：
//   1) systemd 可用且单元已知：restart / reset-failed+start；
//   2) 本进程在 transient 单元内（更新场景由 systemd-run 派发）→ 裸拉起必须再
//      包一层独立 transient 单元，否则 once 退出时 cgroup 清理会连带杀掉新 dsh；
//   3) 否则 detached 裸 spawn。
function startService(port, unit) {
	const st = unitState(unit);
	if (HAS_SYSTEMCTL) {
		if (st === "active") {
			log("warn", `unit=${st} but port ${port} down (process likely hung); systemctl restart ${unit}`);
			return spawnSync("systemctl", ["--user", "restart", unit], { stdio: "ignore" }).status === 0;
		}
		if (st === "activating") {
			log("info", `unit=${st}, systemd is auto-restarting; stand by`);
			return false;
		}
		if (st === "inactive" || st === "failed") {
			log("info", `start via systemd: reset-failed + start ${unit}`);
			spawnSync("systemctl", ["--user", "reset-failed", unit], { stdio: "ignore" });
			const r = spawnSync("systemctl", ["--user", "start", unit], { stdio: "ignore" });
			if (r.status === 0) {
				log("info", `systemd start issued: ${unit}`);
				return true;
			}
			log("warn", `systemd start ${unit} failed -> raw launch fallback`);
			// 落入下方裸拉起
		} else if (st !== "nosystemd" && st !== "unknown") {
			log("warn", `unhandled unit state: ${st}`);
		}
	}
	if (IN_TRANSIENT && HAS_SYSTEMD_RUN) {
		// 用独立 transient 单元启动裸命令（避免 once 退出时被 cgroup 清理连带）
		const rawUnit = `dsh-web-raw-${Math.floor(Date.now() / 1000)}`;
		const args = ["--user", "--collect", `--unit=${rawUnit}`, `--setenv=PATH=${process.env.PATH || "/usr/local/bin:/usr/bin:/bin"}`];
		let r;
		if (RAW_ARGV && RAW_ARGV.length > 0) {
			// systemd-run [flags] <cmd> [args...]：RAW_ARGV 首元素是命令
			r = spawnSync("systemd-run", [...args, ...RAW_ARGV], { stdio: "ignore", timeout: 15000 });
		} else if (RAW_CMD_STR) {
			r = spawnSync("systemd-run", [...args, "/usr/bin/bash", "-c", `cd "${homeDir}" && exec ${RAW_CMD_STR}`], { stdio: "ignore", timeout: 15000 });
		} else {
			r = { status: 1 };
		}
		if (r.status === 0) {
			log("info", `raw launch via systemd-run (unit=${rawUnit})`);
			return true;
		}
		log("warn", "systemd-run raw launch failed -> detached fallback");
		// 落入 detached 兜底
	}
	log("info", `raw launch: ${describeRaw()}`);
	const ok = spawnRawDetached();
	if (ok) log("info", "raw launch issued (detached process)");
	return ok;
}

// ----------------------------- once：更新时的一次性看护 ----------------------
// 加锁：并发 only-one（同 bash 的 .dsh-watchdog-once.lock 意图）
function tryOnceLock() {
	try {
		const fd = openSync(LOCKFILE, "wx");
		writeFileSync(fd, String(process.pid));
		return () => {
			try { closeSync(fd); } catch { /* 忽略 */ }
			try { rmSync(LOCKFILE, { force: true }); } catch { /* 忽略 */ }
		};
	} catch {
		return null; // 已有实例在跑
	}
}

async function onceMain() {
	const release = tryOnceLock();
	if (!release) {
		log("warn", `[once] another watchdog once already running (lock=${LOCKFILE}); exiting`);
		process.exit(0);
	}
	const deadline = Date.now() + MAX_RUNTIME * 1000;
	log("info", `[once] pid=${pid} port=${PORT} unit=${UNIT} raw=${describeRaw()}`);
	log("info", "[once] will wait for host exit, relaunch, then exit automatically");

	// ── 阶段 0：等宿主退出（最多 HOST_WAIT 秒）──
	if (pid > 0) {
		const fp = procFingerprint(pid);
		let waited = 0;
		let portDownSec = 0;
		while (waited < HOST_WAIT) {
			if (!pidAlive(pid, fp)) break; // 宿主已退出（含 PID 复用被判出）
			// 兜底：宿主 PID 可能被复用（非 Linux 无精确指纹）→ 若端口已持续掉
			// 线 5s，说明旧服务已让出，继续等只会白屏，提前进入拉起流程。
			if (!(await portUp(PORT))) {
				portDownSec += 1;
				if (portDownSec >= 5) break;
			} else {
				portDownSec = 0;
			}
			await sleep(1000);
			waited += 1;
		}
		if (pidAlive(pid, fp)) {
			// 若我们因“端口掉 5s”跳出，这里 pid 可能仍活着但已判定让出 → 放行
			if (portDownSec < 5) {
				log("warn", `[once] host pid ${pid} still alive after ${HOST_WAIT}s (update cancelled?); exiting without action`);
				release();
				process.exit(0);
			}
			log("info", `[once] host pid ${pid} may be reused/absent; port down ${portDownSec}s, proceeding`);
		} else {
			log("info", `[once] host pid ${pid} exited`);
		}
	}

	// ── 阶段 0.5：等端口“掉下来”（≤15s）──
	// 宿主刚退出时旧 socket 可能仍在收尾；若 15s 端口始终不掉，
	// 说明已有新实例/systemd 在服务 → 判定完成。
	let settled = 0;
	while (settled < 15) {
		if (!(await portUp(PORT))) break;
		await sleep(1000);
		settled += 1;
	}
	if (settled >= 15) {
		log("info", `[once] port stayed up ${settled}s after host exit (a replacement may already be serving); exiting`);
		release();
		process.exit(0);
	}

	// ── 阶段 1：数秒 → 拉起 → 端口就绪即退出；最长跑到 deadline ──
	// 护栏：unit 为 active/activating 时 systemd 正管理该单元（可能刚被自动重启
	// 仍在绑定），此时绝不 restart——只轮询等端口；真正需要拉起仅当单元处于
	// inactive/failed/nosystemd/unknown（systemd 不归我们管或已停）。
	let countdownDone = false;
	let fails = 0;
	let activatingSince = 0;
	while (Date.now() < deadline) {
		if (await portUp(PORT)) {
			log("info", `[once] service is UP on port ${PORT}; one-shot done, exiting`);
			break;
		}
		const st = unitState(UNIT);
		if (st === "active") {
			// systemd 单元活着但端口没起（可能仍在启动）→ 让 systemd 自己处理，
			// 只轮询，不 restart 活跃实例（避免误伤）。
			await sleep(2000);
			continue;
		}
		if (st === "activating") {
			if (activatingSince === 0) activatingSince = Date.now();
			if (Date.now() - activatingSince > 60 * 1000) {
				log("warn", `[once] unit stuck in auto-restart >60s; forcing reset-failed + start ${UNIT}`);
				if (HAS_SYSTEMCTL) {
					spawnSync("systemctl", ["--user", "reset-failed", UNIT], { stdio: "ignore" });
					spawnSync("systemctl", ["--user", "start", UNIT], { stdio: "ignore" });
				}
				activatingSince = 0;
			}
			await sleep(2000);
			continue;
		}
		activatingSince = 0;
		if (!countdownDone) {
			log("warn", `[once] service down; counting ${COUNTDOWN}s before relaunch`);
			countdownDone = true;
			await sleep(COUNTDOWN * 1000);
			continue;
		}
		if (fails > 0) {
			const backoff = Math.min(300, 3 * 2 ** (fails - 1));
			log("warn", `[once] backing off ${backoff}s (fails=${fails})`);
			await sleep(backoff * 1000);
		}
		if (await portUp(PORT)) {
			log("info", `[once] service is UP on port ${PORT}; one-shot done, exiting`);
			break;
		}
		const t0 = Date.now();
		if (startService(PORT, UNIT)) {
			log("info", `[once] waiting for port ${PORT} to come up...`);
			let ready = false;
			while (Date.now() - t0 < START_TIMEOUT * 1000) {
				if (await portUp(PORT)) { ready = true; break; }
				await sleep(1000);
			}
			if (ready) {
				log("info", `[once] service relaunched OK, port ${PORT} ready (${Math.round((Date.now() - t0) / 1000)}s); one-shot done, exiting`);
				break;
			}
			fails += 1;
			log("warn", `[once] start not ready in ${START_TIMEOUT}s (fails=${fails})`);
		} else {
			fails += 1;
			log("warn", `[once] no start issued this round (fails=${fails})`);
		}
	}
	if (Date.now() >= deadline) {
		log("warn", `[once] gave up after ${MAX_RUNTIME}s; manual restart may be needed`);
		release();
		process.exit(1);
	}
	release();
	process.exit(0);
}

// ----------------------------- 入口分发 --------------------------------------
async function main() {
	const args = process.argv.slice(2);
	for (let i = 0; i < args.length; i++) {
		const a = args[i];
		if (a === "--pid") pid = Number(args[i + 1] ?? pid);
		else if (a === "--port") PORT = Number(args[i + 1] ?? PORT);
		else if (a === "--unit") UNIT = args[i + 1] ?? UNIT;
	}
	const cmd = args.find((a) => !a.startsWith("--")) || "";
	if (cmd === "check") {
		const up = await portUp(PORT);
		console.log(up ? `UP: dsh web serving on port ${PORT} (unit=${unitState(UNIT)})` : `DOWN: port ${PORT} not responding (unit=${unitState(UNIT)})`);
		process.exit(up ? 0 : 1);
	}
	if (cmd === "once") {
		await onceMain(); // onceMain 内部自行 process.exit
		return;
	}
	console.error("usage: dsh-watchdog.mjs [once|check]  (常驻看护请用 bin/dsh-watchdog bash 版)");
	process.exit(2);
}

main().catch((err) => {
	log("error", `unhandled: ${err instanceof Error ? err.stack : String(err)}`);
	process.exit(1);
});
