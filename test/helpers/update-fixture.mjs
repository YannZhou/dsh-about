import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export function makeFixture(mode = "success") {
 const base = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-update-test-"));
 const prefix = path.join(base, "custom prefix");
 const installRoot = path.join(prefix, process.platform === "win32" ? "" : "lib", "node_modules", "@deepseek-ai", "dsh");
 const binDir = process.platform === "win32" ? prefix : path.join(prefix, "bin");
 const configFile = path.join(base, "fake-config.json");
 const calls = path.join(base, "npm-calls.jsonl");
 const installer = path.join(base, "fake-npm.mjs");
 const data = { base, prefix, installRoot, binDir, calls, configFile, mode };
 fs.mkdirSync(installRoot, { recursive: true });
 writeTree(installRoot, "1.2.3");
 fs.writeFileSync(configFile, JSON.stringify(data));
 fs.writeFileSync(installer, `import fs from 'node:fs'; import path from 'node:path'; import {spawn} from 'node:child_process';
 const config=JSON.parse(fs.readFileSync(${JSON.stringify(configFile)},'utf8'));
 const args=process.argv.slice(2);
 if(args[0]==='--version') { console.log('12.2.1'); process.exit(0); }
 if(args[0]==='prefix') { console.log(config.prefix); process.exit(0); }
 if(args[0]==='config') { console.log('false'); process.exit(0); }
 const old=fs.existsSync(config.calls)?fs.readFileSync(config.calls,'utf8').trim().split('\\n').length:0;
 fs.appendFileSync(config.calls,JSON.stringify({args, registry:process.env.npm_config_registry,prefix:process.env.npm_config_prefix,custom:process.env.DSH_FIXTURE_ENV})+'\\n');
 fs.writeFileSync(path.join(config.base,'started'),'yes');
 if(config.delay) await new Promise(r=>setTimeout(r,config.delay));
 const spec=args.at(-1); const target=spec.slice(spec.lastIndexOf('@')+1);
 const chosenPrefix=args[args.indexOf('--prefix')+1];
 const root=path.join(chosenPrefix, path.relative(config.prefix, config.installRoot));
 ${writeTree.toString()}
 fs.rmSync(root,{recursive:true,force:true});
 writeTree(root,target,config.mode==='bad-version'?target+'0':null,config.mode);
 if(config.mode==='hang') {
   const writer=path.join(config.base,'writer.mjs');
   fs.writeFileSync(writer, "import fs from 'node:fs'; process.on('SIGTERM',()=>{}); setInterval(()=>fs.appendFileSync("+JSON.stringify(path.join(config.base,'writes'))+",'x'),15);");
   spawn(process.execPath,[writer],{stdio:'ignore'}); process.on('SIGTERM',()=>{}); setInterval(()=>{},1000); await new Promise(()=>{});
 }
 if(config.mode==='fail') { console.error('injected npm failure'); process.exit(1); }
 if(config.mode==='blocked' && old===0) console.log('2 packages had install scripts blocked because they are not covered by allowScripts:');
 `);
 const context = { installRoot, binDir, prefix, currentVersion: "1.2.3", npm: { command: process.execPath, argsPrefix: [installer], shell: false } };
 return { ...data, context, config: { directory: path.join(base, "dsh-home", "dsh-about"), backupDir: path.join(base, "dsh-home", "dsh-about", "backups"), context, target: "1.2.4", registry: "https://registry.fixture.invalid/", allowScriptsArgs: ["--allow-scripts=fixture-native"], allowAllScripts: true },
  set(values) { fs.writeFileSync(configFile, JSON.stringify({ ...JSON.parse(fs.readFileSync(configFile, "utf8")), ...values })); },
  cleanup() { fs.rmSync(base, { recursive: true, force: true }); }
 };
}

export function writeTree(root, version, cliVersion = null, mode) {
 fs.mkdirSync(path.join(root, "bin"), { recursive: true });
 fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "@deepseek-ai/dsh", version, bin: { unrelated: "other.mjs", dsh: "bin/dsh.mjs" } }));
 fs.writeFileSync(path.join(root, "native.node"), "old native fixture");
 let cli = "#!/usr/bin/env node\n";
 if (mode === "module-export") {
  const dependency = path.join(root, "node_modules", "fixture-loader");
  fs.mkdirSync(dependency, { recursive: true });
  fs.writeFileSync(path.join(dependency, "package.json"), JSON.stringify({ name: "fixture-loader", type: "module", version: "1.1.0", main: "index.js" }));
  fs.writeFileSync(path.join(dependency, "index.js"), "export const Other = 1;");
  cli += "import { EntryValidationError } from 'fixture-loader';\n";
 }
 if (mode === "web") {
  cli += "import {createServer} from 'node:http';\n";
  cli += "if (process.argv.includes('--profile')) {\n";
  cli += "if (!process.env.DSH_HOME || process.env.FIXTURE_PASSWORD) process.exit(3);\n";
  cli += "const server=createServer((req,res)=>{if(req.url.includes('token=')){res.writeHead(303,{'set-cookie':'dsh=ready; HttpOnly',location:'./'});}else{res.statusCode=req.headers.cookie==='dsh=ready'?200:401;}res.end();});\n";
  cli += "server.listen(0,'127.0.0.1',()=>console.log('dsh web: http://127.0.0.1:'+server.address().port+'/?token=fixture-private'));\n";
  cli += "} else ";
 }
 cli += "console.log(" + JSON.stringify(cliVersion || version) + ");\n";
 fs.writeFileSync(path.join(root, "bin", "dsh.mjs"), cli, { mode: 0o755 });
}
