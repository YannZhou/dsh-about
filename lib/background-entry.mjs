import fs from "node:fs";
import { pathToFileURL } from "node:url";
const payloadFile = process.argv[2];
const payload = JSON.parse(fs.readFileSync(payloadFile, "utf8"));
// Credentials stay in a 0600 file, never in systemd-run command arguments.
fs.rmSync(payloadFile);
for (const key of Object.keys(process.env)) delete process.env[key];
Object.assign(process.env, payload.env);
process.argv = [process.execPath, payload.script, ...payload.args];
await import(pathToFileURL(payload.script).href);
