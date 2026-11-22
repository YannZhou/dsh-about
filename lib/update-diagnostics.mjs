import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as semver from "./semver.js";
import { readJson, readUpdateStatus, writeJsonAtomic } from "./update-state.mjs";

export function redactUpdateOutput(value, env = process.env) {
	let text = String(value ?? "").replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");
	for (const [key, secret] of Object.entries(env)) {
		if (/(?:token|password|passwd|secret|api[-_]?key)/i.test(key) && typeof secret === "string" && secret.length >= 6) {
			text = text.replaceAll(secret, "[已隐藏]");
		}
	}
	const home = os.homedir();
	if (home && home !== path.parse(home).root) text = text.replaceAll(home, "~");
	return text
		.replace(/(\bhttps?:\/\/)[^\s/@]+@/gi, "$1[已隐藏]@")
		.replace(/(?:\b(?:gh[pousr]_|github_pat_|npm_|sk-)[\w-]{12,}|\bBearer\s+\S+)/gi, "[已隐藏]")
		.replace(/((?:\b[\w-]*(?:token|password|passwd|secret|api[-_]?key)\b|_auth)\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s&;,]+)/gi, "$1[已隐藏]");
}

export function missingModuleExport(output) {
	const match = /(?:requested module|export)\s+['"]([^'"]+)['"]\s+does not provide an export named\s+['"]([^'"]+)['"]/.exec(output);
	return match ? { package: match[1], name: match[2] } : null;
}

function primaryError(output) {
	const lines = String(output ?? "").split(/\r?\n/).map((line) => line.trim());
	return lines.find((line) => /^(?:SyntaxError|TypeError|ReferenceError|Error\s*(?:\[[^\]]+\])?|npm (?:error|ERR!) code)\s*[: ]/.test(line)) || "";
}

export function updateCheck(phase, result, env) {
	const { ok, code, timedOut, stopped, reason, issue, dependency } = result;
	return {
		phase, ok, code: code ?? null, timedOut: timedOut === true, stopped,
		reason: reason && redactUpdateOutput(reason, env), issue,
		dependency: dependency && { name: redactUpdateOutput(dependency.name, env), version: dependency.version && redactUpdateOutput(dependency.version, env) },
		error: !ok ? redactUpdateOutput(primaryError(result.stderr) || primaryError(result.out), env) : undefined,
		output: redactUpdateOutput(result.out, env).slice(-16000)
	};
}

function repairHint(issue, stage) {
	if (issue === "module-export") return stage === "preflight"
		? "隔离环境已复现缺失的模块导出。请核对发布包声明与实际解析到的依赖版本，确认修复版本后重新预检。"
		: "请在隔离环境复现并核对实际解析到的依赖版本。如果干净环境也失败，请将这份诊断交给上游。";
	if (issue === "node-version") return "请让运行 DSH 的宿主使用目标版本支持的 Node，再重新预检。";
	if (issue === "install-scripts") return "请核对 npm 输出中被拦截的安装脚本及其包名。";
	if (issue === "install-timeout") return stage === "preflight"
		? "隔离安装等待 npm 下载超时，多为网络或镜像较慢：请开启代理或切换更快的更新源后重试；本次未改动正式安装。"
		: "npm 安装等待超时，多为网络或镜像较慢：请开启代理或切换更快的更新源后重试；本次已自动回滚到旧版本。";
	if (issue === "web") return "请在临时数据目录复现 Web 启动失败，检查启动日志后再试。";
	return "可将这份诊断交给 Astra，在临时环境复现并验证修复。";
}

function buildReport(state) {
	if (state.inProgress || state.result?.ok !== false) return null;
	const result = state.result;
	const recorded = result.checks || state.diagnostic?.checks;
	const exportError = missingModuleExport(result.out);
	const checks = Array.isArray(recorded) ? recorded : exportError && result.code === 0 && state.kind !== "plugin" ? [
		updateCheck("install", { ok: true, code: 0 }),
		updateCheck("cli", { ok: false, issue: "module-export", out: result.out })
	] : [];
	const failed = state.stage === "interrupted" && result.failureStage !== state.diagnostic?.failureStage
		? null : checks.findLast((check) => !check.ok);
	const issue = failed?.issue || (exportError ? "module-export" : undefined);
	const stage = result.failureStage || state.diagnostic?.failureStage || (exportError ? "verifying" : state.stage);
	const summary = redactUpdateOutput(failed?.error || failed?.reason || primaryError(result.out) || result.error);
	return {
		id: state.id ?? null,
		kind: state.kind ?? "dsh",
		target: state.target ?? null,
		currentVersion: result.currentVersion ?? state.diagnostic?.currentVersion ?? state.currentVersion ?? (result.rolledBack ? result.installedVersion : null) ?? null,
		finishedAt: state.finishedAt ?? state.updatedAt ?? null,
		stage, issue, summary,
		rolledBack: result.rolledBack ?? state.diagnostic?.rolledBack ?? null,
		installedVersion: result.installedVersion ?? null,
		needsRecovery: state.needsRecovery === true,
		restartError: result.lastRestartError && redactUpdateOutput(result.lastRestartError),
		checks, output: redactUpdateOutput(result.out).slice(-16000),
		hint: repairHint(issue, stage)
	};
}

