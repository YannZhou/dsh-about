import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const directory = fileURLToPath(new URL("../test/", import.meta.url));
const files = fs.readdirSync(directory).filter((file) => file.endsWith(".test.mjs")).sort().map((file) => directory + file);
if (!files.length) throw new Error("未发现测试文件");
const result = spawnSync(process.execPath, ["--test", ...process.argv.slice(2), ...files], { stdio: "inherit", windowsHide: true });
process.exit(result.status ?? 1);
