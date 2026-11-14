import fs from "node:fs";
import path from "node:path";
import * as semver from "./semver.js";
import { ensureCliLink } from "./install-context.mjs";
import { runCommand } from "./process-runner.mjs";
import { fileURLToPath } from "node:url";
import { writeJsonAtomic } from "./update-state.mjs";

export const BLOCKED_SCRIPTS = /(?:had|have|were)\s+install scripts blocked|not covered by allowScripts/i;

// Keep every link inside the copied tree. Realpath memoization also preserves
// pnpm dependency cycles without leaving a reference back into the live store.
function copyIndependentTree(source, destination, copied = new Map(), finalDestination = destination) {
	const real = fs.realpathSync(source);
	const info = fs.statSync(real);
	if (info.isDirectory()) {
		if (copied.has(real)) {
			fs.symlinkSync(process.platform === "win32" ? copied.get(real) : path.relative(path.dirname(finalDestination), copied.get(real)), destination, process.platform === "win32" ? "junction" : "dir");
			return;
		}
		copied.set(real, finalDestination);
		fs.mkdirSync(destination, { mode: 0o700 });
		for (const name of fs.readdirSync(real)) copyIndependentTree(path.join(real, name), path.join(destination, name), copied, path.join(finalDestination, name));
		fs.chmodSync(destination, info.mode & 0o777);
	} else if (info.isFile()) {
		fs.copyFileSync(real, destination);
		fs.chmodSync(destination, info.mode & 0o777);
	} else throw new Error(`快照不支持的文件类型：${source}`);
	fs.utimesSync(destination, info.atime, info.mtime);
}

export function snapshotInstall(context, backupDir) {
	const realRoot = fs.realpathSync(context.installRoot);
	if (JSON.parse(fs.readFileSync(path.join(realRoot, "package.json"), "utf8")).version !== context.currentVersion) throw new Error("当前 dsh 版本已发生变化，请重新检查更新");
	fs.mkdirSync(backupDir, { recursive: true, mode: 0o700 });
	const backupRoot = fs.realpathSync(backupDir);
	if (backupRoot === realRoot || backupRoot.startsWith(realRoot + path.sep)) throw new Error("备份目录不能位于 dsh 安装目录中");
	const snapshot = path.join(backupDir, `dsh-${context.currentVersion}-${Date.now()}-${process.pid}`);
	try {
		// Materialize links, including the root, so pnpm stores and linked roots
		// cannot change the backup when npm replaces the live tree.
		copyIndependentTree(realRoot, snapshot);
	} catch (error) { fs.rmSync(snapshot, { recursive: true, force: true }); throw error; }
	return { root: context.installRoot, snapshot, version: context.currentVersion };
}

function versionInOutput(output, target) {
	return output.split(/\r?\n/).some((line) => {
		const clean = line.trim().replace(/^(?:@deepseek-ai\/dsh|dsh)(?:\s+version)?[\s/:]+/i, "");
		return semver.valid(clean) !== null && semver.valid(clean) === semver.valid(target);
	});
}

export async function verifyInstall(context, target, installOutput = "", options = {}) {
	if (BLOCKED_SCRIPTS.test(installOutput)) return { ok: false, stopped: true, reason: "npm 拦截了依赖的安装脚本" };
	try {
		const pkg = JSON.parse(fs.readFileSync(path.join(context.installRoot, "package.json"), "utf8"));
		if (pkg.name !== "@deepseek-ai/dsh" || semver.valid(pkg.version) !== semver.valid(target)) return { ok: false, stopped: true, reason: "磁盘上的 dsh 版本与目标不符" };
		const entry = ensureCliLink(context);
		// Use the host's Node even if a service PATH contains another Node version.
		const result = await runCommand(process.execPath, [entry, "--version"], { ...options, timeoutMs: options.verifyTimeoutMs ?? 30000 });
		return { ...result, ok: result.ok && versionInOutput(result.stdout || "", target), reason: "dsh CLI 校验失败（--version 异常或版本不符）", detail: result.out.slice(-600) };
	} catch (error) { return { ok: false, stopped: true, reason: error.message }; }
}

export async function restoreSnapshot(context, saved, options = {}) {
	const suffix = `${process.pid}-${Date.now()}`;
	const stage = path.join(path.dirname(saved.root), `.dsh-rollback-${suffix}`);
	const failed = path.join(path.dirname(saved.root), `.dsh-failed-${suffix}`);
	try {
		copyIndependentTree(saved.snapshot, stage, new Map(), saved.root);
		try { fs.lstatSync(saved.root); fs.renameSync(saved.root, failed); } catch (error) { if (error.code !== "ENOENT") throw error; }
		try { fs.renameSync(stage, saved.root); } catch (error) {
			if (fs.existsSync(failed) && !fs.existsSync(saved.root)) fs.renameSync(failed, saved.root);
			throw error;
		}
		const check = await verifyInstall(context, saved.version, "", options);
		if (!check.ok) throw new Error(`${check.reason}${check.detail ? `：${check.detail}` : ""}`);
		fs.rmSync(failed, { recursive: true, force: true });
		fs.rmSync(saved.snapshot, { recursive: true, force: true });
		return { ok: true, version: saved.version };
	} catch (error) {
		try { fs.rmSync(stage, { recursive: true, force: true }); } catch {}
		return { ok: false, version: saved.version, error: error.message, snapshot: saved.snapshot };
	}
}

