// dsh-about 卸载清理钩子（package.json "scripts".postuninstall）：
// 由 `dsh plugin --profile <name> remove dsh-about` 触发（pnpm remove 执行生命周期脚本）。
// 职责：删除插件运行期在宿主之外产生的全部痕迹，保证「拔除即干净、零残留」。
// 本脚本只清理 dsh-about / dsh-watchdog 明确写入的路径，绝不越界删除用户数据。
import { rmSync, existsSync } from "node:fs";
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
process.stdout.write(
	cleaned > 0
		? `[dsh-about] 卸载完成：已清理 ${cleaned} 项运行期残留。\n`
		: "[dsh-about] 卸载完成：未发现插件运行期残留。\n"
);
process.stdout.write("[dsh-about] 提示：若曾手动执行过 `cp bin/dsh-watchdog ~/.local/bin/`，请自行删除该文件（插件本身使用包内副本，不受影响）。\n");