#!/usr/bin/env node
/* ==========================================================================
 * 多用户服务器自测：真启进程 + 真发 HTTP 请求
 *
 *   node tools/server-smoke.mjs
 *
 * 覆盖：登录/登出、密码校验、三种角色的权限边界、增量同步、
 *       并发写入不互相覆盖、用户管理、最后管理员保护、
 *       审计日志、静态页、路径穿越、重启后数据与会话仍在。
 * ========================================================================== */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), "labmgmt-srv-"));
const PORT = 18100 + Math.floor(Math.random() * 600);
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_PW = "AdminTest123";

let pass = 0, fail = 0;
const results = [];
function ok(name, cond, extra) {
  if (cond) { pass++; results.push(`  ok   ${name}`); }
  else { fail++; results.push(`  FAIL ${name}${extra ? "  → " + extra : ""}`); }
}
const eq = (name, actual, expected) =>
  ok(name, JSON.stringify(actual) === JSON.stringify(expected), `得到 ${JSON.stringify(actual)}，期望 ${JSON.stringify(expected)}`);

/* ---------- 客户端：每个用户一个 cookie jar ---------- */
function client() {
  let cookie = "";
  return async function call(pathname, opts = {}) {
    const headers = Object.assign({}, opts.headers);
    if (cookie) headers.cookie = cookie;
    if (opts.json !== undefined) {
      headers["content-type"] = "application/json";
      opts.body = JSON.stringify(opts.json);
    } else if (opts.form !== undefined) {
      headers["content-type"] = "application/x-www-form-urlencoded";
      opts.body = opts.form;
    }
    const r = await fetch(BASE + pathname, { method: opts.method || (opts.body ? "POST" : "GET"), headers, body: opts.body, redirect: "manual" });
    const set = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
    if (set.length) {
      cookie = set.map(s => s.split(";")[0]).join("; ");
    }
    const text = await r.text();
    let body = text;
    try { body = JSON.parse(text); } catch (e) { /* 非 JSON（静态页）原样保留 */ }
    return { status: r.status, body, headers: r.headers, text };
  };
}

/* ---------- 起服务 ---------- */
const children = [];
function startServer(extraEnv = {}) {
  const child = spawn(process.execPath, [path.join(ROOT, "server", "index.js"), "--port", String(PORT)], {
    cwd: ROOT,
    env: Object.assign({}, process.env, { PORT: String(PORT), DATA_DIR: DATA, ADMIN_PASSWORD: ADMIN_PW }, extraEnv),
    stdio: ["ignore", "pipe", "pipe"]
  });
  child.stdout.on("data", () => {});
  child.stderr.on("data", d => process.stderr.write("[server] " + d.toString()));
  children.push(child);
  return child;
}
async function waitHealth(timeoutMs = 12000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const r = await fetch(BASE + "/api/health");
      if (r.ok) return true;
    } catch (e) { /* 还没起来 */ }
    await new Promise(r => setTimeout(r, 120));
  }
  return false;
}
function stop(child) {
  return new Promise(resolve => {
    if (!child || child.exitCode !== null) return resolve();
    child.once("exit", resolve);
    child.kill();
    setTimeout(resolve, 2500);
  });
}

/* ---------- 跑测试 ---------- */
const admin = client();
const editor = client();
const viewer = client();

