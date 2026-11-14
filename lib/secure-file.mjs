import fs from "node:fs";

/** npmrc may contain registry credentials. Exclusive creation prevents following
 * an existing link; tighten an older backup before leaving it in place. */
export function secureBackup(file, contents) {
	try { fs.writeFileSync(file, contents, { encoding: "utf8", flag: "wx", mode: 0o600 }); }
	catch (error) {
		if (error.code !== "EEXIST") throw error;
		const info = fs.lstatSync(file);
		if (!info.isFile() || info.isSymbolicLink()) throw new Error("备份路径不是普通文件");
		fs.chmodSync(file, 0o600);
	}
}
