import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { makeFixture } from "./helpers/update-fixture.mjs";
import { runUpdateTransaction, snapshotInstall, restoreSnapshot, verifyInstall } from "../lib/update-transaction.mjs";
import { resolveInstallContext, cliEntry, packageRootFromEntry, resolveNpmCommand } from "../lib/install-context.mjs";
import { runCommand } from "../lib/process-runner.mjs";
import { startUpdateJob, waitForUpdateJob } from "../lib/update-jobs.mjs";
import { acquireUpdateLock, releaseUpdateLock, readUpdateStatus, writeJsonAtomic, readJson, processIdentity, ownerAlive, sleep } from "../lib/update-state.mjs";
import { launchBackground } from "../lib/background-launch.mjs";

async function until(predicate, timeout = 10000) {
 const deadline = Date.now() + timeout;
 while (Date.now() < deadline) { if (await predicate()) return; await sleep(25); }
 assert.fail("fixture condition timed out");
}
function fixture(t, mode) { const f = makeFixture(mode); t.after(() => f.cleanup()); return f; }
function installed(f) { return JSON.parse(fs.readFileSync(path.join(f.installRoot, "package.json"), "utf8")).version; }

test("custom prefix and bin.dsh follow the running host", t => {
 const f = fixture(t);
 const context = resolveInstallContext(f.installRoot, f.context.npm);
 assert.equal(context.prefix, f.prefix);
 assert.equal(cliEntry(f.installRoot), path.join(f.installRoot, "bin", "dsh.mjs"));
 assert.equal(packageRootFromEntry(cliEntry(f.installRoot), "@deepseek-ai/dsh"), fs.realpathSync(f.installRoot));
 assert.equal(resolveNpmCommand().shell, false);
});

test("snapshot materializes a linked root and internal dependency links", { skip: process.platform === "win32" }, async t => {
 const f = fixture(t);
 const real = path.join(f.base, "linked-real-root");
 fs.renameSync(f.installRoot, real);
 fs.symlinkSync(real, f.installRoot, "dir");
 const external = path.join(f.base, "external.txt");
 fs.writeFileSync(external, "before"); fs.symlinkSync(external, path.join(real, "dependency"));
 const saved = snapshotInstall(f.context, f.config.backupDir);
 assert.equal(fs.lstatSync(saved.snapshot).isSymbolicLink(), false);
 fs.writeFileSync(path.join(real, "package.json"), "broken"); fs.writeFileSync(external, "after");
 assert.equal(JSON.parse(fs.readFileSync(path.join(saved.snapshot, "package.json"))).version, "1.2.3");
 assert.equal(fs.readFileSync(path.join(saved.snapshot, "dependency"), "utf8"), "before");
 const restored = await restoreSnapshot(f.context, saved);
 assert.equal(restored.ok, true, restored.error);
 assert.equal(installed(f), "1.2.3");
 assert.equal(fs.readFileSync(path.join(f.installRoot, "dependency"), "utf8"), "before");
});

test("independent transaction pins prefix/registry and repairs missing CLI", async t => {
 const f = fixture(t);
 const result = await runUpdateTransaction({ ...f.config, processOptions: { env: { ...process.env, DSH_FIXTURE_ENV: "preserved", npm_config_registry: f.config.registry, npm_config_prefix: f.prefix } } });
 assert.equal(result.ok, true, result.out);
 assert.equal(installed(f), "1.2.4");
 const [call] = fs.readFileSync(f.calls, "utf8").trim().split("\n").map(JSON.parse);
 assert.equal(call.registry, f.config.registry); assert.equal(call.prefix, f.prefix); assert.equal(call.custom, "preserved");
 assert.equal(call.args[call.args.indexOf("--prefix") + 1], f.prefix);
 assert.equal((await verifyInstall(f.context, "1.2.4")).ok, true);
});

test("blocked scripts trigger one force retry with a supported escape flag", async t => {
 const f = fixture(t, "blocked");
 const result = await runUpdateTransaction(f.config);
 assert.equal(result.ok, true, result.out); assert.equal(result.selfHealed, true);
 const calls = fs.readFileSync(f.calls, "utf8").trim().split("\n").map(JSON.parse);
 assert.equal(calls.length, 2); assert(calls[1].args.includes("--force")); assert(calls[1].args.includes("--dangerously-allow-all-scripts"));
 assert(!calls[1].args.some(arg => arg.startsWith("--allow-scripts=")));
});

test("unsupported escape flag retains the allowlist on retry", async t => {
 const f = fixture(t, "blocked");
 const result = await runUpdateTransaction({ ...f.config, allowAllScripts: false });
 assert.equal(result.ok, true, result.out);
 const calls = fs.readFileSync(f.calls, "utf8").trim().split("\n").map(JSON.parse);
 assert(calls[1].args.includes("--allow-scripts=fixture-native")); assert(!calls[1].args.includes("--dangerously-allow-all-scripts"));
});

