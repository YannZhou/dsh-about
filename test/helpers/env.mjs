// 每个测试文件都在独立子进程里跑，并要求宿主半体在 import 时求值的所有常量
// （DATA_DIR / AUTH_FILE / SOURCE_FILE / 初始 token）都指向临时 DSH_HOME。
// 因此这里在 import 被测模块之前先建好临时目录并改写 process.env。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-about-test-"));
process.env.DSH_HOME = tmpRoot;
// 干净环境：不带外部 token，避免 effectiveGithubToken() 被环境变量污染
delete process.env.GITHUB_TOKEN;
// 关闭本插件对用户 ~/.npmrc 的写入（启动 3s 后的定时任务），测试不碰用户配置
process.env.DSH_ABOUT_NPMRC = "off";

export const DSH_HOME = tmpRoot;
export const AUTH_FILE = path.join(tmpRoot, "dsh-about", "auth.json");
export const DATA_DIR = path.join(tmpRoot, "dsh-about");

/** 直接读盘上的 auth.json（不经过被测代码），验证真实落盘内容。 */
export function readAuthFile() {
	try {
		return JSON.parse(fs.readFileSync(AUTH_FILE, "utf8"));
	} catch {
		return null;
	}
}

/** 文件权限（POSIX 语义）；Windows 上跳过。 */
export function authFileMode() {
	try {
		return fs.statSync(AUTH_FILE).mode & 0o777;
	} catch {
		return null;
	}
}

export function cleanup() {
	try {
		fs.rmSync(tmpRoot, { recursive: true, force: true });
	} catch {
		/* 尽力而为 */
	}
}