const latestFailure = (directory) => path.join(directory, "last-update-failure.json");

/** The version a report complained about, per its own task kind. */
function installedVersionFor(report, installed) {
	return report.kind === "plugin" ? installed?.plugin : installed?.dsh;
}

/** Kept on disk for the history, but only surfaced while the target it failed
 * to install is newer than what is actually installed. "target <= installed"
 * means the update has landed (or the running version already surpassed it), so
 * the failure is no longer current — never delete the record, just hide it. */
function supersededReport(report, installed) {
	const target = semver.valid(report.target);
	if (target === null) return false;
	const comparison = semver.compare(target, installedVersionFor(report, installed));
	return comparison === comparison && comparison <= 0;
}

/** A completed success of the same kind supersedes a stored failure record. */
function succeededAfter(state, report) {
	if (state?.inProgress !== false || state.result?.ok !== true) return false;
	if ((state.kind ?? "dsh") !== (report.kind ?? "dsh")) return false;
	return Number(state.finishedAt ?? state.updatedAt ?? 0) >= Number(report.finishedAt ?? 0);
}

function sanitizedReport(report) {
	return {
		...report,
		summary: report.summary && redactUpdateOutput(report.summary),
		output: report.output && redactUpdateOutput(report.output).slice(-16000),
		restartError: report.restartError && redactUpdateOutput(report.restartError),
		checks: Array.isArray(report.checks) ? report.checks.map((check) => ({
			...check,
			reason: check.reason && redactUpdateOutput(check.reason),
			error: check.error && redactUpdateOutput(check.error),
			output: check.output && redactUpdateOutput(check.output).slice(-16000)
		})) : report.checks
	};
}

export function recordUpdateFailure(directory, state) {
	const report = buildReport(state);
	if (!report) return;
	try {
		if (/^[\w-]{1,80}$/.test(report.id || "")) {
			writeJsonAtomic(path.join(directory, "jobs", report.id, "failure.json"), report);
		}
		writeJsonAtomic(latestFailure(directory), report);
	} catch { /* update-state.json remains available for diagnosis and recovery. */ }
}

/** Every recorded failure, newest first. History survives later successful
 * updates on purpose; only the display decision (`superseded`) changes. */
export function updateFailureHistory(directory, { installed = null, limit = 20 } = {}) {
	const reports = new Map();
	const add = (report) => {
		if (!report || typeof report !== "object") return;
		const key = [report.id ?? "", report.finishedAt ?? "", report.target ?? ""].join("\u0000");
		if (!reports.has(key)) reports.set(key, report);
	};
	try {
		const jobs = path.join(directory, "jobs");
		for (const name of fs.readdirSync(jobs)) {
			if (!/^[\w-]{1,80}$/.test(name)) continue;
			add(readJson(path.join(jobs, name, "failure.json")));
		}
	} catch { /* No job directory yet. */ }
	add(readJson(latestFailure(directory)));
	return [...reports.values()]
		.sort((left, right) => Number(right.finishedAt ?? 0) - Number(left.finishedAt ?? 0))
		.slice(0, Math.max(1, limit))
		.map((report) => ({ ...sanitizedReport(report), superseded: supersededReport(report, installed) }));
}

/** Latest failure that still describes the current installation.
 * `installed` carries the versions actually on disk ("dsh" / "plugin"). */
export function lastUpdateFailure(directory, state = readUpdateStatus(directory), installed = null) {
	const report = buildReport(state);
	if (report) return supersededReport(report, installed) ? null : report;
	const stored = readJson(latestFailure(directory));
	if (!stored || state?.inProgress === true) return null;
	if (supersededReport(stored, installed) || succeededAfter(state, stored)) return null;
	return stored;
}
