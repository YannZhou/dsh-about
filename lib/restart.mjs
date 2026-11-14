import path from "node:path";
import { launchBackground } from "./background-launch.mjs";

export async function armWatchdog(spec, directory, watchdog, systemdRun) {
	const readyFile = path.join(directory, "watchdog-ready.json");
	const env = {
		...process.env, DSH_WATCH_PID: String(spec.pid), DSH_WATCH_PORT: String(spec.port),
		DSH_WATCH_ARGV: JSON.stringify(spec.argv), DSH_WATCH_UNIT: spec.unit || "dsh-web",
		DSH_WATCH_READY: readyFile, DSH_WATCH_IN_TRANSIENT: systemdRun ? "1" : "0"
	};
	await launchBackground(watchdog, ["once"], { directory, env, readyFile, systemdRun });
	return true;
}
