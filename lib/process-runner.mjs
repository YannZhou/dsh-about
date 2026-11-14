import fs from "node:fs";
import { spawn, spawnSync } from "node:child_process";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Ignore zombies: they can no longer write, but kill(-pgid, 0) still finds them.
export function processGroupAlive(pid) {
	if (!Number.isInteger(pid) || pid <= 0) return false;
	if (process.platform === "linux") {
		try {
			for (const entry of fs.readdirSync("/proc")) {
				if (!/^\d+$/.test(entry)) continue;
				let raw;
				try { raw = fs.readFileSync(`/proc/${entry}/stat`, "utf8"); } catch { continue; }
				const fields = raw.slice(raw.lastIndexOf(")") + 2).split(" ");
				if (Number(fields[2]) === pid && fields[0] !== "Z" && fields[0] !== "X") return true;
			}
			return false;
		} catch { /* Other POSIX systems use the process-group probe. */ }
	}
	try { process.kill(-pid, 0); return true; } catch (error) { return error.code !== "ESRCH"; }
}

async function waitUntilStopped(pid, duration) {
	const deadline = Date.now() + duration;
	do {
		if (!processGroupAlive(pid)) return true;
		await sleep(40);
	} while (Date.now() < deadline);
	return !processGroupAlive(pid);
}

export function transientUnitStopped(unit, systemctl = "systemctl") {
	const result = spawnSync(systemctl, ["--user", "show", "--property=ActiveState", "--property=LoadState", `${unit}.service`], { encoding: "utf8", timeout: 4000, windowsHide: true });
	const output = result.stdout || "";
	return /^(?:ActiveState=(?:inactive|failed)|LoadState=not-found)$/m.test(output);
}

async function stopTransientUnit(unit, timeoutMs, systemctl) {
	const stop = spawnSync(systemctl, ["--user", "stop", `${unit}.service`], { encoding: "utf8", timeout: timeoutMs, windowsHide: true });
	// A collected unit may already be gone; a bus error never counts as stopped.
	if (stop.error) return false;
	return transientUnitStopped(unit, systemctl);
}

async function terminateTree(child, graceMs, killWaitMs) {
	if (!child.pid) return true;
	if (process.platform === "win32") {
		return new Promise((resolve) => {
			const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
			const timer = setTimeout(() => { killer.kill(); resolve(false); }, killWaitMs);
			killer.once("error", () => { clearTimeout(timer); resolve(false); });
			killer.once("close", (code) => { clearTimeout(timer); resolve(code === 0); });
		});
	}
	try { process.kill(-child.pid, "SIGTERM"); } catch (error) { if (error.code !== "ESRCH") return false; }
	if (await waitUntilStopped(child.pid, graceMs)) return true;
	try { process.kill(-child.pid, "SIGKILL"); } catch (error) { if (error.code !== "ESRCH") return false; }
	return waitUntilStopped(child.pid, killWaitMs);
}

/** A timeout finishes only after the writer process tree is stopped. Callers must
 * retain their snapshot and refuse rollback when stopped is false. */
export async function runCommand(command, args, {
	env = process.env, cwd, shell = false, timeoutMs = 300000, graceMs = 2500, killWaitMs = 10000, onSpawn,
	unit, systemctl = "systemctl", stopUnit = stopTransientUnit
} = {}) {
	let child;
	try {
		child = spawn(command, args, { env, cwd, shell, detached: process.platform !== "win32", windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
	} catch (error) {
		return { ok: false, code: null, timedOut: false, stopped: true, out: error.message };
	}
	let out = "";
	let stdout = "";
	let stderr = "";
	const append = (data) => { out = (out + String(data)).slice(-4000); };
	child.stdout?.on("data", (data) => { stdout = (stdout + String(data)).slice(-4000); append(data); });
	child.stderr?.on("data", (data) => { stderr = (stderr + String(data)).slice(-4000); append(data); });
	const closed = new Promise((resolve) => {
		child.once("error", (error) => { append(error.message); resolve({ code: null }); });
		child.once("close", (code) => resolve({ code }));
	});
	const confirmUnitStopped = async () => {
		if (!unit) return true;
		try { return await stopUnit(unit, killWaitMs, systemctl); } catch { return false; }
	};
	try { if (child.pid) onSpawn?.(child.pid); }
	catch (error) {
		const unitStopped = await confirmUnitStopped();
		const stopped = await terminateTree(child, graceMs, killWaitMs) && unitStopped;
		child.stdout?.destroy(); child.stderr?.destroy(); child.unref();
		return { ok: false, code: null, stopped, timedOut: false, out: error.message };
	}
	let timer;
	const first = await Promise.race([closed, new Promise((resolve) => { timer = setTimeout(() => resolve(null), timeoutMs); })]);
	clearTimeout(timer);
	if (first !== null) {
		const unitStopped = !unit || transientUnitStopped(unit, systemctl) || await confirmUnitStopped();
		const launcherStopped = !child.pid || process.platform === "win32" || !processGroupAlive(child.pid) || await terminateTree(child, graceMs, killWaitMs);
		const stopped = unitStopped && launcherStopped;
		return { ok: first.code === 0 && stopped, code: first.code, timedOut: false, stopped, out, stdout, stderr };
	}
	const unitStopped = await confirmUnitStopped();
	const launcherStopped = await terminateTree(child, graceMs, killWaitMs);
	const stopped = unitStopped && launcherStopped;
	// close also drains stdout/stderr; bound the wait if an escaped child holds a pipe.
	let drainTimer;
	await Promise.race([closed, new Promise((resolve) => { drainTimer = setTimeout(resolve, killWaitMs); })]);
	clearTimeout(drainTimer);
	child.stdout?.destroy(); child.stderr?.destroy(); child.unref();
	return { ok: false, code: null, timedOut: true, stopped, out, stdout, stderr };
}
