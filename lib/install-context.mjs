import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import * as semver from "./semver.js";

export const DSH_PACKAGE = "@deepseek-ai/dsh";

export function packageRootFromEntry(entry, spec) {
	try {
		let dir = path.dirname(fs.realpathSync(entry));
		for (;;) {
			try { if (JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8")).name === spec) return dir; } catch {}
			const parent = path.dirname(dir);
			if (parent === dir) return null;
			dir = parent;
		}
	} catch { return null; }
}

export function cliEntry(root) {
	try {
		const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
		const rel = typeof pkg.bin === "string" ? pkg.bin : pkg.bin?.dsh;
		if (typeof rel !== "string") return null;
		const entry = path.resolve(root, rel);
		if (!entry.startsWith(path.resolve(root) + path.sep)) return null;
		return entry;
	} catch { return null; }
}

/** Prefer npm belonging to the active Node, including nvm installations. Running
 * npm's JS entry with this Node also avoids Windows cmd quoting altogether. */
export function resolveNpmCommand() {
	const nodeDir = path.dirname(process.execPath);
	const candidates = [
		path.join(nodeDir, "node_modules", "npm", "bin", "npm-cli.js"),
		path.join(nodeDir, "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"),
		...((process.env.PATH || "").split(path.delimiter).filter(Boolean).map((dir) => path.join(dir, process.platform === "win32" ? "npm.cmd" : "npm")))
	];
	for (const candidate of candidates) {
		try {
			const real = fs.realpathSync(candidate);
			if (real.endsWith("npm-cli.js")) return { command: process.execPath, argsPrefix: [real], shell: false };
			const sibling = path.join(path.dirname(real), "node_modules", "npm", "bin", "npm-cli.js");
			if (fs.existsSync(sibling)) return { command: process.execPath, argsPrefix: [sibling], shell: false };
			if (process.platform !== "win32") { fs.accessSync(real, fs.constants.X_OK); return { command: real, argsPrefix: [], shell: false }; }
		} catch {}
	}
	throw new Error("无法定位与当前 Node 配套的 npm CLI");
}

export function resolveInstallContext(root, npm = resolveNpmCommand()) {
	if (!root) throw new Error("无法定位正在运行的 dsh 包");
	const real = fs.realpathSync(root);
	// Ask this npm for its configured prefix, then ensure it is the same install.
	const query = spawnSync(npm.command, [...npm.argsPrefix, "prefix", "-g"], { encoding: "utf8", timeout: 15000, windowsHide: true, shell: npm.shell });
	const configured = query.status === 0 ? query.stdout.trim() : null;
	const suffix = path.join("node_modules", "@deepseek-ai", "dsh");
	const inferred = real.endsWith(path.join("lib", suffix))
		? real.slice(0, -path.join("lib", suffix).length)
		: process.platform === "win32" && real.endsWith(suffix) ? real.slice(0, -suffix.length) : null;
	for (const prefix of [configured, inferred].filter(Boolean)) {
		const installRoot = path.join(prefix, process.platform === "win32" ? "" : "lib", suffix);
		try {
			if (fs.realpathSync(installRoot) !== real) continue;
			const pkg = JSON.parse(fs.readFileSync(path.join(installRoot, "package.json"), "utf8"));
			if (!semver.valid(pkg.version)) throw new Error("当前 dsh 版本号无效");
			return { installRoot, prefix: path.resolve(prefix), binDir: process.platform === "win32" ? path.resolve(prefix) : path.join(prefix, "bin"), currentVersion: pkg.version, npm };
		} catch (error) { if (error.message === "当前 dsh 版本号无效") throw error; }
	}
	throw new Error("运行中的 dsh 不属于可确认的 npm 全局安装目录，请在原安装目录手动更新");
}

export function ensureCliLink(context) {
	const entry = cliEntry(context.installRoot);
	if (!entry || !fs.existsSync(entry)) throw new Error("无法定位 dsh 包内的 bin.dsh 入口");
	fs.mkdirSync(context.binDir, { recursive: true });
	const link = path.join(context.binDir, "dsh");
	if (process.platform === "win32") {
		// npm normally creates these shims. Repair them for rollback and partial installs.
		const relative = path.relative(context.binDir, entry).replaceAll("/", "\\");
		if (/["%\r\n]/.test(relative)) throw new Error("dsh 入口路径无法安全写入 Windows 启动脚本");
		fs.writeFileSync(`${link}.cmd`, `@ECHO off\r\n@SETLOCAL DisableDelayedExpansion\r\n"${process.execPath.replaceAll("%", "%%")}" "%~dp0${relative}" %*\r\n`);
		const psQuote = (value) => "'" + value.replaceAll("'", "''") + "'";
		fs.writeFileSync(`${link}.ps1`, `& ${psQuote(process.execPath)} ${psQuote(entry)} @args\r\nexit $LASTEXITCODE\r\n`);
		const quote = (value) => "'" + value.replaceAll("'", "'\\''") + "'";
		fs.writeFileSync(link, `#!/bin/sh\nexec ${quote(process.execPath.replaceAll("\\", "/"))} ${quote(entry.replaceAll("\\", "/"))} "$@"\n`);
	} else {
		fs.accessSync(entry, fs.constants.X_OK);
		try { if (fs.realpathSync(link) === fs.realpathSync(entry)) return entry; } catch {}
		const temp = path.join(context.binDir, `.dsh-link-${process.pid}-${Date.now()}`);
		try { fs.symlinkSync(path.relative(context.binDir, entry), temp); fs.renameSync(temp, link); }
		finally { fs.rmSync(temp, { force: true }); }
	}
	return entry;
}

export function pluginPeerWarningsFor(dshHome, hostRoot) {
	const warnings = [];
	const profiles = path.join(dshHome, "profiles");
	if (!fs.existsSync(profiles)) return warnings;
	for (const profile of fs.readdirSync(profiles)) {
		if (profile === "node_modules" || profile.startsWith(".")) continue;
		const modules = path.join(profiles, profile, "node_modules");
		if (!fs.existsSync(modules)) continue;
		try {
			const roots = [];
			for (const name of fs.readdirSync(modules)) {
				if (name.startsWith(".")) continue;
				const dir = path.join(modules, name);
				try {
					if (!fs.statSync(dir).isDirectory()) continue;
					if (name.startsWith("@")) for (const child of fs.readdirSync(dir)) roots.push(path.join(dir, child));
					else roots.push(dir);
				} catch { /* Dangling links do not identify installed plugins. */ }
			}
			for (const root of roots) {
				let pkg;
				try { pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")); } catch { continue; }
				const mismatches = [];
				for (const [peer, range] of Object.entries(pkg.peerDependencies ?? {})) {
					if (!peer.startsWith("@deepseek-ai/dsh-")) continue;
					let provider = null;
					// Use the same profile/host resolution anchors as the plugin loader.
					for (const anchor of [path.join(modules, "_peer.cjs"), hostRoot && path.join(hostRoot, "package.json")].filter(Boolean)) {
						try {
							const req = createRequire(anchor);
							try { provider = JSON.parse(fs.readFileSync(req.resolve(`${peer}/package.json`), "utf8")); }
							catch { const found = packageRootFromEntry(req.resolve(peer), peer); if (found) provider = JSON.parse(fs.readFileSync(path.join(found, "package.json"), "utf8")); }
						} catch {}
						if (provider) break;
					}
					if (!provider) {
						if (pkg.peerDependenciesMeta?.[peer]?.optional !== true) mismatches.push(`${peer}: needs ${range}, not installed`);
						continue;
					}
					// Match dsh-app-boot's plugin compatibility policy: prereleases
					// participate in declared host-package ranges.
					const matches = semver.satisfies(provider.version, range, { includePrerelease: true });
					if (matches !== true) mismatches.push(matches === null ? `${peer}: cannot evaluate peer range ${range}` : `${peer}: needs ${range}, has ${provider.version}`);
				}
				if (mismatches.length) warnings.push({ profile, plugin: pkg.name, version: pkg.version, mismatches });
			}
		} catch (error) { warnings.push({ profile, error: `插件兼容性扫描失败：${error.message}` }); }
	}
	return warnings;
}
