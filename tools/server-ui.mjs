#!/usr/bin/env node
/* ==========================================================================
 * 多用户版浏览器端到端自测（真 Edge + 真服务器）
 *
 *   node tools/server-ui.mjs
 *
 * 覆盖：登录界面 → 管理员登录 → 界面新增记录真的写到服务器 → 账号管理建账号
 *       → 只读账号被强制改密码 → 只读界面确实不能改 → 操作日志有记录
 * 顺带刷新 docs/ 下的多用户截图。
 * ========================================================================== */
import puppeteer from "puppeteer-core";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DOCS = path.join(ROOT, "docs");
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), "labmgmt-ui-"));
const PORT = 18700 + Math.floor(Math.random() * 500);
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_PW = "AdminTest123";

const EXES = [
  process.env.EDGE_PATH,
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe"
].filter(Boolean);
const exe = EXES.find(p => fs.existsSync(p));
if (!exe) { console.error("找不到 Edge / Chrome，可用 EDGE_PATH 指定"); process.exit(2); }

const problems = [];
const check = (ok, msg) => { if (!ok) problems.push(msg); console.log(`${ok ? "  ok  " : "  FAIL"} ${msg}`); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
fs.mkdirSync(DOCS, { recursive: true });

/* ---------- 服务器 ---------- */
const srv = spawn(process.execPath, [path.join(ROOT, "server", "index.js"), "--port", String(PORT)], {
  cwd: ROOT,
  env: Object.assign({}, process.env, { PORT: String(PORT), DATA_DIR: DATA, ADMIN_PASSWORD: ADMIN_PW }),
  stdio: ["ignore", "pipe", "pipe"]
});
srv.stdout.on("data", () => {});
srv.stderr.on("data", d => process.stderr.write("[server] " + d.toString()));

async function waitHealth(ms = 12000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { const r = await fetch(BASE + "/api/health"); if (r.ok) return true; } catch (e) { /* wait */ }
    await sleep(120);
  }
  return false;
}
const health = () => fetch(BASE + "/api/health").then(r => r.json());

const browser = await puppeteer.launch({
  executablePath: exe,
  headless: true,
  userDataDir: fs.mkdtempSync(path.join(os.tmpdir(), "labmgmt-br-")),
  args: ["--no-first-run"],
  defaultViewport: { width: 1440, height: 950 }
});
const page = await browser.newPage();
const errs = [];
page.on("pageerror", e => errs.push("pageerror: " + e.message));
page.on("console", m => {
  const t = m.text();
  if (m.type() !== "error") return;
  if (/favicon/i.test(t)) return;
  // 登录前的 401 探测、故意输错密码的 401、未改密码的 403 都是预期行为，
  // 浏览器会把失败的网络响应也记成 console error，这里只保留真正的 JS 错误
  if (/Failed to load resource/i.test(t)) return;
  errs.push("console: " + t);
});
page.on("dialog", d => d.accept());

const login = async (u, p) => {
  await page.waitForSelector("#authUser", { visible: true, timeout: 8000 });
  await page.$eval("#authUser", el => { el.value = ""; });
  await page.$eval("#authPw", el => { el.value = ""; });
  await page.type("#authUser", u);
  await page.type("#authPw", p);
  await page.click("#authForm button[type=submit]");
};

