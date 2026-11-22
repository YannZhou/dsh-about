import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import * as semver from "./semver.js";
import { ensureCliLink, packageRootFromEntry, pluginPeerWarningsFor } from "./install-context.mjs";
import { runCommand } from "./process-runner.mjs";
import { fileURLToPath } from "node:url";
import { writeJsonAtomic } from "./update-state.mjs";
import { missingModuleExport, redactUpdateOutput, updateCheck } from "./update-diagnostics.mjs";
import { checkPreflightWeb, nodeCompatibility, preflightEnvironment } from "./update-preflight.mjs";

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

function resolvedDependency(spec, output, entry) {
	const importer = /^(file:\/\/[^\r\n]+?):\d+(?::\d+)?\r?$/m.exec(output)?.[1];
	for (const anchor of [importer, entry].filter(Boolean)) {
		try {
			const resolve = createRequire(anchor === importer ? new URL(anchor) : anchor).resolve;
			let manifest;
			try { manifest = resolve(spec + "/package.json"); }
			catch {
				const root = packageRootFromEntry(resolve(spec), spec);
				if (root) manifest = path.join(root, "package.json");
			}
			if (manifest) return { name: spec, version: JSON.parse(fs.readFileSync(manifest, "utf8")).version };
		} catch { /* Preserve the original error if resolution is unavailable. */ }
	}
	return { name: spec };
}