for (const mode of ["fail", "bad-version"]) test(`${mode} restores package contents and verifies the old CLI`, async t => {
 const f = fixture(t, mode);
 const result = await runUpdateTransaction(f.config);
 assert.equal(result.ok, false); assert.equal(result.rolledBack, true, result.out); assert.equal(result.needsRecovery, false);
 assert.equal(installed(f), "1.2.3"); assert.equal((await verifyInstall(f.context, "1.2.3")).ok, true);
 assert(!fs.readdirSync(path.dirname(f.installRoot)).some(n => n.startsWith(".dsh-rollback-")));
});

test("timeout stops stubborn installer and descendant writes before rollback", { skip: process.platform === "win32" }, async t => {
 const f = fixture(t, "hang");
 const result = await runUpdateTransaction({ ...f.config, processOptions: { timeoutMs: 700, graceMs: 100, killWaitMs: 2000 } });
 assert.equal(result.timedOut, true); assert.equal(result.rolledBack, true, result.out);
 const writes = fs.readFileSync(path.join(f.base, "writes"), "utf8");
 await sleep(120);
 assert.equal(fs.readFileSync(path.join(f.base, "writes"), "utf8"), writes);
 assert.equal(installed(f), "1.2.3"); assert.equal(fs.readFileSync(f.calls, "utf8").trim().split("\n").length, 1, "timeout must not start another installer");
});

test("termination failure keeps the snapshot and never rolls back over a live writer", { skip: process.platform === "win32" }, async t => {
 const f = fixture(t, "hang");
 let pid;
 const original = process.kill.bind(process);
 const mocked = t.mock.method(process, "kill", (id, signal) => { if (id < 0 && signal !== 0) { const err = new Error("injected EPERM"); err.code = "EPERM"; throw err; } return original(id, signal); });
 try {
  const result = await runUpdateTransaction({ ...f.config, processOptions: { timeoutMs: 600, graceMs: 20, killWaitMs: 30 } }, change => { if (change.installerPid) pid = change.installerPid; });
  assert.equal(result.needsRecovery, true); assert.equal(result.rolledBack, undefined); assert(fs.existsSync(result.backup)); assert.equal(installed(f), "1.2.4");
 } finally { mocked.mock.restore(); if (pid) { try { original(-pid, "SIGKILL"); } catch {} } await sleep(80); }
});

test("spawn failures settle without waiting for the timeout", async () => {
 const result = await runCommand(path.join(process.cwd(), "does-not-exist-fixture"), [], { timeoutMs: 2000 });
 assert.equal(result.ok, false); assert.equal(result.stopped, true); assert.equal(result.timedOut, false);
});

for (const mode of ["success", "fail"]) test(`worker survives host death and persists ${mode} using staged runtime`, async t => {
 const f = fixture(t, mode); f.set({ delay: 500 });
 const configFile = path.join(f.base, "host-config.json"); writeJsonAtomic(configFile, f.config);
 const module = new URL("../lib/update-jobs.mjs", import.meta.url).href;
 const parent = spawn(process.execPath, ["--input-type=module", "-e", `import fs from 'node:fs'; import {startUpdateJob} from ${JSON.stringify(module)}; await startUpdateJob(JSON.parse(fs.readFileSync(process.argv[1])),{systemdRun:null}); setInterval(()=>{},1000);`, configFile], { stdio: ["ignore", "pipe", "pipe"] });
 let stderr=""; parent.stderr.on("data", b=>{stderr+=b;});
 t.after(() => parent.kill());
 await until(() => fs.existsSync(path.join(f.base, "started")) || parent.exitCode !== null);
 assert.equal(parent.exitCode, null, stderr);
 parent.kill("SIGKILL");
 await until(() => readUpdateStatus(f.config.directory).stage === (mode === "success" ? "installed" : "failed"));
 const state = readUpdateStatus(f.config.directory);
 assert.equal(state.inProgress, false); assert.equal(state.result.ok, mode === "success", JSON.stringify(state)); assert.equal(installed(f), mode === "success" ? "1.2.4" : "1.2.3");
 if (mode === "fail") assert.equal(state.result.rolledBack, true);
 // The worker persists its result before releasing the lock in finally.
 // Observing the terminal state does not mean that cleanup has finished yet.
 await until(() => !fs.existsSync(path.join(f.config.directory, "update.lock")));
 assert(!fs.existsSync(path.join(f.config.directory, "update.lock")));
 const jobDir = path.join(f.config.directory, "jobs", state.id);
 assert(fs.existsSync(path.join(jobDir, "runtime", "update-transaction.mjs")));
 assert(!fs.readdirSync(jobDir).some(n => n.startsWith("launch-")), "credential payload should be removed");
});

