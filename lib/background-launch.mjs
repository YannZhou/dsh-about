import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { sleep, readJson, writeJsonAtomic } from "./update-state.mjs";

export function systemdRunForHost() {
	if (process.platform !== "linux") return null;
	let managed = Boolean(process.env.INVOCATION_ID || process.env.SYSTEMD_EXEC_PID || process.env.XDG_RUNTIME_DIR);
	try { managed ||= /\.service(?:\/|$)/m.test(fs.readFileSync("/proc/self/cgroup", "utf8")); } catch {}
	if (!managed) return null;
	for (const candidate of ["/usr/bin/systemd-run", "/bin/systemd-run"]) {
		try { fs.accessSync(candidate, fs.constants.X_OK); return candidate; } catch {}
	}
	throw new Error("宿主运行于 systemd，但未找到 systemd-run，无法隔离后台任务");
}

/** Confirm both dispatcher success and the launched program's ready record. */
export async function launchBackground(script, args, {
	directory, env = process.env, readyFile, systemdRun = systemdRunForHost(), timeoutMs = 15000, spawnImpl = spawn
}) {
	fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
	const token = randomBytes(10).toString("hex");
	const payload = path.join(directory, `launch-${token}.json`);
	writeJsonAtomic(payload, { env, script, args });
	const bootstrap = fileURLToPath(new URL("./background-entry.mjs", import.meta.url));
	const command = systemdRun || process.execPath;
	const argv = systemdRun
		? ["--user", "--collect", "--quiet", `--unit=dsh-about-${token}`, "--property=Type=exec", process.execPath, bootstrap, payload]
		: [bootstrap, payload];
	let child;
	let error = null;
	let exitCode;
	let output = "";
	try {
		child = spawnImpl(command, argv, { detached: !systemdRun, windowsHide: true, stdio: ["ignore", "ignore", "pipe"], env: process.env });
		child.once("error", (cause) => { error = cause; });
		child.once("close", (code) => { exitCode = code; });
		child.stderr?.on("data", (chunk) => { output = (output + String(chunk)).slice(-1000); });
		const deadline = Date.now() + timeoutMs;
		while (Date.now() < deadline) {
			if (error) throw error;
			if (exitCode !== undefined && (systemdRun ? exitCode !== 0 : true)) throw new Error(`后台任务派发失败（exit=${exitCode}）${output}`);
			const ready = readJson(readyFile);
			if (ready?.ready === true && (!systemdRun || exitCode === 0)) {
				child.stderr?.destroy(); child.unref();
				return ready;
			}
			await sleep(40);
		}
		throw new Error(`后台任务启动确认超时${output}`);
	} catch (cause) {
		// Deleting the unconsumed payload cancels a delayed launch before mutation.
		fs.rmSync(payload, { force: true });
		child?.stderr?.destroy(); child?.unref();
		throw cause;
	}
}