/** Entire transaction runs inside the independent worker, including recovery. */
export async function runUpdateTransaction(config, onStage = () => {}) {
	const { context, target, backupDir, registry } = config;
	let { allowScriptsArgs, allowAllScripts } = config;
	const env = { ...process.env, ...config.processOptions?.env, npm_config_registry: registry, NPM_CONFIG_REGISTRY: registry, npm_config_prefix: context.prefix, NPM_CONFIG_PREFIX: context.prefix };
	const inheritedPath = Object.entries(env).find(([key]) => key.toUpperCase() === "PATH")?.[1] || "";
	for (const key of Object.keys(env)) if (key.toUpperCase() === "PATH") delete env[key];
	env.PATH = [path.dirname(process.execPath), inheritedPath].filter(Boolean).join(path.delimiter);
	const options = { ...config.processOptions, env, cwd: context.prefix };
	let saved;
	let writersStopped = true;
	let result = { ok: false, code: null, out: "", timedOut: false };
	const output = [];
	try {
		if (!semver.gt(target, context.currentVersion)) throw new Error("仅支持安装比当前更新的版本");
		if (!allowScriptsArgs) {
			onStage({ stage: "checking-npm" });
			const probe = await runCommand(context.npm.command, [...context.npm.argsPrefix, "--version"], { ...options, timeoutMs: 15000 });
			const major = probe.ok ? Number(/^(\d+)/.exec((probe.stdout || "").trim())?.[1]) : NaN;
			allowScriptsArgs = major >= 12 && config.allowScriptNames?.length ? [`--allow-scripts=${config.allowScriptNames.join(",")}`] : [];
		}
		onStage({ stage: "snapshotting" });
		saved = snapshotInstall(context, backupDir);
		onStage({ stage: "installing", backup: saved.snapshot });
		const base = ["install", "-g", "--prefix", context.prefix, "--no-audit", "--no-fund"];
		const runNpm = async (args, attempt) => {
			const npmArgs = [...context.npm.argsPrefix, ...args, `@deepseek-ai/dsh@${target}`];
			const unit = config.systemdRun ? `dsh-about-install-${config.lock.id}-${attempt}` : null;
			let payload;
			let command = context.npm.command;
			let argv = npmArgs;
			if (unit) {
				payload = path.join(config.jobDir, `npm-${attempt}.json`);
				writeJsonAtomic(payload, { command, args: npmArgs, env: options.env, cwd: options.cwd });
				command = config.systemdRun;
				argv = ["--user", "--collect", "--wait", "--pipe", "--quiet", `--unit=${unit}`, "--property=Type=exec", "--property=KillMode=control-group", "--property=TimeoutStopSec=5s", process.execPath, fileURLToPath(new URL("./background-command.mjs", import.meta.url)), payload];
			}
			onStage({ installerUnit: unit });
			const install = await runCommand(command, argv, {
				...options, shell: context.npm.shell,
				unit,
				onSpawn: (pid) => onStage({ installerPid: pid })
			});
			writersStopped = install.stopped;
			output.push(install.out);
			if (payload) fs.rmSync(payload, { force: true });
			return install;
		};
		for (let attempt = 0; attempt < 2; attempt++) {
			if (attempt && BLOCKED_SCRIPTS.test(output[0]) && allowAllScripts === undefined && allowScriptsArgs.length) {
				const probe = await runCommand(context.npm.command, [...context.npm.argsPrefix, "config", "get", "dangerously-allow-all-scripts"], { ...options, timeoutMs: 15000 });
				allowAllScripts = probe.ok && /^(?:true|false)$/i.test((probe.stdout || "").trim());
			}
			const args = attempt === 0 ? allowScriptsArgs : BLOCKED_SCRIPTS.test(output[0]) && allowAllScripts ? ["--dangerously-allow-all-scripts"] : allowScriptsArgs;
			if (attempt) onStage({ stage: "retrying" });
			result = await runNpm([...base, ...args, ...(attempt ? ["--force"] : [])], attempt);
			if (result.timedOut || !writersStopped) break;
			onStage({ stage: "verifying", installerPid: null });
			const check = result.ok ? await verifyInstall(context, target, result.out, { ...options, onSpawn: (pid) => onStage({ installerPid: pid }) }) : { ok: false, stopped: true, reason: "安装命令失败" };
			writersStopped = check.stopped;
			if (writersStopped) onStage({ installerPid: null });
			if (check.ok) return { ...result, ok: true, selfHealed: attempt > 0, installedVersion: target, backup: saved.snapshot };
			output.push(`${check.reason}${check.detail ? `：${check.detail}` : ""}`);
			if (!writersStopped || check.timedOut) break;
		}
	} catch (error) { output.push(error.message); }
	if (!saved) return { ...result, ok: false, out: output.join("\n"), error: "创建回滚快照失败，未执行安装" };
	if (!writersStopped) return { ...result, ok: false, needsRecovery: true, backup: saved.snapshot, out: output.join("\n"), error: "无法确认安装进程树已停止，已保留快照并禁止并发回滚" };
	try { onStage({ stage: "rolling-back", installerPid: null }); } catch { /* Recovery must continue if status storage fails. */ }
	const rollback = await restoreSnapshot(context, saved, { ...options, onSpawn: (pid) => onStage({ installerPid: pid }) });
	return {
		...result, ok: false, rolledBack: rollback.ok, needsRecovery: !rollback.ok,
		installedVersion: rollback.ok ? saved.version : null, backup: rollback.ok ? null : saved.snapshot,
		out: [...output, rollback.ok ? `已自动回滚到 ${saved.version}` : `自动回滚失败：${rollback.error}；快照保留于 ${saved.snapshot}`].join("\n").slice(-5000),
		error: rollback.ok ? "安装未通过健康校验，已恢复旧版" : "安装失败且自动回滚未完成"
	};
}