test("worker rolls back failed installs and rejects concurrent host/plugin updates", async t => {
 const f = fixture(t, "fail"); f.set({ delay: 180 });
 const job = await startUpdateJob(f.config, { systemdRun: null });
 await assert.rejects(startUpdateJob(f.config, { systemdRun: null }), /安装任务/);
 assert.throws(() => acquireUpdateLock(f.config.directory, "plugin", "2.0.0"), /安装任务/);
 const result = await waitForUpdateJob(f.config.directory, job.id);
 assert.equal(result.ok, false); assert.equal(result.rolledBack, true, result.out); assert.equal(installed(f), "1.2.3");
});

test("stale worker is reported as interrupted and recovery data blocks new mutations", t => {
 const f = fixture(t);
 writeJsonAtomic(path.join(f.config.directory, "update-state.json"), { id: "old", inProgress: true, stage: "installing", owner: { pid: 2147483647 }, backup: "/fixture/retained" });
 const state = readUpdateStatus(f.config.directory);
 assert.equal(state.inProgress, false); assert.equal(state.stage, "interrupted"); assert.equal(state.needsRecovery, true);
 assert.throws(() => acquireUpdateLock(f.config.directory, "dsh", "2.0.0"), /需要恢复/);
});

test("durable locks serialize updates and detect Linux PID reuse", t => {
 const f = fixture(t);
 const lock = acquireUpdateLock(f.config.directory, "plugin", "2.0.0");
 assert.throws(() => acquireUpdateLock(f.config.directory, "dsh", "2.0.0"), /安装任务/);
 releaseUpdateLock(f.config.directory, { id: "unrelated" }); assert(fs.existsSync(path.join(f.config.directory, "update.lock")));
 releaseUpdateLock(f.config.directory, lock); assert(!fs.existsSync(path.join(f.config.directory, "update.lock")));
 if (process.platform === "linux") assert.equal(ownerAlive({ ...processIdentity(), fingerprint: "wrong" }), false);
});

test("stale primary and reclamation locks can both be recovered", t => {
 const f=fixture(t); const lockFile=path.join(f.config.directory,"update.lock");
 const stale={id:"stale-owner",owner:{pid:2147483647},startedAt:0};
 writeJsonAtomic(lockFile,stale); writeJsonAtomic(`${lockFile}.reclaim`,stale);
 fs.utimesSync(lockFile,new Date(0),new Date(0)); fs.utimesSync(`${lockFile}.reclaim`,new Date(0),new Date(0));
 const lock=acquireUpdateLock(f.config.directory,"dsh","2.0.0");
 assert.equal(JSON.parse(fs.readFileSync(lockFile,"utf8")).id,lock.id);
 assert(!fs.existsSync(`${lockFile}.reclaim`)); assert(!fs.existsSync(`${lockFile}.reclaim.reclaim`));
 releaseUpdateLock(f.config.directory,lock);
});

test("legacy empty and nested stale reclaim locks are recovered without deleting live guards", t => {
 const f=fixture(t); const file=path.join(f.config.directory,"update.lock");
 const stale={id:"stale",owner:{pid:2147483647}};
 writeJsonAtomic(file,stale); fs.utimesSync(file,new Date(0),new Date(0));
 const live={id:"active-reclaimer",owner:processIdentity()};
 writeJsonAtomic(`${file}.reclaim`,live); fs.utimesSync(`${file}.reclaim`,new Date(0),new Date(0));
 assert.throws(()=>acquireUpdateLock(f.config.directory,"plugin","2.0.0"),/安装任务/);
 assert.equal(readJson(`${file}.reclaim`).id,live.id);
 fs.writeFileSync(`${file}.reclaim`,"");
 assert.throws(()=>acquireUpdateLock(f.config.directory,"plugin","2.0.0"),/安装任务/,"fresh empty records may still be initializing");
 for(const suffix of [".reclaim",".reclaim.reclaim"]) { fs.writeFileSync(file+suffix,""); fs.utimesSync(file+suffix,new Date(0),new Date(0)); }
 const lock=acquireUpdateLock(f.config.directory,"plugin","2.0.0");
 assert(!fs.existsSync(`${file}.reclaim`)); assert(!fs.existsSync(`${file}.reclaim.reclaim`));
 releaseUpdateLock(f.config.directory,lock);
});