try {
  let child = startServer();
  ok("服务器能在 12 秒内起来", await waitHealth());

  /* 1. 基础 */
  const h = await fetch(BASE + "/api/health").then(r => r.json());
  ok("health 带 server:true 标记", h.server === true);
  eq("/api/me 未登录 → 401", (await admin("/api/me")).status, 401);
  eq("未登录读 /api/bootstrap → 401", (await admin("/api/bootstrap")).status, 401);
  eq("未登录写 /api/sync → 401", (await admin("/api/sync", { json: { patch: {} } })).status, 401);

  /* 2. 登录 */
  eq("密码错 → 401", (await admin("/api/login", { json: { username: "admin", password: "nope" } })).status, 401);
  const login = await admin("/api/login", { json: { username: "admin", password: ADMIN_PW } });
  eq("管理员登录 → 200", login.status, 200);
  ok("管理员拿到全部写权限", login.body.perms && login.body.perms.writeData && login.body.perms.manageUsers && login.body.perms.backup);
  ok("用 ADMIN_PASSWORD 初始化时不需要强制改密码", login.body.user.mustChangePassword === false);
  ok("登录响应不下发密码哈希", !JSON.stringify(login.body).includes("scrypt"));

  /* 3. 初始数据 */
  const boot0 = await admin("/api/bootstrap");
  eq("初始 rev = 0", boot0.body.rev, 0);
  eq("初始小鼠为空", boot0.body.data.mice, []);

  /* 4. 写入 + 增量 */
  const m1 = { id: "m1", strain: "C57BL/6J", sex: "雄", cages: 3, perCage: 5, status: "在养" };
  const s1 = await admin("/api/sync", { json: { baseRev: 0, patch: { mice: { up: [m1], del: [] } } } });
  eq("管理员写入 1 条 → 200", s1.status, 200);
  eq("rev 递增到 1", s1.body.rev, 1);
  const ch = await admin("/api/changes?since=0");
  ok("增量接口能拿到刚才那条", ch.body.changes.some(c => c.coll === "mice" && c.id === "m1"));
  eq("/api/changes?since=当前 返回空", (await admin("/api/changes?since=1")).body.changes, []);

  /* 5. 建用户 */
  const uEditor = await admin("/api/users", { json: { username: "li", name: "李四", password: "Editor12345", role: "editor" } });
  eq("管理员建实验员 → 200", uEditor.status, 200);
  const uViewer = await admin("/api/users", { json: { username: "guest", name: "访客", password: "Viewer12345", role: "viewer" } });
  eq("管理员建只读账号 → 200", uViewer.status, 200);
  eq("重复用户名被拒", (await admin("/api/users", { json: { username: "li", password: "Editor12345", role: "editor" } })).status, 400);
  eq("弱密码被拒", (await admin("/api/users", { json: { username: "weak", password: "123", role: "viewer" } })).status, 400);

  /* 6. 实验员 */
  const lLogin = await editor("/api/login", { json: { username: "li", password: "Editor12345" } });
  eq("实验员登录 → 200", lLogin.status, 200);
  ok("实验员能写数据但不能改设置/管账号", lLogin.body.perms.writeData && !lLogin.body.perms.writeSettings && !lLogin.body.perms.manageUsers);
  ok("新建账号默认要求首次改密码", lLogin.body.user.mustChangePassword === true);
  eq("首登未改密码时写数据被拦 → 403", (await editor("/api/sync", { json: { baseRev: 1, patch: { mice: { up: [{ id: "x" }] } } } })).status, 403);
  eq("首登未改密码时连数据都看不到（防共用初始密码乱翻）→ 403", (await editor("/api/bootstrap")).status, 403);
  const chpw = await editor("/api/password", { json: { old: "Editor12345", new: "Editor67890" } });
  eq("实验员改密码 → 200", chpw.status, 200);
  const editorAfter = await editor("/api/bootstrap");
  ok("改完密码后 mustChangePassword 清掉", editorAfter.body.user && editorAfter.body.user.mustChangePassword === false);

  const e1 = await editor("/api/sync", { json: { baseRev: 1, patch: { mice: { up: [{ id: "m2", strain: "BALB/c", cages: 2, perCage: 4 }], del: [] } } } });
  eq("实验员能新增记录", e1.status, 200);
  const e2 = await editor("/api/sync", { json: { baseRev: 2, patch: { settings: { expWarn: 99 } } } });
  eq("实验员改全局设置被静默忽略", e2.status, 200);
  const afterSet = await admin("/api/bootstrap");
  eq("全局设置没被实验员改掉", afterSet.body.data.settings.expWarn, 30);

  /* 7. 只读账号 */
  const vLogin = await viewer("/api/login", { json: { username: "guest", password: "Viewer12345" } });
  eq("只读登录 → 200", vLogin.status, 200);
  eq("只读改自己密码 → 200", (await viewer("/api/password", { json: { old: "Viewer12345", new: "Viewer67890" } })).status, 200);
  eq("只读能看数据", (await viewer("/api/bootstrap")).status, 200);
  const vWrite = await viewer("/api/sync", { json: { baseRev: 3, patch: { mice: { up: [{ id: "m3", strain: "X" }] } } } });
  eq("只读写数据被拒 → 403", vWrite.status, 403);
  eq("只读建账号被拒 → 403", (await viewer("/api/users", { json: { username: "z", password: "Zzzzzz123", role: "admin" } })).status, 403);
  eq("只读看审计被拒 → 403", (await viewer("/api/audit")).status, 403);
  eq("只读导出全库被拒 → 403", (await viewer("/api/export")).status, 403);

  /* 8. 并发：两人改不同记录，互不覆盖 */
  const a = await admin("/api/bootstrap");
  const revNow = a.body.rev;
  await Promise.all([
    admin("/api/sync", { json: { baseRev: revNow, patch: { mice: { up: [{ id: "m1", strain: "C57BL/6J", cages: 3, perCage: 5, note: "管理员改的" }] } } } }),
    editor("/api/sync", { json: { baseRev: revNow, patch: { mice: { up: [{ id: "m2", strain: "BALB/c", cages: 2, perCage: 4, note: "实验员改的" }] } } } })
  ]);
  const merged = await admin("/api/bootstrap");
  const mm1 = merged.body.data.mice.find(r => r.id === "m1");
  const mm2 = merged.body.data.mice.find(r => r.id === "m2");
  ok("并发写不同记录都保住了", mm1 && mm1.note === "管理员改的" && mm2 && mm2.note === "实验员改的");
  ok("记录上留下最后修改人", mm1 && mm1._by === "管理员" && mm2 && mm2._by === "李四");
  eq("没有产生重复记录", merged.body.data.mice.length, 2);

  /* 9. 删除 */
  const del = await admin("/api/sync", { json: { baseRev: merged.body.rev, patch: { mice: { up: [], del: ["m2"] } } } });
  eq("删除记录 → 200", del.status, 200);
  eq("删除真的生效", (await admin("/api/bootstrap")).body.data.mice.length, 1);

  /* 10. 用户管理边界 */
  eq("不能删自己", (await admin("/api/users/" + login.body.user.id, { method: "DELETE" })).status, 400);
  eq("不能降低最后一个管理员", (await admin("/api/users/" + login.body.user.id, { method: "PATCH", json: { role: "viewer" } })).status, 400);
  const users = await admin("/api/users");
  eq("用户列表 3 个", users.body.users.length, 3);
  ok("用户列表不含密码哈希", !JSON.stringify(users.body).includes("scrypt"));

  /* 11. 审计 */
  const audit = await admin("/api/audit?limit=50");
  ok("审计里有登录记录", audit.body.entries.some(e => e.action === "login"));
  ok("审计里有写入记录", audit.body.entries.some(e => e.action === "sync"));
  ok("审计里有失败登录记录", audit.body.entries.some(e => e.action === "login-failed"));
  ok("审计里有建账号记录", audit.body.entries.some(e => e.action === "user-create"));

  /* 12. 静态页与路径穿越 */
  const page = await fetch(BASE + "/");
  const html = await page.text();
  eq("首页 200", page.status, 200);
  ok("首页是管理台", html.includes("实验室管理台"));
  eq("路径穿越被挡 → 404", (await fetch(BASE + "/../server/index.js")).status, 404);
  eq("data 目录不可访问 → 404", (await fetch(BASE + "/data/db.json")).status, 404);
  eq("users.json 不可访问 → 404", (await fetch(BASE + "/data/users.json")).status, 404);

  /* 13. 表单提交被 Content-Type 挡住 */
  eq("w 跨站表单写法 → 415", (await admin("/api/sync", { form: "patch=%7B%7D" })).status, 415);

  /* 14. 备份导出 / 全库恢复 */
  const exp = await admin("/api/export");
  eq("导出 200", exp.status, 200);
  ok("导出内容是小鼠数据", Array.isArray(exp.body.mice) && exp.body.mice.length === 1);
  ok("导出不含密码", !JSON.stringify(exp.body).includes("scrypt"));

  /* 15. 重启后：数据、密码、会话都还在 */
  await stop(child);
  child = startServer();
  ok("服务器重启成功", await waitHealth());
  const afterRestart = await admin("/api/bootstrap");
  eq("重启后数据仍在", afterRestart.body.data.mice.length, 1);
  eq("重启后用原会话仍可访问（没被踢下线）", afterRestart.status, 200);
  const reLogin = await client()("/api/login", { json: { username: "li", password: "Editor67890" } });
  eq("重启后新密码仍有效", reLogin.status, 200);
  eq("重启后旧密码无效", (await client()("/api/login", { json: { username: "li", password: "Editor12345" } })).status, 401);

  /* 16. 登录限速 */
  const attacker = client();
  let locked = 0;
  for (let i = 0; i < 8; i++) {
    const r = await attacker("/api/login", { json: { username: "li", password: "bad" + i } });
    if (r.status === 429) { locked = 1; break; }
  }
  ok("连续失败会被限速（429）", locked === 1);
  eq("限速状态下正确密码也进不来", (await client()("/api/login", { json: { username: "li", password: "Editor67890" } })).status, 429);

  /* 17. 全库恢复 */
  const imp = await (async () => {
    const c = client();
    await c("/api/login", { json: { username: "admin", password: ADMIN_PW } });
    return c;
  })();
  const restore = await imp("/api/import", { json: { data: { mice: [{ id: "z1", strain: "恢复测试", cages: 1, perCage: 1 }], reagents: [], consumables: [], breeding: [], logs: [] } } });
  eq("管理员全库恢复 → 200", restore.status, 200);
  eq("恢复后只剩新数据", (await imp("/api/bootstrap")).body.data.mice.length, 1);
} catch (e) {
  fail++;
  results.push("  FAIL 异常中断：" + (e && e.stack || e));
} finally {
  for (const c of children) await stop(c);
  try { fs.rmSync(DATA, { recursive: true, force: true }); } catch (e) { /* ignore */ }
}

console.log(results.join("\n"));
console.log(`\n多用户服务器自测：${pass} 项通过，${fail} 项失败`);
process.exit(fail ? 1 : 0);
