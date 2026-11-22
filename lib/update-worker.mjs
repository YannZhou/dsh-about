import fs from "node:fs";
import path from "node:path";
import { readJson, writeJsonAtomic, claimUpdateLock, releaseUpdateLock, processIdentity, sleep, ownerAlive, appendUpdateLog } from "./update-state.mjs";
import { runUpdateTransaction } from "./update-transaction.mjs";
import { recordUpdateFailure } from "./update-diagnostics.mjs";
import { armWatchdog } from "./restart.mjs";
import { cliEntry } from "./install-context.mjs";

const config = readJson(process.argv[2]);
if (!config) throw new Error("更新任务配置不存在");
const { directory, jobDir, lock } = config;
const stateFile = path.join(directory, "update-state.json");
let state = { id: lock.id, kind: "dsh", target: config.target, currentVersion: config.context.currentVersion, startedAt: lock.startedAt, owner: processIdentity(), inProgress: true, hostNonce: config.restart?.hostNonce };
function report(change) {
	if (change.stage && change.stage !== state.stage) appendUpdateLog(directory, `job=${lock.id} target=${config.target} stage=${change.stage}`);
	state = { ...state, ...change, updatedAt: Date.now() };
	if (change.installerPid) state.installer = processIdentity(change.installerPid);
	if (change.installerPid === null) state.installer = null;
	writeJsonAtomic(stateFile, state);
	if (state.inProgress === false) recordUpdateFailure(directory, state);
}
try {
	claimUpdateLock(directory, lock);
	report({ stage: "launching" });
	writeJsonAtomic(path.join(jobDir, "ready.json"), { ready: true, ...processIdentity() });
	const deadline = Date.now() + 20000;
	while (!fs.existsSync(path.join(jobDir, "commit.json"))) {
		if (Date.now() > deadline || readJson(path.join(directory, "update.lock"))?.id !== lock.id) throw new Error("宿主未确认任务启动，未修改安装目录");
		await sleep(40);
	}
	const result = await runUpdateTransaction(config, report);
	if (config.restart && (result.ok || result.rolledBack && !ownerAlive(config.hostOwner))) {
		try {
			report({ stage: "arming-restart" });
			if (config.restart.relaunchDsh) {
				const entry = cliEntry(config.context.installRoot);
				if (!entry) throw new Error("更新后的 dsh CLI 入口不存在");
				config.restart.argv = [process.execPath, entry, ...config.restart.argv.slice(2)];
			}
			result.restarting = await armWatchdog(config.restart, jobDir, path.join(jobDir, "runtime", "dsh-watchdog.mjs"), config.systemdRun);
		} catch (error) { result.restarting = false; result.lastRestartError = error.message; }
	}
	result.hostNonce = config.restart?.hostNonce;
	appendUpdateLog(directory, `job=${lock.id} ok=${result.ok} rolledBack=${result.rolledBack === true}\n${result.out || result.error || ""}`);
	report({ inProgress: false, stage: result.ok ? "installed" : "failed", needsRecovery: result.needsRecovery === true, backup: result.backup, diagnostic: undefined, result, finishedAt: Date.now(), installer: result.needsRecovery ? state.installer : null });
} catch (error) {
	// A lost/replaced lock means this delayed launch no longer owns the state.
	if (readJson(path.join(directory, "update.lock"))?.id === lock.id && readJson(stateFile)?.inProgress) {
		report({ inProgress: false, stage: "failed", needsRecovery: Boolean(state.backup), result: { ok: false, failureStage: state.stage, error: error.message, out: state.backup ? "快照保留于 " + state.backup : "" }, finishedAt: Date.now() });
	}
} finally {
	if (!state.needsRecovery) releaseUpdateLock(directory, lock);
}