test("concurrent stale-lock contenders leave exactly one live owner", async t => {
 const f=fixture(t); const file=path.join(f.config.directory,"update.lock");
 for(const suffix of ["",".reclaim"]) { writeJsonAtomic(file+suffix,{id:"stale",owner:{pid:2147483647}}); fs.utimesSync(file+suffix,new Date(0),new Date(0)); }
 const module=new URL("../lib/update-state.mjs",import.meta.url).href;
 const children=[];
 t.after(async()=>{await Promise.all(children.map(child=>new Promise(resolve=>{if(child.exitCode!==null||child.signalCode!==null)return resolve();child.once("close",resolve);child.kill();})));});
 const outcomes=[];
 for(let i=0;i<6;i++) {
  const child=spawn(process.execPath,["--input-type=module","-e",`import fs from 'node:fs';import path from 'node:path';import {acquireUpdateLock,sleep} from ${JSON.stringify(module)};const [directory,base,index]=process.argv.slice(1);fs.writeFileSync(path.join(base,'ready-'+index),'');while(!fs.existsSync(path.join(base,'go')))await sleep(10);try{const lock=acquireUpdateLock(directory,'dsh','2.0.0');console.log(JSON.stringify({won:true,id:lock.id,pid:process.pid}));setInterval(()=>{},1000);}catch(error){console.log(JSON.stringify({won:false,error:error.message}));}`,f.config.directory,f.base,String(i)],{stdio:["ignore","pipe","pipe"]});
  children.push(child); let output=""; let errors="";
  child.stderr.on("data",b=>{errors+=b;});
  outcomes.push(new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>reject(new Error(`contender timed out: ${errors}`)),10000);
   child.stdout.on("data",b=>{output+=b;if(output.includes("\n")){clearTimeout(timer);resolve(JSON.parse(output.trim()));}});
   child.once("error",error=>{clearTimeout(timer);reject(error);});
  }));
 }
 await until(()=>children.every((_,i)=>fs.existsSync(path.join(f.base,`ready-${i}`))));
 fs.writeFileSync(path.join(f.base,"go"),"");
 const results=await Promise.all(outcomes); const winners=results.filter(result=>result.won);
 assert.equal(winners.length,1,JSON.stringify(results));
 assert.equal(readJson(file).id,winners[0].id); assert(ownerAlive({pid:winners[0].pid}));
});

for(const mode of ["recorded", "legacy-auto", "legacy-profile"]) test(`interrupted plugin recovery verifies the installed package (${mode})`,async t=>{
 const f=fixture(t); const {recoverUpdate}=await import("../lib/update-recovery.mjs");
 const profiles=path.join(path.dirname(f.config.directory),"profiles","web");
 const root=path.join(profiles,"node_modules","@yannzhou","dsh-about");
 fs.mkdirSync(path.join(root,"lib"),{recursive:true});
 fs.writeFileSync(path.join(root,"package.json"),JSON.stringify({name:"@yannzhou/dsh-about",version:"1.8.3",type:"module",main:"./lib/index.js",exports:{"./client":"./lib/client.js"},dsh:{bundle:{patch:"./cordis.patch.yml"}}}));
 fs.writeFileSync(path.join(root,"lib/index.js"),"export const plugin = true;\n");
 fs.writeFileSync(path.join(root,"lib/client.js"),"window.__ModuleLoader__.load({});\n");
 fs.writeFileSync(path.join(root,"cordis.patch.yml"),"fixture\n");
 fs.writeFileSync(path.join(profiles,"package.json"),JSON.stringify({dependencies:{"@yannzhou/dsh-about":"1.8.3"}}));
 const id="1234567890abcdef12345678";
 writeJsonAtomic(path.join(f.config.directory,"update-state.json"),{id,kind:"plugin",target:"1.8.3",inProgress:true,stage:"installing",owner:{pid:2147483647},installer:{pid:2147483646},...(mode==="recorded"?{plugin:{profile:"web",key:"@yannzhou/dsh-about",name:"@yannzhou/dsh-about"}}:{})});
 const interrupted=readUpdateStatus(f.config.directory); assert.equal(interrupted.needsRecovery,true); assert.equal(interrupted.backup,undefined);
 assert.throws(()=>acquireUpdateLock(f.config.directory,"dsh","2.0.0"),/需要恢复/);
 let result;
 if(mode==="legacy-profile") {
  const other=path.join(path.dirname(profiles),"coding");fs.mkdirSync(other);fs.copyFileSync(path.join(profiles,"package.json"),path.join(other,"package.json"));
  const {fileURLToPath}=await import("node:url");
  const command=spawnSync(process.execPath,[fileURLToPath(new URL("../scripts/recover-update.mjs",import.meta.url)),"--profile","web"],{env:{...process.env,DSH_HOME:path.dirname(f.config.directory)},encoding:"utf8",timeout:10000});
  assert.equal(command.status,0,command.stderr);assert.match(command.stdout,/web.*1\.8\.3/);
  result={ok:true,version:readUpdateStatus(f.config.directory).result.installedVersion};
 } else result=await recoverUpdate(f.config.directory);
 assert.equal(result.ok,true,result.error); assert.equal(result.version,"1.8.3");
 const state=readUpdateStatus(f.config.directory); assert.equal(state.stage,"recovered"); assert.equal(state.needsRecovery,false);
 assert(!fs.existsSync(path.join(f.config.directory,"update.lock")));
 const next=acquireUpdateLock(f.config.directory,"plugin","2.0.0");releaseUpdateLock(f.config.directory,next);
});

