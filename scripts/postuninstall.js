// dsh-about 卸载清理钩子（package.json "scripts".postuninstall）：
// 由 `dsh plugin --profile <name> remove dsh-about` 触发（pnpm remove 执行生命周期脚本）。
// 职责：删除插件运行期在宿主之外产生的全部痕迹，保证「拔除即干净、零残留」。
// 本脚本只清理 dsh-about / dsh-watchdog 明确写入的路径，绝不越界删除用户数据。
import { rmSync, existsSync, readdirSync, lstatSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const home = process.env.DSH_HOME || path.join(os.homedir(), ".dsh");
const targets = [
	path.join(home, "dsh-about"), // 插件数据目录（版本记录缓存 releases-cache.json / 更新源 source.json）
	path.join(home, "dsh-about-restart.log"), // 旧版内嵌看护遗留日志
	path.join(home, "dsh-watchdog.log"), // once 一次性看护决策日志
	path.join(home, ".dsh-watchdog.lock"), // 常驻看护单实例锁（如有）
	path.join(home, ".dsh-watchdog-once.lock") // once 锁（如有）
];

let cleaned = 0;
for (const target of targets) {
	try {
		if (existsSync(target)) {
			rmSync(target, { recursive: true, force: true });
			cleaned += 1;
			process.stdout.write(`[dsh-about] 已清理残留: ${target}\n`);
		}
	} catch (error) {
		process.stdout.write(`[dsh-about] 清理 ${target} 失败(已忽略): ${String(error.message)}\n`);
	}
}

// ── 残留的包实体目录：pnpm remove 之后插件实体可能残留在三类位置 ──
//   1) <profile>/node_modules/@yannzhou/dsh-about（scoped：新安装）或 node_modules/dsh-about（旧裸名）
//   2) <profile>/.dsh-module-fallback/node_modules/<name>（该 profile 的模块回退镜像）
//   3) $DSH_HOME/profiles/node_modules/<name>（跨 profile 共享的模块回退镜像；
//      只随 dsh-install 依赖闭包自动维护，本包不在闭包内故从不会被自动清理）
// 清理守则（绝不越界删用户数据）：仅当「没有任何」profile 的 package.json 仍声明
// 本包（dependencies/devDependencies 与 dsh.profile.bundles 均无）时才删除。
// 本钩子由 `dsh plugin remove`（pnpm remove）触发，此时 bundles 已对账，判断才准确。
//
// 包名双形态：scoped @yannzhou/dsh-about（当前发布名）与旧裸名 dsh-about（改名前的遗留
// 安装）。清理时两种形态的实体目录都要考虑，判断「是否仍在声明」必须命中两者。
const PACKAGE_NAMES = ["@yannzhou/dsh-about", "dsh-about"];
function manifestDeclares(manifest) {
	try {
		const text = readFileSync(manifest, "utf8");
		// 命中任何形式的包名（scoped 串前导是 "/" 而非引号，故用子串 includes 命中两者；
		// 每个候选都带引号，避免误命中 null/裸串形式的相邻文本）
		return PACKAGE_NAMES.some((name) => text.includes(`"${name}"`));
	} catch {
		return true; // 清单读不到时保守保留，绝不误删
	}
}

const profilesRoot = path.join(home, "profiles");
let profiles;
try {
	profiles = readdirSync(profilesRoot, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => path.join(profilesRoot, entry.name))
		.filter((dir) => existsSync(path.join(dir, "package.json")));
} catch {
	profiles = [];
}

let stillDeclared = profiles.some((dir) => manifestDeclares(path.join(dir, "package.json")));

function removeIfUnused(entityDir, describe) {
	let isLink = false;
	let exists;
	try {
		exists = existsSync(entityDir);
		if (exists) isLink = lstatSync(entityDir).isSymbolicLink();
	} catch {
		return; // 不存在或读不到 → 无需清理，静默
	}
	if (!exists && !isLink) return;
	try {
		rmSync(entityDir, { recursive: true, force: true });
		cleaned += 1;
		process.stdout.write(`[dsh-about] 已清理残留: ${entityDir} (${describe})\n`);
	} catch (error) {
		process.stdout.write(`[dsh-about] 清理 ${entityDir} 失败(已忽略): ${String(error.message)}\n`);
	}
}

// 1) 各 profile 自身 node_modules（对 scoped 与裸名两种形态各探一次）
for (const dir of profiles) {
	const manifest = path.join(dir, "package.json");
	if (manifestDeclares(manifest)) continue;
	for (const name of PACKAGE_NAMES) {
		removeIfUnused(path.join(dir, "node_modules", name), "remove 后遗留的包实体目录");
	}
}

// 2) 各 profile 的 .dsh-module-fallback 回退镜像
for (const dir of profiles) {
	const manifest = path.join(dir, "package.json");
	if (manifestDeclares(manifest)) continue;
	for (const name of PACKAGE_NAMES) {
		removeIfUnused(path.join(dir, ".dsh-module-fallback", "node_modules", name), "profile 模块回退镜像");
	}
}

// 3) 跨 profile 共享回退镜像：任一 profile 仍声明即保留；两种形态各探一次
for (const name of PACKAGE_NAMES) {
	const sharedMirror = path.join(profilesRoot, "node_modules", name);
	const sharedExists = existsSync(sharedMirror) || lstatSyncSafe(sharedMirror);
	if (stillDeclared && sharedExists) {
		process.stdout.write(`[dsh-about] 保留（仍有 profile 声明）: ${sharedMirror}\n`);
	} else {
		removeIfUnused(sharedMirror, "共享模块回退镜像");
	}
}

function lstatSyncSafe(p) {
	try {
		return lstatSync(p).isSymbolicLink();
	} catch {
		return false;
	}
}
// ── npm ≥ 12 的 allow-scripts 白名单（写在**用户级** ~/.npmrc）──
// 插件运行期（仅当 npm ≥ 12）会往用户级 .npmrc 追加 dsh 原生依赖的 allow-scripts
// 条目，让「用户手动 npm install -g 升级 dsh」也能跑通原生模块的安装脚本。
//
// 为什么是用户级而不是 profile 级：npm 自己的官方建议就是
// `npm config set allow-scripts=... --location=user`，且**用户级是唯一对
// `npm install -g` 生效的层**——profile 级 .npmrc 只在 dsh 自己的安装流程里被读到，
// 改过去会把「手动升级」这条兜底路径打断（取舍结论见交付包 §4-L3）。
//
// 卸载时**默认保留**这些条目：它们保护的是 dsh 本体的手动升级，
// 删掉会让用户下次 `npm install -g @deepseek-ai/dsh` 因脚本被拦而装出坏掉的 dsh。
// 确实要清干净（例如连 dsh 也一并卸载了）时显式开：
//     DSH_ABOUT_NPMRC_CLEANUP=1 dsh plugin --profile web remove dsh-about
// 清理只动「本插件已知的 dsh 原生依赖包名」，用户自己的其它 allow-scripts 条目、
// 以及 registry 凭据等一律原样保留；改写前先备份。
// ⚠️ 包名清单与 lib/index.js 的 DSHA_KNOWN_NATIVE_DEPS 保持一致（那不能直接 import：
//    本脚本由卸载流程直接执行，引入 lib/index.js 会连带拉起宿主侧依赖）。
const DSHA_NATIVE_DEPS = ["fs-ext", "koffi", "node-pty", "protobufjs", "@google/genai", "@deepseek-ai/dsh-subprocess-local"];
const DSHA_ALLOW_MARK_PREFIX = "# dsh-about: npm>=12 allow-scripts";

/** 按需清理本插件写进用户 .npmrc 的 allow-scripts 条目（返回清理项数，0 表示未改动）。 */
function cleanAllowScriptsEntries() {
	const rcPath = process.env.NPM_CONFIG_USERCONFIG || path.join(os.homedir(), ".npmrc");
	let raw;
	try {
		raw = readFileSync(rcPath, "utf8");
	} catch {
		return 0; // 没有 .npmrc，无事可做
	}
	const remove = new Set(DSHA_NATIVE_DEPS);
	const entries = [];
	let touched = false;
	for (const line of raw.split(/\r?\n/)) {
		if (line.trim().startsWith(DSHA_ALLOW_MARK_PREFIX)) {
			entries.push({ text: line, kind: "mark" });
			touched = true;
			continue;
		}
		const m = /^(\s*allow-scripts)(\s*\[\s*\])?(\s*=\s*)(.*?)(\s*)$/.exec(line);
		if (m === null) {
			entries.push({ text: line, kind: "line" });
			continue;
		}
		const names = m[4].split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter((s) => s !== "");
		const left = names.filter((n) => !remove.has(n));
		if (left.length === names.length) {
			entries.push({ text: line, kind: "line" }); // 与本插件无关的条目，原样保留
			continue;
		}
		touched = true;
		entries.push(left.length === 0 ? null : { text: `${m[1]}${m[2] ?? ""}${m[3]}${left.join(",")}${m[5] ?? ""}`, kind: "line" });
	}
	if (!touched) return 0;
	// 标记注释描述的就是「本插件写入的 dsh 原生依赖条目」：既然这次已经拆掉了自己的条目，
	// 标记就一并去掉，不留下悬空/误导的注释。
	const next = entries.filter((e) => e !== null && e.kind !== "mark").map((e) => e.text).join("\n");
	if (next === raw) return 0;
	try {
		const backup = `${rcPath}.dsh-about-uninstall.bak-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}`;
		if (!existsSync(backup)) writeFileSync(backup, raw, "utf8");
		writeFileSync(rcPath, next, "utf8");
		return 1;
	} catch {
		return 0;
	}
}

if (/^(1|on|true|yes)$/i.test(String(process.env.DSH_ABOUT_NPMRC_CLEANUP ?? "").trim())) {
	const n = cleanAllowScriptsEntries();
	process.stdout.write(
		n > 0
			? "[dsh-about] 已按 DSH_ABOUT_NPMRC_CLEANUP 清理用户 .npmrc 里的 allow-scripts 条目（已备份原文件）。\n"
			: "[dsh-about] DSH_ABOUT_NPMRC_CLEANUP 已开启，但 .npmrc 里没有本插件写入的 allow-scripts 条目。\n"
	);
} else {
	process.stdout.write(
		"[dsh-about] 提示：用户 .npmrc 里的 allow-scripts 白名单（如有）**已保留**——\n" +
			"           它保护的是「手动 npm install -g 升级 dsh」这条路，删掉会让下次升级装出缺原生模块的 dsh。\n" +
			"           确实要一并清掉时：DSH_ABOUT_NPMRC_CLEANUP=1 dsh plugin remove dsh-about\n"
	);
}

process.stdout.write(
	cleaned > 0
		? `[dsh-about] 卸载完成：已清理 ${cleaned} 项运行期残留。\n`
		: "[dsh-about] 卸载完成：未发现插件运行期残留。\n"
);
process.stdout.write("[dsh-about] 提示：若曾手动执行过 `cp bin/dsh-watchdog ~/.local/bin/`，请自行删除该文件（插件本身使用包内副本，不受影响）。\n");