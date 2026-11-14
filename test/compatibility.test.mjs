import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { satisfies } from "../lib/semver.js";
import { pluginPeerWarningsFor } from "../lib/install-context.mjs";
import { makeFixture } from "./helpers/update-fixture.mjs";

const cases = [
 ["0.2.2", ">=0.2.0 <0.3.0", true], ["0.3.0", ">=0.2.0 <0.3.0", false],
 ["0.2.2-rc.3", "*", false], ["0.2.3-rc.1", "^0.2.2-rc.1", false], ["0.2.2-rc.3", "^0.2.2-rc.1", true],
 ["0.2.2", "^0.2.2-rc.1", true], ["0.3.0", "^0.2.2", false], ["0.0.4", "^0.0.3", false],
 ["1.9.0", "^1.2.3", true], ["2.0.0", "^1.2.3", false], ["1.2.9", "~1.2.3", true], ["1.3.0", "~1.2.3", false],
 ["1.9.0", "~1", true], ["0.2.3", "^0.2", true], ["0.9.1", "^0", true], ["1.0.0", "^0", false],
 ["1.2.9", "1.2.x", true], ["1.3.0", "1.2.*", false], ["1.9.0", "1", true], ["1.2.9", "1.2", true],
 ["1.3.0", ">1.2", true], ["1.2.99", ">1.2", false], ["1.2.99", "<=1.2", true], ["1.3.0", "<=1.2", false],
 ["1.2.0", "<1.2", false], ["1.1.99", "<1.2", true], ["2.3.99", "1.2 - 2.3", true], ["2.4.0", "1.2 - 2.3", false],
 ["2.3.4", "1.2.3 - 2.3.4", true], ["1.2.2", "1.2.3 - 2.3.4", false], ["2.2.0", "^1.0.0 || >=2.1.0 <3", true],
 ["3.0.0", "^1.0.0 || >=2.1.0 <3", false], ["1.2.3+build", "=1.2.3", true], ["1.2.3", ">= 1.2.0 < 2", true],
 ["1.2.3", "", true], ["1.2.3-rc.1", "", false], ["1.2.3", ">*", false], ["1.2.3", "<=*", true],
 ["1.2.3-rc.1", ">=1.2.3-rc.0 <1.3.0", true], ["1.2.4-rc.1", ">=1.2.3-rc.0 <1.3.0", false],
 ["1.2.3", "not-a-range", null], ["1.2.3", ">=1.2.3 garbage", null], ["bad", "*", null],
 ["1.2.3", "==1.2.3", null], ["1.2.3", ">==1.2.3", null], ["1.2.3", "<==1.2.3", null],
 ["1.2.3", "^=1.2.3", true], ["1.2.3", "~=1.2.3", true], ["1.2.3", "~>=1.2.3", true],
 ["1.5.0", "^1.x.3", true], ["2.0.0", "^1.x.3", false], ["1.5.0", "~1.x.3", true],
 ["1.5.0", "1.x.3", null], ["1.5.0", "^1.x.01", null], ["1.5.0", "1.x.3 - 2", true],
 ["1.2.3", "1.2.x-alpha", true], ["1.3.0", "1.2.x-alpha", false], ["1.2.3-alpha", "1.2.x-alpha", false],
 ["1.2.3", "1.2-alpha", null], ["1.2.3", "1.2.x-alpha..1", null], ["1.2.3", "1.2.x-01", null],
 ["1.2.3", "1.2.x+build", true], ["1.2.3", "^9007199254740991.0.0", null]
];
for (const [actual, range, expected] of cases) test(`peer ${actual} satisfies ${JSON.stringify(range)} -> ${expected}`, () => assert.equal(satisfies(actual, range), expected));

function writePackage(dir, pkg) { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify(pkg)); }
test("scan linked scopes/plugins across all profiles using profile and actual host providers", { skip: process.platform === "win32" }, t => {
 const f = makeFixture(); t.after(() => f.cleanup());
 const home = path.join(f.base, "profiles-home");
 const externalScope = path.join(f.base, "linked-scope");
 const plugin = path.join(f.base, "linked-plugin");
 writePackage(plugin, { name: "@fixture/plugin", version: "1.0.0", peerDependencies: { "@deepseek-ai/dsh-core": ">=0.2.0 <0.3.0", "@deepseek-ai/dsh-optional": "^9.0.0" }, peerDependenciesMeta: { "@deepseek-ai/dsh-optional": { optional: true } } });
 fs.mkdirSync(externalScope); fs.symlinkSync(plugin, path.join(externalScope, "plugin"), "dir");
 const modules = path.join(home,"profiles","custom","node_modules"); fs.mkdirSync(modules,{recursive:true}); fs.symlinkSync(externalScope,path.join(modules,"@fixture"),"dir");
 writePackage(path.join(f.installRoot,"node_modules","@deepseek-ai","dsh-core"), { name:"@deepseek-ai/dsh-core",version:"0.2.2",exports:{"./package.json":"./package.json"} });
 assert.deepEqual(pluginPeerWarningsFor(home,f.installRoot), []);
 writePackage(path.join(modules,"@deepseek-ai","dsh-core"), { name:"@deepseek-ai/dsh-core",version:"9.0.0" });
 const warnings=pluginPeerWarningsFor(home,f.installRoot);
 assert.equal(warnings.length,1); assert.equal(warnings[0].profile,"custom"); assert.equal(warnings[0].plugin,"@fixture/plugin"); assert.equal(warnings[0].mismatches.length,1); assert.match(warnings[0].mismatches[0],/has 9.0.0/);
});