for(const invalid of ["entry", "dependency", "client"]) test(`plugin recovery rejects invalid ${invalid} and can retry after repair`,async t=>{
 const f=fixture(t); const {recoverUpdate}=await import("../lib/update-recovery.mjs");
 const root=path.join(path.dirname(f.config.directory),"profiles","web","node_modules","@yannzhou","dsh-about");
 fs.mkdirSync(root,{recursive:true}); fs.writeFileSync(path.join(root,"package.json"),JSON.stringify({name:"@yannzhou/dsh-about",version:"1.8.3",type:"module",main:"./index.js",exports:{"./client":"./client.js"},dsh:{bundle:{patch:"./cordis.patch.yml"}}}));
 fs.writeFileSync(path.join(root,"client.js"),invalid==="client"?"function (":"window.__ModuleLoader__.load({});");
 fs.writeFileSync(path.join(root,"cordis.patch.yml"),"fixture\n");
 if(invalid!=="entry")fs.writeFileSync(path.join(root,"index.js"),invalid==="dependency"?"import './missing.mjs';":"export const name='dsh-about';");
 writeJsonAtomic(path.join(f.config.directory,"update-state.json"),{id:"1234567890abcdef12345678",kind:"plugin",target:"1.8.3",inProgress:true,owner:{pid:2147483647},installer:{pid:2147483646},plugin:{profile:"web",key:"@yannzhou/dsh-about",name:"@yannzhou/dsh-about"}});
 const result=await recoverUpdate(f.config.directory); assert.equal(result.ok,false);
 assert.equal(readUpdateStatus(f.config.directory).needsRecovery,true);
 assert.match(readUpdateStatus(f.config.directory).result.error,/未解除更新阻塞/);
 assert.throws(()=>acquireUpdateLock(f.config.directory,"plugin","2.0.0"),/需要恢复/);
 fs.writeFileSync(path.join(root,"index.js"),"export const name='dsh-about';");fs.writeFileSync(path.join(root,"client.js"),"window.__ModuleLoader__.load({});");
 const repaired=await recoverUpdate(f.config.directory);assert.equal(repaired.ok,true,repaired.error);
 assert.equal(readUpdateStatus(f.config.directory).needsRecovery,false);
});

for(const live of ["owner", "installer"]) test(`plugin recovery refuses a live ${live}`,async t=>{
 const f=fixture(t);const {recoverUpdate}=await import("../lib/update-recovery.mjs");
 const state={id:"1234567890abcdef12345678",kind:"plugin",target:"1.8.3",inProgress:false,needsRecovery:true,owner:{pid:2147483647},installer:{pid:2147483646},[live]:processIdentity()};
 writeJsonAtomic(path.join(f.config.directory,"update-state.json"),state);
 await assert.rejects(recoverUpdate(f.config.directory),/仍在运行/);
 assert.deepEqual(readUpdateStatus(f.config.directory),state);
});

test("legacy plugin recovery requires an explicit profile when installs are ambiguous",async t=>{
 const f=fixture(t); const {recoverUpdate}=await import("../lib/update-recovery.mjs");
 for(const profile of ["web","coding"]) { const dir=path.join(path.dirname(f.config.directory),"profiles",profile); fs.mkdirSync(dir,{recursive:true}); fs.writeFileSync(path.join(dir,"package.json"),JSON.stringify({dependencies:{"@yannzhou/dsh-about":"1.8.2"}})); }
 writeJsonAtomic(path.join(f.config.directory,"update-state.json"),{id:"1234567890abcdef12345678",kind:"plugin",target:"1.8.3",inProgress:true,owner:{pid:2147483647},installer:{pid:2147483646}});
 await assert.rejects(recoverUpdate(f.config.directory),/无法唯一确定/);
});

test("nonzero systemd dispatcher cancels launch even when a ready file exists", async t => {
 const f = fixture(t); const readyFile = path.join(f.base, "ready.json"); writeJsonAtomic(readyFile, { ready: true });
 let captured;
 const spawnImpl = (command, args) => { captured={command,args}; const child = new EventEmitter(); child.stderr = new EventEmitter(); child.stderr.destroy=()=>{}; child.unref=()=>{}; queueMicrotask(()=>child.emit("close", 1)); return child; };
 await assert.rejects(launchBackground("fixture.mjs", [], { directory: f.base, readyFile, systemdRun: "fake-systemd", timeoutMs: 200, spawnImpl, env: { SECRET_TOKEN: "do-not-expose" } }), /exit=1/);
 assert(!JSON.stringify(captured).includes("do-not-expose"));
 assert(!fs.readdirSync(f.base).some(n => n.startsWith("launch-")));
});

