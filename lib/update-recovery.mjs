import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { acquireUpdateLock, releaseUpdateLock, readUpdateStatus, readJson, writeJsonAtomic, ownerAlive, appendUpdateLog, processIdentity } from "./update-state.mjs";
import { processGroupAlive, transientUnitStopped, runCommand } from "./process-runner.mjs";
import { restoreSnapshot } from "./update-transaction.mjs";
import { valid } from "./semver.js";

const PLUGIN_NAMES = ["@yannzhou/dsh-about", "dsh-about"];

function pluginLocation(directory, state, profile) {
	const profiles = path.join(path.dirname(directory), "profiles");
	const saved = state.plugin;
	if (saved && profile && saved.profile !== profile) throw new Error("指定 profile 与原插件更新任务不一致");
	profile ||= saved?.profile;
	if (profile && (profile === "." || profile === ".." || /[\\/]/.test(profile))) throw new Error("profile 名称无效");
	const candidates = [];
	if (saved) {
		if (!profile || !PLUGIN_NAMES.includes(saved.key) || !PLUGIN_NAMES.includes(saved.name)) throw new Error("原插件更新配置不完整");
		candidates.push({ profile, key: saved.key });
	} else {
		// Older interrupted tasks did not record a profile. Only infer it when
		// unambiguous; --profile lets the user select among multiple installations.
		for (const name of profile ? [profile] : fs.readdirSync(profiles)) {
			const manifest = readJson(path.join(profiles, name, "package.json"));
			for (const key of PLUGIN_NAMES) {
				if (manifest?.dependencies?.[key]) candidates.push({ profile: name, key });
			}
		}
	}
	if (candidates.length !== 1) throw new Error("无法唯一确定待恢复插件，请用 --profile <名称> 指定原安装 profile，并确认其依赖清单仍声明 dsh-about");
	const location = candidates[0];
	return { ...location, root: path.join(profiles, location.profile, "node_modules", location.key) };
}

async function recoverPlugin(directory, state, profile) {
	const location = pluginLocation(directory, state, profile);
	const lock = acquireUpdateLock(directory, "recovery", state.target, { recovery: true });
	const file = path.join(directory, "update-state.json");
	let current = { ...state, owner: processIdentity(), plugin: { profile: location.profile, key: location.key, name: location.key }, installer: null, installerUnit: null, inProgress: true, stage: "verifying-recovery", needsRecovery: true };
	const persist = (change) => { current = { ...current, ...change, updatedAt: Date.now() }; writeJsonAtomic(file, current); };
	let check;
	let claimed = false;
	try {
		const latest = readUpdateStatus(directory);
		if (latest.id !== state.id || !latest.needsRecovery) throw new Error("更新任务已发生变化，请重新检查状态");
		persist({});
		claimed = true;
		const pkg = readJson(path.join(location.root, "package.json"));
		if (!PLUGIN_NAMES.includes(pkg?.name) || !valid(pkg?.version)) throw new Error("插件清单缺失或版本无效");
		const entry = (relative) => {
			if (typeof relative !== "string") throw new Error("插件入口声明缺失");
			const resolved = path.resolve(location.root, relative);
			if (!resolved.startsWith(path.resolve(location.root) + path.sep) || !fs.statSync(resolved).isFile()) throw new Error("插件入口文件无效");
			return resolved;
		};
		const host = entry(pkg.main);
		const client = entry(pkg.exports?.["./client"]);
		entry(pkg.dsh?.bundle?.patch);
		const options = { timeoutMs: 30000, env: { ...process.env, DSH_HOME: path.dirname(directory), DSH_ABOUT_NPMRC: "off" }, onSpawn: (pid) => persist({ installer: processIdentity(pid) }) };
		// Check the browser bundle's syntax and import the host's dependency graph
		// in an isolated process, without mounting it into a running dsh instance.
		for (const args of [["--check", client], ["--input-type=module", "-e", "await import(process.argv[1])", pathToFileURL(host).href]]) {
			check = await runCommand(process.execPath, args, options);
			if (!check.ok) throw new Error(`插件加载校验失败：${check.out || "子进程退出异常"}`);
			persist({ installer: null });
		}
		persist({ owner: state.owner, inProgress: false, stage: "recovered", needsRecovery: false, finishedAt: Date.now(), result: { ok: false, recovered: true, installedVersion: pkg.version, error: `已确认插件 ${pkg.version} 可加载，已解除更新阻塞，请重新启动 dsh`, out: "" } });
		appendUpdateLog(directory, `plugin recovery ok=true profile=${location.profile} version=${pkg.version}`);
		return { ok: true, kind: "plugin", version: pkg.version, profile: location.profile };
	} catch (error) {
		if (!claimed) throw error;
		const message = `${error.message}。请在原 profile 手动重新安装插件后，再运行本恢复命令（当前未解除更新阻塞）`;
		persist({ owner: state.owner, inProgress: false, stage: "failed", needsRecovery: true, installer: check?.stopped === false ? current.installer : null, finishedAt: Date.now(), result: { ok: false, error: message, out: "" } });
		return { ok: false, kind: "plugin", error: message };
	} finally { releaseUpdateLock(directory, lock); }
}

/** Explicit recovery after the worker itself was killed or rollback failed. */
export async function recoverUpdate(directory, { profile } = {}) {
	const state = readUpdateStatus(directory);
	if (!state.needsRecovery || !/^[a-f0-9]{24}$/.test(state.id || "")) throw new Error("没有待恢复的更新任务");
	if (ownerAlive(state.owner || { pid: state.pid }) || ownerAlive(state.installer) || process.platform !== "win32" && processGroupAlive(state.installer?.pid)) throw new Error("原宿主或安装进程仍在运行，不能恢复更新");
	if (state.installerUnit && !transientUnitStopped(state.installerUnit)) throw new Error("尚未确认安装服务单元已停止，不能恢复快照");
	if (state.kind === "plugin") return recoverPlugin(directory, state, profile);
	if (!state.backup) throw new Error("没有可恢复的更新快照");
	const config = readJson(path.join(directory, "jobs", state.id, "config.json"));
	if (!config?.context || path.dirname(state.backup) !== config.backupDir || !fs.existsSync(state.backup)) throw new Error("快照或原安装配置不完整，请检查保留的备份");
	const lock = acquireUpdateLock(directory, "recovery", config.context.currentVersion, { recovery: true });
	let result;
	try {
		result = await restoreSnapshot(config.context, { root: config.context.installRoot, snapshot: state.backup, version: config.context.currentVersion });
		writeJsonAtomic(path.join(directory, "update-state.json"), {
			...state, inProgress: false, stage: result.ok ? "recovered" : "failed", needsRecovery: !result.ok,
			backup: result.ok ? null : state.backup, finishedAt: Date.now(),
			result: {
				...state.result, ok: false, rolledBack: result.ok, installedVersion: result.ok ? result.version : null,
				error: result.ok ? "已恢复 dsh " + result.version + "，请重新检查更新" : result.error,
				out: [state.result?.out, result.ok ? null : "快照保留于 " + state.backup].filter(Boolean).join("\n")
			}
		});
		appendUpdateLog(directory, `manual recovery ok=${result.ok} version=${result.version}`);
		return result;
	} finally { if (result?.ok) releaseUpdateLock(directory, lock); }
}
