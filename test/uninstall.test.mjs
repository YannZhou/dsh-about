import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { secureBackup } from "../lib/secure-file.mjs";
import { processIdentity, writeJsonAtomic } from "../lib/update-state.mjs";

function fixture(t) {
 const home=fs.mkdtempSync(path.join(os.tmpdir(),"dsh-uninstall-test-")); t.after(()=>fs.rmSync(home,{recursive:true,force:true}));
 const data=path.join(home,"dsh-about"); fs.mkdirSync(data); fs.writeFileSync(path.join(data,"auth.json"),'{"token":"fake-fixture-token"}');
 const npmrc=path.join(home,"test.npmrc"); fs.writeFileSync(npmrc,"//fixture.invalid/:_authToken=fake-secret\nallow-scripts[]=fs-ext\nallow-scripts[]=user-package\n",{mode:0o600});
 return {home,data,npmrc};
}
function declare(f, pkg={ dependencies:{"@yannzhou/dsh-about":"1.8.2"} }) { const dir=path.join(f.home,"profiles","web"); fs.mkdirSync(dir,{recursive:true}); fs.writeFileSync(path.join(dir,"package.json"),JSON.stringify(pkg)); }
function uninstall(f, bash=false, extra={}) {
 const script=fileURLToPath(new URL(bash?"../scripts/uninstall.sh":"../scripts/uninstall.mjs",import.meta.url));
 const r=spawnSync(bash?"bash":process.execPath,[script],{env:{...process.env, DSH_HOME:f.home,NPM_CONFIG_USERCONFIG:f.npmrc,DSH_ABOUT_NPMRC_CLEANUP:"1",...extra},encoding:"utf8",timeout:10000});
 assert.equal(r.status,0,r.stderr); return r;
}
for (const bash of [false,true]) {
 const option={skip:bash&&process.platform==="win32"};
 test(`${bash?"Bash":"Node"} uninstall retains another profile's shared auth/config`,option,t=>{
  const f=fixture(t); declare(f); const before=fs.readFileSync(f.npmrc,"utf8"); uninstall(f,bash);
  assert(fs.existsSync(path.join(f.data,"auth.json"))); assert.equal(fs.readFileSync(f.npmrc,"utf8"),before);
 });
 test(`${bash?"Bash":"Node"} uninstall cleans unused data and securely backs up credentials`,option,t=>{
  const f=fixture(t); declare(f,{}); const before=fs.readFileSync(f.npmrc,"utf8"); uninstall(f,bash);
  assert(!fs.existsSync(f.data)); const after=fs.readFileSync(f.npmrc,"utf8"); assert(!after.includes("fs-ext")); assert(after.includes("user-package")); assert(after.includes("fake-secret"));
  const backup=fs.readdirSync(f.home).find(n=>n.includes("uninstall.bak-")); assert(backup); assert.equal(fs.readFileSync(path.join(f.home,backup),"utf8"),before);
  if(process.platform!=="win32") assert.equal(fs.statSync(path.join(f.home,backup)).mode&0o777,0o600);
 });
}
for(const kind of ["update","recovery","watchdog"]) test(`uninstall preserves ${kind} runtime and recovery data`,t=>{
 const f=fixture(t); declare(f,{});
 if(kind==="update") writeJsonAtomic(path.join(f.data,"update.lock"),{id:"active",owner:processIdentity()});
 if(kind==="recovery") writeJsonAtomic(path.join(f.data,"update-state.json"),{inProgress:false,needsRecovery:true,backup:"fixture"});
 if(kind==="watchdog") fs.writeFileSync(path.join(f.home,".dsh-watchdog-once.lock"),String(process.pid));
 uninstall(f); assert(fs.existsSync(path.join(f.data,"auth.json"))); assert(fs.readFileSync(f.npmrc,"utf8").includes("fs-ext"));
});
test("unreadable/malformed profile manifest conservatively retains data",t=>{
 const f=fixture(t); declare(f,{}); fs.writeFileSync(path.join(f.home,"profiles","web","package.json"),"broken-json"); uninstall(f); assert(fs.existsSync(f.data));
});
test("linked profiles are included before cleaning shared data",{skip:process.platform==="win32"},t=>{
 const f=fixture(t); declare(f); const old=path.join(f.home,"profiles","web"), target=path.join(f.home,"linked-profile"); fs.renameSync(old,target); fs.symlinkSync(target,old,"dir"); uninstall(f); assert(fs.existsSync(f.data));
});
test("secureBackup creates 0600 files, tightens old backups and rejects symlinks",t=>{
 const f=fixture(t); const file=path.join(f.home,"credentials.bak"); secureBackup(file,"fake-token");
 if(process.platform!=="win32") { assert.equal(fs.statSync(file).mode&0o777,0o600); fs.chmodSync(file,0o664); }
 secureBackup(file,"do-not-replace"); assert.equal(fs.readFileSync(file,"utf8"),"fake-token");
 if(process.platform!=="win32") { assert.equal(fs.statSync(file).mode&0o777,0o600); const link=path.join(f.home,"symlink.bak"); fs.symlinkSync(file,link); assert.throws(()=>secureBackup(link,"bad"),/普通文件/); }
});

test("npmrc allowlist maintenance backs up tokens privately and remains idempotent", async t=>{
 const f=fixture(t);
 const {makeFixture}=await import("./helpers/update-fixture.mjs"); const npm=makeFixture(); t.after(()=>npm.cleanup());
 const oldHome=process.env.DSH_HOME, oldSwitch=process.env.DSH_ABOUT_NPMRC;
 process.env.DSH_HOME=f.home; delete process.env.DSH_ABOUT_NPMRC;
 try {
  const {ensureNpmrcAllowlist}=await import("../lib/index.js");
  const before=fs.readFileSync(f.npmrc,"utf8");
  ensureNpmrcAllowlist({npm:npm.context.npm,targets:["koffi"],rcPath:f.npmrc});
  const backups=fs.readdirSync(f.home).filter(n=>n.includes(".dsh-about.bak-")); assert.equal(backups.length,1);
  assert.equal(fs.readFileSync(path.join(f.home,backups[0]),"utf8"),before);
  if(process.platform!=="win32") assert.equal(fs.statSync(path.join(f.home,backups[0])).mode&0o777,0o600);
  const after=fs.readFileSync(f.npmrc,"utf8"); assert(after.includes("fake-secret")); assert(after.includes("allow-scripts[]=koffi"));
  ensureNpmrcAllowlist({npm:npm.context.npm,targets:["koffi"],rcPath:f.npmrc}); assert.equal(fs.readFileSync(f.npmrc,"utf8"),after);
 } finally { if(oldHome===undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME=oldHome; if(oldSwitch===undefined) delete process.env.DSH_ABOUT_NPMRC; else process.env.DSH_ABOUT_NPMRC=oldSwitch; }
});