test("dispatcher startup timeout cancels the unconsumed credential payload", async t => {
 const f = fixture(t);
 const spawnImpl = () => { const child = new EventEmitter(); child.unref=()=>{}; return child; };
 await assert.rejects(launchBackground("fixture.mjs", [], { directory: f.base, readyFile: path.join(f.base,"absent.json"), systemdRun: "fake-systemd", timeoutMs: 60, spawnImpl }), /超时/);
 assert(!fs.readdirSync(f.base).some(n=>n.startsWith("launch-")));
});

test("snapshot rejects a backup directory inside the installation", t => {
 const f=fixture(t); assert.throws(()=>snapshotInstall(f.context,f.installRoot),/不能位于/);
});

test("snapshot preserves dependency cycles entirely inside the backup", {skip:process.platform==="win32"}, async t=>{
 const f=fixture(t); fs.mkdirSync(path.join(f.installRoot,"deps")); fs.symlinkSync(f.installRoot,path.join(f.installRoot,"deps","self"),"dir");
 const saved=snapshotInstall(f.context,f.config.backupDir);
 assert.equal(fs.realpathSync(path.join(saved.snapshot,"deps","self")),fs.realpathSync(saved.snapshot));
 const result=await restoreSnapshot(f.context,saved); assert.equal(result.ok,true,result.error);
 assert.equal(fs.realpathSync(path.join(f.installRoot,"deps","self")),fs.realpathSync(f.installRoot));
});

test("secure bootstrap preserves custom env through a clean systemd manager environment", async t=>{
 const f=fixture(t); const readyFile=path.join(f.base,"env-ready.json"); const script=path.join(f.base,"env-worker.mjs");
 fs.writeFileSync(script,`import fs from 'node:fs'; fs.writeFileSync(${JSON.stringify(readyFile)},JSON.stringify({ready:true,registry:process.env.npm_config_registry,home:process.env.DSH_HOME,proxy:process.env.HTTPS_PROXY,custom:process.env.DSH_FIXTURE_ENV}));setInterval(()=>{},1000);`);
 let worker; let captured;
 const spawnImpl=(command,args)=>{
  captured=args; const index=args.indexOf(process.execPath);
  worker=spawn(process.execPath,args.slice(index+1),{env:{PATH:path.dirname(process.execPath)},detached:true,stdio:"ignore"});
  const launcher=new EventEmitter();launcher.unref=()=>{};
  queueMicrotask(()=>launcher.emit("close",0)); return launcher;
 };
 t.after(()=>worker?.kill());
 const env={PATH:process.env.PATH,npm_config_registry:"https://fixture.invalid/",DSH_HOME:path.join(f.base,"custom home"),HTTPS_PROXY:"https://fixture-proxy.invalid/",DSH_FIXTURE_ENV:"preserved-secret"};
 const ready=await launchBackground(script,[],{directory:f.base,readyFile,systemdRun:"fake-systemd",spawnImpl,env});
 assert.equal(ready.registry,env.npm_config_registry);assert.equal(ready.home,env.DSH_HOME);assert.equal(ready.proxy,env.HTTPS_PROXY);assert.equal(ready.custom,env.DSH_FIXTURE_ENV);
 assert(!JSON.stringify(captured).includes("preserved-secret"));
});

test("killed-worker snapshot can be recovered explicitly after all writers stop", async t=>{
 const f=fixture(t); const {recoverUpdate}=await import("../lib/update-recovery.mjs");
 const saved=snapshotInstall(f.context,f.config.backupDir); fs.writeFileSync(path.join(f.installRoot,"package.json"),"broken");
 const id="1234567890abcdef12345678";
 writeJsonAtomic(path.join(f.config.directory,"jobs",id,"config.json"),f.config);
 writeJsonAtomic(path.join(f.config.directory,"update-state.json"),{id,inProgress:true,stage:"installing",owner:{pid:2147483647},backup:saved.snapshot});
 const result=await recoverUpdate(f.config.directory); assert.equal(result.ok,true,result.error); assert.equal(installed(f),"1.2.3");
 assert.equal(readUpdateStatus(f.config.directory).needsRecovery,false); assert(!fs.existsSync(path.join(f.config.directory,"update.lock")));
});

test("manual recovery refuses a live update owner", async t=>{
 const f=fixture(t);const {recoverUpdate}=await import("../lib/update-recovery.mjs");const saved=snapshotInstall(f.context,f.config.backupDir);
 writeJsonAtomic(path.join(f.config.directory,"update-state.json"),{id:"1234567890abcdef12345678",inProgress:false,needsRecovery:true,owner:processIdentity(),backup:saved.snapshot});
 await assert.rejects(recoverUpdate(f.config.directory),/仍在运行/);assert(fs.existsSync(saved.snapshot));
});

