// 跨进程探针：在一个全新的 node 进程里 import 宿主半体、挂路由、GET /auth，
// 把响应原样打到 stdout。用于验证「重启后新进程能从磁盘读到 token」——
// 这是模块级 `let githubToken = readGithubToken()` 的真实语义，只能在进程边界外证。
import { importHost, startHost, request } from "./host.mjs";

const mod = await importHost();
const host = await startHost(mod);
const res = await request(host.port, "/dsh-about/auth");
await host.close();
process.stdout.write(JSON.stringify({ status: res.status, body: res.body, json: res.json }));
