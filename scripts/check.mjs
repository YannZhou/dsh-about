import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
for (const dir of ["lib", "bin", "scripts", "test"]) {
	const walk = (directory) => {
		for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
			const file = path.join(directory, entry.name);
			if (entry.isDirectory()) walk(file);
			else if (/\.(?:js|mjs)$/.test(entry.name)) {
				const result = spawnSync(process.execPath, ["--check", file], { stdio: "inherit", windowsHide: true });
				if (result.status !== 0) process.exit(result.status ?? 1);
			}
		}
	};
	walk(path.join(root, dir));
}