test("systemd timeout awaits unit stop confirmation before settling", async t=>{
 let confirmed=false;
 const result=await runCommand(process.execPath,["-e","setInterval(()=>{},1000)"],{unit:"fixture-only",timeoutMs:80,graceMs:30,killWaitMs:1000,stopUnit:async()=>{await sleep(100);confirmed=true;return true;}});
 assert.equal(confirmed,true);assert.equal(result.timedOut,true);assert.equal(result.stopped,true);
});

test("failed unit stop prevents rollback authorization", async()=>{
 const result=await runCommand(process.execPath,["-e","setInterval(()=>{},1000)"],{unit:"fixture-only",timeoutMs:80,graceMs:30,killWaitMs:1000,stopUnit:async()=>false});
 assert.equal(result.stopped,false);assert.equal(result.ok,false);
});

test("npm transient service gets pinned config despite a clean manager environment",{skip:process.platform==="win32"},async t=>{
 const f=fixture(t);const dispatcher=path.join(f.base,"fake-systemd-run");
 fs.writeFileSync(dispatcher,`#!${process.execPath}\nconst{spawn}=require('node:child_process');const args=process.argv.slice(2);const index=args.indexOf(${JSON.stringify(process.execPath)});const child=spawn(args[index],args.slice(index+1),{env:{PATH:${JSON.stringify(path.dirname(process.execPath))}},stdio:'inherit'});child.on('error',()=>{process.exitCode=1;});child.on('close',c=>{process.exitCode=c??1;});`,{mode:0o755});
 const jobDir=path.join(f.base,"job");fs.mkdirSync(jobDir);
 const systemctl=path.join(f.base,"fake-systemctl");fs.writeFileSync(systemctl,`#!${process.execPath}\nconsole.log("ActiveState=inactive\\nLoadState=not-found");`,{mode:0o755});
 const result=await runUpdateTransaction({...f.config,systemdRun:dispatcher,jobDir,processOptions:{systemctl},lock:{id:"1234567890abcdef12345678"}});
 assert.equal(result.ok,true,result.out);
 const call=JSON.parse(fs.readFileSync(f.calls,"utf8").trim());assert.equal(call.registry,f.config.registry);assert.equal(call.prefix,f.prefix);
 assert.equal(fs.readdirSync(jobDir).length,0,"npm credential payload is removed");
});

test("watchdog acknowledges initialization before any host exit",async t=>{
 const f=makeFixture(); const readyFile=path.join(f.base,"watchdog-ready.json");
 t.after(async()=>{
  const owner=readJson(readyFile);
  if(ownerAlive(owner)) {
   try { process.kill(owner.pid,"SIGTERM"); } catch(error) { if(error.code!=="ESRCH") throw error; }
   await until(()=>!ownerAlive(owner));
  }
  // The watchdog can still write its initial log after acknowledging readiness.
  // Stop it before deleting the fixture, including on Windows / Node 18.
  f.cleanup();
 });
 const watchdog=new URL("../bin/dsh-watchdog.mjs",import.meta.url);
 const {fileURLToPath}=await import("node:url");
 const ready=await launchBackground(fileURLToPath(watchdog),["once"],{directory:f.base,readyFile,systemdRun:null,env:{...process.env,DSH_HOME:f.base,DSH_WATCH_PID:String(process.pid),DSH_WATCH_PORT:"9",DSH_WATCH_NO_SYSTEMD:"1",DSH_WATCH_READY:readyFile}});
 assert.equal(ready.ready,true);assert(ownerAlive({pid:ready.pid}));
});

