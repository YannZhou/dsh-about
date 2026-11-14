import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchBackground, systemdRunForHost } from "./background-launch.mjs";
import { writeJsonAtomic, acquireUpdateLock, releaseUpdateLock, readUpdateStatus, processIdentity, sleep } from "./update-state.mjs";

/** Stage the complete runtime outside the npm tree before it can be replaced. */
export async function startUpdateJob(config, { systemdRun = systemdRunForHost() } = {}) {
	const { directory } = config;
	const lock = acquireUpdateLock(directory, "dsh", config.target);
	const jobDir = path.join(directory, "jobs", lock.id);
	try {
		const runtime = path.join(jobDir, "runtime");
		fs.mkdirSync(runtime, { recursive: true, mode: 0o700 });
		const source = fileURLToPath(new URL("./", import.meta.url));
		for (const name of fs.readdirSync(source)) {
			if (name.endsWith(".mjs") || name === "semver.js") fs.copyFileSync(path.join(source, name), path.join(runtime, name));
		}
		writeJsonAtomic(path.join(runtime, "package.json"), { type: "module" });
		fs.copyFileSync(fileURLToPath(new URL("../bin/dsh-watchdog.mjs", import.meta.url)), path.join(runtime, "dsh-watchdog.mjs"));
		const configFile = path.join(jobDir, "config.json");
		writeJsonAtomic(configFile, { ...config, jobDir, lock, systemdRun, hostOwner: processIdentity() });
		writeJsonAtomic(path.join(directory, "update-state.json"), { id: lock.id, target: config.target, kind: "dsh", inProgress: true, stage: "launching", owner: lock.owner, startedAt: lock.startedAt });
		await launchBackground(path.join(runtime, "update-worker.mjs"), [configFile], { directory: jobDir, readyFile: path.join(jobDir, "ready.json"), systemdRun });
		writeJsonAtomic(path.join(jobDir, "commit.json"), { committed: true });
		return { id: lock.id, target: config.target, accepted: true, inProgress: true };
	} catch (error) {
		writeJsonAtomic(path.join(directory, "update-state.json"), { id: lock.id, inProgress: false, stage: "failed", target: config.target, result: { ok: false, error: error.message, out: "" }, finishedAt: Date.now() });
		releaseUpdateLock(directory, lock);
		throw error;
	}
}

export async function waitForUpdateJob(directory, id) {
	for (;;) {
		const state = readUpdateStatus(directory);
		if (state.id !== id) throw new Error("更新任务状态已被替换");
		if (!state.inProgress) return state.result || { ok: false, error: "更新任务已中断", out: "" };
		await sleep(150);
	}
}
