import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { cliEntry } from "./install-context.mjs";
import { runCommand } from "./process-runner.mjs";
import * as semver from "./semver.js";

const osVariables = /^(?:path|pathext|systemroot|windir|comspec|systemdrive|lang|language|lc_\w+)$/i;

export function preflightEnvironment(directory, sourceEnv) {
	const prefix = path.join(directory, "npm");
	const home = path.join(directory, "home");
	const temp = path.join(directory, "tmp");
	const cache = path.join(home, ".cache");
	for (const folder of [prefix, home, temp, cache]) fs.mkdirSync(folder, { recursive: true, mode: 0o700 });
	const binDir = process.platform === "win32" ? prefix : path.join(prefix, "bin");
	const installRoot = path.join(prefix, process.platform === "win32" ? "" : "lib", "node_modules", "@deepseek-ai", "dsh");
	const sandbox = {
		HOME: home, USERPROFILE: home, DSH_HOME: path.join(home, ".dsh"),
		XDG_CONFIG_HOME: path.join(home, ".config"), XDG_DATA_HOME: path.join(home, ".local", "share"),
		XDG_CACHE_HOME: cache, XDG_STATE_HOME: path.join(home, ".local", "state"),
		XDG_RUNTIME_DIR: temp, APPDATA: path.join(home, "AppData", "Roaming"),
		LOCALAPPDATA: path.join(home, "AppData", "Local"), TMPDIR: temp, TEMP: temp, TMP: temp
	};
	if (process.platform === "win32") {
		const root = path.parse(home).root;
		Object.assign(sandbox, { HOMEDRIVE: root.slice(0, -1), HOMEPATH: home.slice(root.length - 1) });
	}
	const inherited = (name) => Object.entries(sourceEnv).find(([key]) => key.toLowerCase() === name)?.[1];
	const npmSettings = {
		npm_config_prefix: prefix,
		npm_config_cache: path.join(cache, "npm"),
		npm_config_userconfig: inherited("npm_config_userconfig") || path.join(os.homedir(), ".npmrc"),
		NODE_PATH: "", PATH: [binDir, inherited("path")].filter(Boolean).join(path.delimiter)
	};
	const overrides = new Set(Object.keys({ ...sandbox, ...npmSettings }).map((key) => key.toLowerCase()));
	const npmEnv = Object.fromEntries(Object.entries(sourceEnv).filter(([key]) =>
		!overrides.has(key.toLowerCase()) && !/^(?:dsh_|deepseek_|node_options$)/i.test(key)));
	Object.assign(npmEnv, sandbox, npmSettings);
	const runtimeEnv = Object.fromEntries(Object.entries(sourceEnv).filter(([key]) => osVariables.test(key) && key.toLowerCase() !== "path"));
	Object.assign(runtimeEnv, sandbox, { PATH: npmSettings.PATH });
	return { context: { prefix, binDir, installRoot }, npmEnv, runtimeEnv };
}

export function nodeCompatibility(range) {
	if (typeof range !== "string" || semver.satisfies(process.versions.node, range) !== false) return null;
	return {
		ok: false, stopped: true, issue: "node-version",
		reason: "目标版本要求 Node " + range + "，当前宿主使用 " + process.versions.node
	};
}

async function waitForWeb(readStdout, signal) {
	while (!signal.aborted) {
		const match = /^dsh web:\s+(http:\/\/127\.0\.0\.1:\d{1,5}\/[^\s]*)/m.exec(readStdout());
		if (match) {
			try {
				const url = new URL(match[1]);
				const response = await fetch(url, { signal, redirect: "manual" });
				await response.body?.cancel();
				if (response.ok) return;
				const location = response.headers.get("location");
				const cookie = response.headers.get("set-cookie")?.split(";", 1)[0];
				if (response.status === 303 && location && cookie) {
					const target = new URL(location, url);
					if (target.origin === url.origin) {
						const page = await fetch(target, { signal, redirect: "manual", headers: { cookie } });
						await page.body?.cancel();
						if (page.ok) return;
					}
				}
			} catch { /* Wait for the isolated server or the command deadline. */ }
		}
		await delay(200, undefined, { signal });
	}
}

export async function checkPreflightWeb(context, options) {
	const entry = cliEntry(context.installRoot);
	const result = await runCommand(process.execPath, [entry, "--profile", "web", "--host", "127.0.0.1", "--port", "0", "--no-open"], {
		...options, timeoutMs: options.webTimeoutMs ?? 30000, waitForReady: waitForWeb
	});
	return {
		...result, issue: "web",
		reason: result.ok ? undefined : result.timedOut ? "隔离环境中的 DSH Web 启动超时" : "隔离环境中的 DSH Web 未就绪"
	};
}
