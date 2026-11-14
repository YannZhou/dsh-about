import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export function readJson(file) { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; } }
export function writeJsonAtomic(file, value) {
	fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
	const temp = `${file}.${process.pid}.${randomBytes(5).toString("hex")}.tmp`;
	try { fs.writeFileSync(temp, JSON.stringify(value) + "\n", { mode: 0o600, flag: "wx" }); fs.renameSync(temp, file); }
	finally { fs.rmSync(temp, { force: true }); }
}
export function processIdentity(pid = process.pid) {
	let fingerprint = null;
	if (process.platform === "linux") {
		try { const raw = fs.readFileSync(`/proc/${pid}/stat`, "utf8"); fingerprint = raw.slice(raw.lastIndexOf(")") + 2).split(" ")[19]; } catch {}
	}
	return { pid, fingerprint };
}
export function ownerAlive(owner) {
	if (!Number.isInteger(owner?.pid) || owner.pid <= 0) return false;
	try { process.kill(owner.pid, 0); } catch (error) { return error.code === "EPERM"; }
	if (process.platform === "linux") {
		try {
			const raw = fs.readFileSync(`/proc/${owner.pid}/stat`, "utf8");
			const fields = raw.slice(raw.lastIndexOf(")") + 2).split(" ");
			return fields[0] !== "Z" && (!owner.fingerprint || fields[19] === owner.fingerprint);
		} catch { return false; }
	}
	return true;
}
export function readUpdateStatus(directory) {
	const state = readJson(path.join(directory, "update-state.json"));
	if (!state) return { inProgress: false, stage: "idle" };
	if (state.inProgress && !ownerAlive(state.owner || { pid: state.pid }) && !(state.stage === "launching" && Date.now() - state.startedAt < 20000)) {
		return { ...state, inProgress: false, stage: "interrupted", needsRecovery: Boolean(state.kind === "plugin" || state.backup || state.installer || state.pid), result: { ok: false, error: state.kind === "plugin" ? "插件更新已中断，请停止原宿主和安装进程后运行 node scripts/recover-update.mjs 检查插件并解除阻塞" : "更新任务已意外退出，请检查保留的快照后恢复安装", out: state.backup ? `回滚快照：${state.backup}` : "" } };
	}
	return state;
}

function lockIsActive(file) {
	const existing = readJson(file);
	if (ownerAlive(existing?.owner)) return true;
	try { return Date.now() - fs.statSync(file).mtimeMs < 20000; }
	catch (error) { if (error.code === "ENOENT") return false; throw error; }
}

function releaseFileLock(file, lock) {
	if (readJson(file)?.id === lock.id) fs.rmSync(file, { force: true });
}

// Reclamation uses the same owner-aware protocol as the installation lock.
// A crashed reclaimer is recovered under its own guard; never unlink a stale
// guard without serialization, since another contender may have replaced it.
function acquireFileLock(file, lock) {
	try { fs.writeFileSync(file, JSON.stringify(lock), { mode: 0o600, flag: "wx" }); return; }
	catch (error) { if (error.code !== "EEXIST") throw error; }
	if (lockIsActive(file)) throw new Error("已有安装任务正在进行，请稍候重试");
	const reclaim = `${file}.reclaim`;
	acquireFileLock(reclaim, lock);
	try {
		if (lockIsActive(file)) throw new Error("已有安装任务正在进行，请稍候重试");
		fs.rmSync(file, { force: true });
		fs.writeFileSync(file, JSON.stringify(lock), { mode: 0o600, flag: "wx" });
	} finally { releaseFileLock(reclaim, lock); }
}

export function acquireUpdateLock(directory, kind, target, { recovery = false } = {}) {
	fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
	const file = path.join(directory, "update.lock");
	const state = readUpdateStatus(directory);
	if (state.needsRecovery && !recovery) throw new Error(`上次更新需要恢复；快照：${state.backup || "请检查 update-state.json"}`);
	const lock = { id: randomBytes(12).toString("hex"), kind, target, owner: processIdentity(), startedAt: Date.now() };
	acquireFileLock(file, lock);
	// The previous owner may have died while this contender was acquiring a
	// stale lock. Recheck durable recovery requirements before authorizing writes.
	if (!recovery && readUpdateStatus(directory).needsRecovery) {
		releaseFileLock(file, lock);
		throw new Error("上次更新需要恢复，请运行 node scripts/recover-update.mjs");
	}
	return lock;
}
export function claimUpdateLock(directory, lock) {
	const file = path.join(directory, "update.lock");
	if (readJson(file)?.id !== lock.id) throw new Error("更新锁已失效，任务已中止");
	lock.owner = processIdentity();
	writeJsonAtomic(file, lock);
}
export function releaseUpdateLock(directory, lock) {
	releaseFileLock(path.join(directory, "update.lock"), lock);
}

export function appendUpdateLog(directory, message) {
	try {
		const file = path.join(directory, "update.log");
		if (fs.existsSync(file) && fs.statSync(file).size > 1024 * 1024) fs.renameSync(file, `${file}.1`);
		fs.appendFileSync(file, `${new Date().toISOString()} ${message}\n`, { mode: 0o600 });
		fs.chmodSync(file, 0o600);
	} catch { /* Durable state and snapshots remain the recovery source of truth. */ }
}
