import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR, cleanup } from "./helpers/env.mjs";
import { importHost, startHost, request, installFetchStub } from "./helpers/host.mjs";
import { makeFixture } from "./helpers/update-fixture.mjs";
import { writeJsonAtomic, processIdentity } from "../lib/update-state.mjs";
const host=await startHost(await importHost());
const stateFile=path.join(DATA_DIR,"update-state.json");
test.after(async()=>{await host.close();cleanup();});
test.beforeEach(()=>fs.rmSync(stateFile,{force:true}));

test("update-status reports idle without creating an update job",async()=>{
 const r=await request(host.port,"/dsh-about/update-status");assert.equal(r.status,200);assert.equal(r.json.stage,"idle");assert.equal(r.json.inProgress,false);assert.equal(r.headers["cache-control"],"no-store");
});
test("both mutation routes reject a durable job owned by another host",async()=>{
 writeJsonAtomic(stateFile,{id:"fixture",kind:"dsh",inProgress:true,stage:"installing",owner:processIdentity(),target:"9.0.0"});
 for(const route of ["update","plugin-update"]){const r=await request(host.port,`/dsh-about/${route}`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({version:"9.0.0"})});assert.equal(r.status,409,r.body);}
});
test("dead worker reports interrupted plus recovery data over HTTP",async()=>{
 writeJsonAtomic(stateFile,{id:"fixture",kind:"dsh",inProgress:true,stage:"installing",owner:{pid:2147483647},backup:"/fixture/snapshot"});
 const r=await request(host.port,"/dsh-about/update-status");assert.equal(r.json.inProgress,false);assert.equal(r.json.stage,"interrupted");assert.equal(r.json.needsRecovery,true);assert.match(r.json.result.out,/snapshot/);
});
test("durable completed result remains available after the submitting request is gone",async()=>{
 writeJsonAtomic(stateFile,{id:"fixture",kind:"dsh",inProgress:false,stage:"failed",target:"9.0.0",result:{ok:false,rolledBack:true,out:"fixture rollback complete",hostNonce:"previous-host"}});
 const r=await request(host.port,"/dsh-about/update-status");assert.equal(r.json.ok,true);assert.equal(r.json.result.rolledBack,true);assert.equal(r.json.result.hostNonce,"previous-host");
});
test("legacy pid-only progress is not mistaken for an abandoned update",async()=>{
 writeJsonAtomic(stateFile,{inProgress:true,stage:"installing",pid:process.pid});
 const r=await request(host.port,"/dsh-about/update-status");assert.equal(r.json.inProgress,true);
});

test("plugin update records its original profile before the installer starts",async()=>{
 const fixture=makeFixture(); const argv=process.argv[1]; const stub=installFetchStub();
 const profile=path.join(path.dirname(DATA_DIR),"profiles","web");
 const capture=path.join(fixture.base,"captured-state.json");
 try {
  fs.mkdirSync(profile,{recursive:true});fs.writeFileSync(path.join(profile,"package.json"),JSON.stringify({dependencies:{"@yannzhou/dsh-about":"1.8.2"}}));
  const entry=path.join(fixture.installRoot,"bin","dsh.mjs");
  fs.writeFileSync(entry,`import fs from 'node:fs';fs.copyFileSync(${JSON.stringify(stateFile)},${JSON.stringify(capture)});process.exitCode=1;`);
  process.argv[1]=entry;
  stub.setRegistry(()=>new Response(JSON.stringify({latest:"9.0.0"}),{status:200}));
  const response=await request(host.port,"/dsh-about/plugin-update",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({version:"9.0.0"})});
  assert.equal(response.status,200,response.body);assert.equal(response.json.ok,false);
  const state=JSON.parse(fs.readFileSync(capture,"utf8"));
  assert.deepEqual(state.plugin,{profile:"web",key:"@yannzhou/dsh-about",name:"@yannzhou/dsh-about"});
  assert(state.installer.pid>0);assert(!fs.existsSync(path.join(DATA_DIR,"update.lock")));
 } finally {process.argv[1]=argv;stub.restore();fs.rmSync(profile,{recursive:true,force:true});fixture.cleanup();}
});
