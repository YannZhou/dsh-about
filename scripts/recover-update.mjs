import os from "node:os";
import path from "node:path";
import { recoverUpdate } from "../lib/update-recovery.mjs";
const directory = path.join(process.env.DSH_HOME || path.join(os.homedir(), ".dsh"), "dsh-about");
try {
	const args = process.argv.slice(2);
	if (args.length && (args.length !== 2 || args[0] !== "--profile" || !args[1])) throw new Error("用法：node scripts/recover-update.mjs [--profile <名称>]");
	const result = await recoverUpdate(directory, { profile: args[1] });
	if (!result.ok) throw new Error(result.error);
	console.log(result.kind === "plugin"
		? `[dsh-about] 已验证 ${result.profile} 中的插件 ${result.version} 并解除更新阻塞，请重新启动 dsh。`
		: `[dsh-about] 已恢复 dsh ${result.version}，可以重新启动服务并检查更新。`);
} catch (error) {
	console.error(`[dsh-about] ${error.message}`);
	process.exitCode = 1;
}