try {
  check(await waitHealth(), "服务器已启动");

  await page.goto(BASE + "/", { waitUntil: "load" });
  await page.waitForFunction(() => typeof window.bootRemote === "function");
  await page.waitForSelector("#authScreen:not(.hidden)", { timeout: 8000 });
  const loginText = await page.$eval("#authScreen", el => el.textContent);
  check(/登录/.test(loginText), "连服务器时先出现登录界面（不是直接进数据）");
  check(!(await page.evaluate(() => document.querySelector("#content").innerHTML.includes("在养总只数"))), "登录前不显示业务数据");
  await page.screenshot({ path: path.join(DOCS, "server-login.png") });

  /* 密码错 → 有错误提示，不进入 */
  await login("admin", "wrong-pass");
  await page.waitForFunction(() => document.querySelector("#authErr") && document.querySelector("#authErr").textContent.trim() !== "", { timeout: 6000 });
  check(true, "密码错误时给出提示");
  check(await page.evaluate(() => !document.querySelector("#authScreen").classList.contains("hidden")), "密码错误不会进入系统");

  /* 正确登录 */
  await login("admin", ADMIN_PW);
  await page.waitForFunction(() => document.querySelector("#authScreen").classList.contains("hidden"), { timeout: 8000 });
  await page.waitForFunction(() => document.querySelector("#content").children.length > 0);
  const chip = await page.$eval("#userChip", el => el.textContent);
  check(/管理员/.test(chip), "顶栏显示当前用户和角色：" + chip.trim());
  check(await page.evaluate(() => MODE === "server"), "前端进入 server 模式");
  check(await page.evaluate(() => document.querySelectorAll('#nav button[data-admin]').length === 2 &&
    [...document.querySelectorAll('#nav button[data-admin]')].every(b => b.style.display !== "none")), "管理员能看到账号管理与操作日志");

  /* 界面新增一条小鼠 → 真的写进服务器 */
  await page.evaluate(() => setView("mice"));
  console.log("    · 已切到小鼠视图");
  await page.click('#content .toolbar button[data-act="new"]');
  console.log("    · 已点新增");
  await page.waitForSelector("#modal:not(.hidden)", { timeout: 8000 });
  console.log("    · 编辑框已打开");
  await page.type("#f_strain", "C57BL/6J");
  await page.$eval("#f_cages", el => { el.value = "4"; });
  await page.$eval("#f_perCage", el => { el.value = "5"; });
  await page.type("#f_purpose", "黑素瘤模型，观察 21 天");
  await page.click("#mForm button[type=submit]");
  await page.waitForFunction(() => document.querySelector("#modal").classList.contains("hidden"), { timeout: 8000 });
  await sleep(1500);
  const h1 = await health();
  check(h1.rev >= 1, "界面新增的记录已同步到服务器（rev=" + h1.rev + "）");
  check(await page.evaluate(() => isAdmin() && canWrite()), "管理员可写");

  /* 账号管理 */
  await page.evaluate(() => setView("users"));
  await page.waitForFunction(() => document.querySelectorAll("#userRows tbody tr").length >= 1, { timeout: 8000 });
  await page.screenshot({ path: path.join(DOCS, "server-users.png") });
  await page.type("#nu-user", "wang");
  await page.type("#nu-name", "王五");
  await page.type("#nu-pw", "Wang12345678");
  await page.select("#nu-role", "viewer");
  await page.click("#newUserForm button[type=submit]");
  await page.waitForFunction(() => document.querySelectorAll("#userRows tbody tr").length >= 2, { timeout: 8000 });
  check(true, "管理员在界面上新建了账号（只读）");

  /* 操作日志 */
  await page.evaluate(() => setView("audit"));
  await page.waitForFunction(() => document.querySelectorAll("#auRows tbody tr").length >= 1, { timeout: 8000 });
  const auditTxt = await page.$eval("#auRows", el => el.textContent);
  check(/登录/.test(auditTxt), "操作日志里有登录记录");
  check(/修改数据/.test(auditTxt), "操作日志里有数据修改记录");
  await page.screenshot({ path: path.join(DOCS, "server-audit.png") });

  /* 退出 → 只读账号登录 → 强制改密码 */
  await page.click("#btnLogout");
  await page.waitForSelector("#authScreen:not(.hidden)", { timeout: 8000 });
  await login("wang", "Wang12345678");
  await page.waitForSelector("#authOld", { visible: true, timeout: 8000 });
  check(true, "新账号首次登录被要求先改密码");
  await page.type("#authOld", "Wang12345678");
  await page.type("#authNew", "Wang87654321");
  await page.type("#authNew2", "Wang87654321");
  await page.click("#authForm button[type=submit]");
  await page.waitForFunction(() => document.querySelector("#authScreen").classList.contains("hidden"), { timeout: 10000 });
  const chip2 = await page.$eval("#userChip", el => el.textContent);
  check(/只读/.test(chip2), "改成自己的密码后进入，角色显示只读：" + chip2.trim());
  check(await page.evaluate(() => document.querySelector("#roBar").style.display !== "none"), "只读账号有只读提示条");
  check(await page.evaluate(() => [...document.querySelectorAll('#nav button[data-admin]')].every(b => b.style.display === "none")), "只读账号看不到账号管理 / 操作日志");
  await page.screenshot({ path: path.join(DOCS, "server-readonly.png") });

  /* 只读点「新增」被拦 */
  await page.evaluate(() => setView("mice"));
  await page.click('#content .toolbar button[data-act="new"]');
  await sleep(300);
  check(await page.evaluate(() => document.querySelector("#modal").classList.contains("hidden")), "只读账号点「新增」打不开编辑框");
  const toastTxt = await page.$eval("#toast", el => el.textContent);
  check(/只读/.test(toastTxt), "拦截时给出提示：" + toastTxt.trim());

  /* 刷新后仍然登录（会话在 cookie 里） */
  await page.reload({ waitUntil: "load" });
  await page.waitForFunction(() => typeof ME !== "undefined" && !!ME && ME.role === "viewer", { timeout: 10000 });
  await page.waitForFunction(() => document.querySelector("#authScreen") && document.querySelector("#authScreen").classList.contains("hidden"), { timeout: 8000 });
  check(true, "刷新页面后不用重新登录（会话保持）");

  check(errs.length === 0, "整页没有 JS 报错" + (errs.length ? "：" + errs.join(" | ") : ""));
} catch (e) {
  problems.push("异常中断：" + e.message);
  console.log("  FAIL 异常中断：" + e.message);
  try { await page.screenshot({ path: path.join(DOCS, "server-error.png") }); } catch (_) { /* ignore */ }
} finally {
  try { await browser.close(); } catch (e) { /* ignore */ }
  srv.kill();
  await sleep(400);
  try { fs.rmSync(DATA, { recursive: true, force: true }); } catch (e) { /* ignore */ }
}

console.log(`\n多用户界面自测：${problems.length ? problems.length + " 项失败" : "全部通过"}`);
if (problems.length) { problems.forEach(p => console.log("  - " + p)); process.exit(1); }
