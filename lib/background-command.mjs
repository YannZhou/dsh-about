import fs from "node:fs";
import { spawn } from "node:child_process";
const payloadFile = process.argv[2];
const payload = JSON.parse(fs.readFileSync(payloadFile, "utf8"));
fs.rmSync(payloadFile);
const child = spawn(payload.command, payload.args, { env: payload.env, cwd: payload.cwd, stdio: "inherit", windowsHide: true });
child.once("error", (error) => { console.error(error.message); process.exitCode = 1; });
child.once("close", (code) => { process.exitCode = code ?? 1; });