export async function verifyInstall(context, target, installOutput = "", options = {}) {
	if (BLOCKED_SCRIPTS.test(installOutput)) return { ok: false, stopped: true, issue: "install-scripts", reason: "npm 拦截了依赖的安装脚本" };
	try {
		const pkg = JSON.parse(fs.readFileSync(path.join(context.installRoot, "package.json"), "utf8"));
		if (pkg.name !== "@deepseek-ai/dsh" || semver.valid(pkg.version) !== semver.valid(target)) return { ok: false, stopped: true, reason: "磁盘上的 dsh 版本与目标不符" };
		const incompatible = options.checkNodeCompatibility && nodeCompatibility(pkg.engines?.node);
		if (incompatible) return incompatible;
		const entry = ensureCliLink(context);
		// Use the host's Node even if a service PATH contains another Node version.
		const result = await runCommand(process.execPath, [entry, "--version"], { ...options, timeoutMs: options.verifyTimeoutMs ?? 30000, outputLimit: 16000 });
		const ok = result.ok && versionInOutput(result.stdout || "", target);
		if (ok) return result;
		const exportError = missingModuleExport(result.stderr || result.out);
		return {
			...result, ok: false, issue: exportError ? "module-export" : "cli",
			reason: exportError ? exportError.package + " 缺少导出 " + exportError.name : "dsh CLI 校验失败（--version 异常或版本不符）",
			dependency: exportError ? resolvedDependency(exportError.package, result.stderr || result.out, entry) : undefined,
			detail: result.out.slice(-1400)
		};
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
	const options = { ...config.processOptions, env, cwd: context.prefix, outputLimit: 16000 };
	const checks = [];
	let saved;
	let writersStopped = true;
	let result = { ok: false, code: null, out: "", timedOut: false };
	let failureStage = config.preflight ? "preflight" : "snapshotting";
	let preflightWarnings = [];
	const output = [];
	const diagnostic = () => ({ currentVersion: context.currentVersion, checks, failureStage, preflightWarnings });
	const complete = (change) => ({
		...result, ...diagnostic(), ...change,
		out: redactUpdateOutput(change.out ?? result.out, env),
		stdout: redactUpdateOutput(result.stdout, env),
		stderr: redactUpdateOutput(result.stderr, env)
	});
	const trackPid = (pid) => onStage({ installerPid: pid });

	const runNpm = async (args, targetContext, installOptions, jobStep) => {
		const npmArgs = [...context.npm.argsPrefix, ...args, "@deepseek-ai/dsh@" + target];
		const unit = config.systemdRun ? "dsh-about-install-" + config.lock.id + "-" + jobStep : null;
		let payload;
		let command = context.npm.command;
		let argv = npmArgs;
		if (unit) {
			payload = path.join(config.jobDir, "npm-" + jobStep + ".json");
			writeJsonAtomic(payload, { command, args: npmArgs, env: installOptions.env, cwd: installOptions.cwd });
			command = config.systemdRun;
			argv = ["--user", "--collect", "--wait", "--pipe", "--quiet", "--unit=" + unit, "--property=Type=exec", "--property=KillMode=control-group", "--property=TimeoutStopSec=5s", process.execPath, fileURLToPath(new URL("./background-command.mjs", import.meta.url)), payload];
		}
		onStage({ installerUnit: unit });
		try {
			return await runCommand(command, argv, { ...installOptions, shell: targetContext.npm.shell, unit, onSpawn: trackPid });
		} finally {
			try { if (payload) fs.rmSync(payload, { force: true }); }
			catch { /* The background command also removes its payload before running npm. */ }
		}
	};

	const installAndVerify = async ({ isolated, targetContext, installOptions, verifyOptions }) => {
		const phase = isolated ? "preflight-" : "";
		const base = ["install", "-g", "--prefix", targetContext.prefix, "--no-audit", "--no-fund"];
		let blocked = false;
		let install;
		let check;
		for (let attempt = 0; attempt < 2; attempt++) {
			if (attempt && blocked && allowAllScripts === undefined && allowScriptsArgs.length) {
				const probe = await runCommand(context.npm.command, [...context.npm.argsPrefix, "config", "get", "dangerously-allow-all-scripts"], { ...installOptions, timeoutMs: 15000 });
				allowAllScripts = probe.ok && /^(?:true|false)$/i.test((probe.stdout || "").trim());
			}
			const args = attempt && blocked && allowAllScripts ? ["--dangerously-allow-all-scripts"] : allowScriptsArgs;
			if (!isolated) onStage({ stage: attempt ? "retrying" : "installing" });
			failureStage = isolated ? "preflight" : "installing";
			install = await runNpm([...base, ...args, ...(attempt ? ["--force"] : [])], targetContext, installOptions, phase + attempt);
			writersStopped = install.stopped;
			if (!isolated) result = install;
			const installReason = install.timedOut ? "npm 安装超时" : !install.stopped ? "无法确认 npm 安装进程已停止" : "npm 安装命令失败";
			checks.push(updateCheck(phase + "install", { ...install, issue: install.ok ? undefined : install.timedOut ? "install-timeout" : undefined, reason: install.ok ? undefined : installReason }, env));
			output.push(install.out);
			if (install.stopped) onStage({ installerPid: null, installerUnit: null });
			if (!install.stopped || install.timedOut) return { install };
			if (install.ok) {
				failureStage = isolated ? "preflight" : "verifying";
				if (!isolated) onStage({ stage: "verifying" });
				check = await verifyInstall(targetContext, target, install.out, { ...verifyOptions, onSpawn: trackPid });
				writersStopped = check.stopped;
				checks.push(updateCheck(phase + "cli", check, env));
				if (check.stopped) onStage({ installerPid: null });
				if (check.ok) return { ok: true, selfHealed: attempt > 0 };
				output.push(check.reason + (check.detail ? "：" + check.detail : ""));
			} else {
				check = { stopped: true };
				output.push("npm 安装命令失败");
			}
			blocked = BLOCKED_SCRIPTS.test(install.out);
			if (!check.stopped || check.timedOut || ["module-export", "node-version"].includes(check.issue) || isolated && !blocked) break;
		}
		return { install };
	};

	try {
		if (!semver.gt(target, context.currentVersion)) throw new Error("仅支持安装比当前更新的版本");
		if (config.preflight) {
			onStage({ stage: "preflight" });
			const incompatible = nodeCompatibility(config.nodeRange);
			if (incompatible) {
				checks.push(updateCheck("preflight-node", incompatible, env));
				return complete({ ok: false, installedVersion: context.currentVersion, error: incompatible.reason });
			}
		}
		if (!allowScriptsArgs) {
			if (!config.preflight) onStage({ stage: "checking-npm" });
			const probe = await runCommand(context.npm.command, [...context.npm.argsPrefix, "--version"], { ...options, timeoutMs: 15000 });
			const major = probe.ok ? Number(/^(\d+)/.exec((probe.stdout || "").trim())?.[1]) : NaN;
			allowScriptsArgs = major >= 12 && config.allowScriptNames?.length ? ["--allow-scripts=" + config.allowScriptNames.join(",")] : [];
		}
		if (config.preflight) {
			const directory = fs.mkdtempSync(path.join(config.jobDir || os.tmpdir(), "preflight-"));
			try {
				const isolation = preflightEnvironment(directory, env);
				const targetContext = { ...isolation.context, npm: context.npm };
				const installOptions = { ...options, env: isolation.npmEnv, cwd: targetContext.prefix };
				const verifyOptions = { ...options, env: isolation.runtimeEnv, cwd: directory, checkNodeCompatibility: true };
				const trial = await installAndVerify({ isolated: true, targetContext, installOptions, verifyOptions });
				if (!trial.ok) {
					return complete({
						ok: false, installedVersion: context.currentVersion, code: trial.install.code, timedOut: trial.install.timedOut,
						out: output.join("\n").slice(-5000), error: "隔离预检失败，当前安装保持原版本"
					});
				}
				if (config.restart) {
					const web = await checkPreflightWeb(targetContext, { ...verifyOptions, onSpawn: trackPid });
					writersStopped = web.stopped;
					checks.push(updateCheck("preflight-web", web, env));
					if (writersStopped) onStage({ installerPid: null });
					if (!web.ok) {
						return complete({
							ok: false, installedVersion: context.currentVersion, timedOut: web.timedOut,
							out: (web.reason + "\n" + web.out).slice(-5000), error: "隔离 Web 预检失败，当前安装保持原版本"
						});
					}
				}
				if (config.dshHome) {
					try { preflightWarnings = pluginPeerWarningsFor(config.dshHome, targetContext.installRoot); }
					catch { preflightWarnings = [{ error: "无法扫描已安装插件的兼容性" }]; }
				}
			} finally {
				if (writersStopped) {
					try { fs.rmSync(directory, { recursive: true, force: true }); }
					catch (error) { output.push("无法清理隔离目录：" + error.message); }
				}
			}
			output.length = 0;
		}
		failureStage = "snapshotting";
		onStage({ stage: "snapshotting", preflightWarnings, diagnostic: diagnostic() });
		saved = snapshotInstall(context, backupDir);
		onStage({ stage: "installing", backup: saved.snapshot });
		const live = await installAndVerify({ isolated: false, targetContext: context, installOptions: options, verifyOptions: options });
		if (live.ok) return complete({ ok: true, selfHealed: live.selfHealed, installedVersion: target, backup: saved.snapshot, failureStage: undefined });
	} catch (error) {
		output.push(error.message);
		checks.push(updateCheck(failureStage, { ok: false, reason: error.message }, env));
	}
	if (!saved) return complete({
		ok: false, installedVersion: context.currentVersion, out: output.join("\n"),
		error: failureStage === "preflight" ? "隔离预检失败，当前安装保持原版本" : "创建回滚快照失败，未执行安装"
	});
	if (!writersStopped) return complete({
		ok: false, needsRecovery: true, backup: saved.snapshot, out: output.join("\n"),
		error: "无法确认安装进程树已停止，已保留快照并禁止并发回滚"
	});
	try { onStage({ stage: "rolling-back", installerPid: null, diagnostic: diagnostic() }); } catch { /* Recovery must continue if status storage fails. */ }
	const rollback = await restoreSnapshot(context, saved, { ...options, onSpawn: trackPid });
	return complete({
		ok: false, rolledBack: rollback.ok, needsRecovery: !rollback.ok,
		installedVersion: rollback.ok ? saved.version : null, backup: rollback.ok ? null : saved.snapshot,
		out: [...output, rollback.ok ? "已自动回滚到 " + saved.version : "自动回滚失败：" + rollback.error + "；快照保留于 " + saved.snapshot].join("\n").slice(-5000),
		error: rollback.ok ? "安装未通过健康校验，已恢复旧版" : "安装失败且自动回滚未完成"
	});
}