test("independent update and watchdog relaunch a temporary service after host death",async t=>{
 const f=makeFixture();f.set({delay:250});
 const serverScript=path.join(f.base,"temporary-server.mjs");
 const oldRecord=path.join(f.base,"old-server.json"),newRecord=path.join(f.base,"new-server.json");
 fs.writeFileSync(serverScript,`import http from 'node:http';import fs from 'node:fs';const server=http.createServer((q,r)=>r.end('fixture'));server.listen(Number(process.argv[2]),'127.0.0.1',()=>fs.writeFileSync(process.argv[3],JSON.stringify({pid:process.pid,port:server.address().port})));`);
 const old=spawn(process.execPath,[serverScript,"0",oldRecord],{stdio:"ignore"});
 let watchdogPid;
 t.after(()=>{old.kill();const restarted=readJson(newRecord);if(restarted?.pid){try{process.kill(restarted.pid,"SIGTERM");}catch{}}if(watchdogPid){try{process.kill(watchdogPid,"SIGTERM");}catch{}}f.cleanup();});
 await until(()=>fs.existsSync(oldRecord));const oldInfo=readJson(oldRecord);
 const previous={DSH_WATCH_NO_SYSTEMD:process.env.DSH_WATCH_NO_SYSTEMD,DSH_WATCH_COUNTDOWN:process.env.DSH_WATCH_COUNTDOWN,DSH_WATCH_START_TIMEOUT:process.env.DSH_WATCH_START_TIMEOUT,DSH_HOME:process.env.DSH_HOME};
 Object.assign(process.env,{DSH_WATCH_NO_SYSTEMD:"1",DSH_WATCH_COUNTDOWN:"0",DSH_WATCH_START_TIMEOUT:"5",DSH_HOME:path.join(f.base,"dsh-home")});
 let job;
 try{job=await startUpdateJob({...f.config,restart:{pid:old.pid,port:oldInfo.port,argv:[process.execPath,serverScript,String(oldInfo.port),newRecord],hostNonce:"fixture-old-host"}},{systemdRun:null});}
 finally{for(const [key,value]of Object.entries(previous)){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
 await until(()=>fs.existsSync(path.join(f.base,"started")));old.kill("SIGKILL");
 const result=await waitForUpdateJob(f.config.directory,job.id);assert.equal(result.ok,true,result.out);assert.equal(result.restarting,true,result.lastRestartError);
 watchdogPid=readJson(path.join(f.config.directory,"jobs",job.id,"watchdog-ready.json"))?.pid;
 await until(()=>fs.existsSync(newRecord),10000);
 const restarted=readJson(newRecord);assert.notEqual(restarted.pid,old.pid);assert.equal(restarted.port,oldInfo.port);assert.equal(installed(f),"1.2.4");
});

test("CLI verification uses the host Node even when PATH selects another node",{skip:process.platform==="win32"},async t=>{
 const f=fixture(t);const otherBin=path.join(f.base,"other-node-bin");fs.mkdirSync(otherBin);
 fs.writeFileSync(path.join(otherBin,"node"),"#!/bin/sh\necho 9.9.9\n",{mode:0o755});
 const result=await verifyInstall(f.context,"1.2.3","",{env:{...process.env,PATH:otherBin}});
 assert.equal(result.ok,true,result.out);
});

test("transient watchdog preserves environment when relaunching without a known systemd service",{skip:process.platform==="win32"},async t=>{
 const f=makeFixture();const readyFile=path.join(f.base,"raw-watch-ready.json"),record=path.join(f.base,"raw-service.json"),launchRecord=path.join(f.base,"raw-launch.json");
 const fakeBin=path.join(f.base,"fake-bin");fs.mkdirSync(fakeBin);
 fs.writeFileSync(path.join(fakeBin,"systemctl"),`#!${process.execPath}\nconsole.log('unknown');process.exitCode=3;`,{mode:0o755});
 fs.writeFileSync(path.join(fakeBin,"systemd-run"),`#!${process.execPath}\nconst fs=require('node:fs');const{spawn}=require('node:child_process');const args=process.argv.slice(2);const index=args.indexOf(${JSON.stringify(process.execPath)});const child=spawn(args[index],args.slice(index+1),{env:{PATH:${JSON.stringify(path.dirname(process.execPath))}},stdio:'ignore',detached:true});fs.writeFileSync(${JSON.stringify(launchRecord)},JSON.stringify({pid:child.pid,args}));child.on('error',()=>{process.exitCode=1;});child.unref();`,{mode:0o755});
 const script=path.join(f.base,"raw-server.mjs");fs.writeFileSync(script,`import http from 'node:http';import fs from 'node:fs';const server=http.createServer((q,r)=>r.end('fixture'));server.listen(0,'127.0.0.1',()=>fs.writeFileSync(${JSON.stringify(record)},JSON.stringify({pid:process.pid,home:process.env.DSH_HOME,custom:process.env.DSH_FIXTURE_ENV})));`);
 let watchdogPid;
 t.after(()=>{for(const pid of [watchdogPid,readJson(record)?.pid,readJson(launchRecord)?.pid]){if(pid){try{process.kill(pid,'SIGTERM');}catch{}}}f.cleanup();});
 const {fileURLToPath}=await import('node:url');
 const ready=await launchBackground(fileURLToPath(new URL('../bin/dsh-watchdog.mjs',import.meta.url)),['once'],{directory:f.base,readyFile,systemdRun:null,env:{...process.env,PATH:fakeBin+path.delimiter+process.env.PATH,DSH_HOME:f.base,DSH_FIXTURE_ENV:'preserved-private-env',DSH_WATCH_NO_SYSTEMD:'0',DSH_WATCH_IN_TRANSIENT:'1',DSH_WATCH_PID:'0',DSH_WATCH_PORT:'9',DSH_WATCH_COUNTDOWN:'0',DSH_WATCH_READY:readyFile,DSH_WATCH_ARGV:JSON.stringify([process.execPath,script])}});
 watchdogPid=ready.pid;await until(()=>fs.existsSync(record),10000);
 assert.equal(readJson(record).home,f.base);assert.equal(readJson(record).custom,'preserved-private-env');
 assert(!JSON.stringify(readJson(launchRecord).args).includes('preserved-private-env'));
});
