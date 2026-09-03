// dsh-about 卸载清理钩子（package.json "scripts".postuninstall）：
// 由 `dsh plugin --profile <name> remove dsh-about` 触发（pnpm remove 执行生命周期脚本）。
// 职责：删除插件运行期在宿主之外产生的全部痕迹，保证「拔除即干净、零残留」。
// 本脚本只清理 dsh-about / dsh-watchdog 明确写入的路径，绝不越界删除用户数据。
import { rmSync, existsSync, readdirSync, lstatSync, readFileSync } from "node:fs";
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
process.stdout.write(
	cleaned > 0
		? `[dsh-about] 卸载完成：已清理 ${cleaned} 项运行期残留。\n`
		: "[dsh-about] 卸载完成：未发现插件运行期残留。\n"
);
process.stdout.write("[dsh-about] 提示：若曾手动执行过 `cp bin/dsh-watchdog ~/.local/bin/`，请自行删除该文件（插件本身使用包内副本，不受影响）。\n");