/* ==========================================================================
 * 端到端自测：用真实的无头 Edge/Chrome 打开 index.html，跑一遍主要操作并截图
 *
 *   npm install        # 只需一次（安装 puppeteer-core）
 *   npm run smoke      # 全部通过时退出码 0
 *
 * 想换浏览器：EDGE_PATH="C:/.../chrome.exe" npm run smoke
 * ========================================================================== */
import puppeteer from "puppeteer-core";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PAGE = "file:///" + path.join(ROOT, "index.html").replace(/\\/g, "/");
const DOCS = path.join(ROOT, "docs");

const EXES = [
  process.env.EDGE_PATH,
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe"
].filter(Boolean);
const exe = EXES.find(p => fs.existsSync(p));
if (!exe) {
  console.error("找不到 Edge / Chrome，可用 EDGE_PATH 指定浏览器路径");
  process.exit(2);
}

const problems = [];
const check = (ok, msg) => { if (!ok) problems.push(msg); console.log(`${ok ? "  ok  " : "  FAIL"} ${msg}`); };

const browser = await puppeteer.launch({
  executablePath: exe,
  headless: true,
  userDataDir: fs.mkdtempSync(path.join(os.tmpdir(), "labmgmt-")),
  args: ["--allow-file-access-from-files", "--no-first-run"],
  defaultViewport: { width: 1440, height: 950 }
});
fs.mkdirSync(DOCS, { recursive: true });

const page = await browser.newPage();
const errs = [];
page.on("pageerror", e => errs.push("pageerror: " + e.message));
page.on("console", m => { if (m.type() === "error") errs.push("console: " + m.text()); });

console.log("打开 " + PAGE);
await page.goto(PAGE, { waitUntil: "load" });
await page.waitForFunction(() => typeof window.render === "function");

/* ---------------------------- 1. 空数据启动 ---------------------------- */
const empty = await page.evaluate(() => ({
  welcome: !!document.querySelector("#content .welcome"),
  saved: localStorage.getItem(KEY)
}));
check(empty.welcome, "空数据时显示欢迎卡片");
check(!empty.saved, "打开页面不会自己写入 localStorage");

/* ---------------------------- 2. 示例数据 + 全视图渲染 ---------------------------- */
const demo = await page.evaluate(() => {
  loadDemo();
  const before = { mice: state.mice.length, logs: state.logs.length, reagents: state.reagents.length };
  const views = ["dash", "mice", "breeding", "reagents", "consumables", "logs", "data"];
  const rendered = views.map(v => { setView(v); return v + ":" + (document.querySelector("#content").children.length > 0); });
  setView("dash");
  return {
    before, rendered,
    persisted: JSON.parse(localStorage.getItem(KEY)).mice.length,
    charts: document.querySelectorAll("#content .hrow").length,
    bars: document.querySelectorAll("#content .trend .bar").length
  };
});
check(demo.before.mice === 3 && demo.before.reagents === 3, "载入示例数据（3 条小鼠 / 3 个试剂）");
check(demo.rendered.every(x => x.endsWith("true")), "7 个视图都能渲染：" + demo.rendered.join(","));
check(demo.persisted === 3, "改动写入 localStorage（labmgmt.v1）");
check(demo.charts >= 3, "概览：品系只数分布图有柱子（" + demo.charts + "）");
check(demo.bars === 30, "概览：近 30 天趋势图 30 根柱（" + demo.bars + "）");

/* ---------------------------- 3. 消耗预测 ---------------------------- */
const forecast = await page.evaluate(() => {
  const fbs = state.consumables.find(r => r.name.indexOf("FBS") >= 0);
  const u = usageOf("consumables", fbs);
  const list = reorderList("consumables");
  setView("consumables");
  return {
    day: u.day, daysLeft: u.daysLeft, suggest: suggestQty(u), win: u.win,
    inReorder: list.some(o => o.r.id === fbs.id),
    alerts: alerts().map(a => a.txt),
    panel: (document.getElementById("stockReorder") || {}).textContent || "",
    usageCell: document.querySelectorAll("#stockRows td .tag").length
  };
});
check(forecast.day > 0, "日均消耗算出来了（" + forecast.day.toFixed(3) + " 支/天，窗口 " + forecast.win + " 天）");
check(forecast.daysLeft !== null && forecast.daysLeft > 10 && forecast.daysLeft < 60, "可用天数合理（" + Math.round(forecast.daysLeft) + " 天）");
check(forecast.suggest >= 1, "建议补货量 ≥ 1（" + forecast.suggest + "）");
check(forecast.inReorder, "FBS 进入「补货建议」清单");
check(forecast.alerts.some(t => t.indexOf("用完") >= 0), "提醒里出现「约 N 天后用完」");
check(forecast.panel.indexOf("FBS") >= 0, "补货建议面板渲染了该品种");

/* ---------------------------- 4. 出库 / 超量拦截 ---------------------------- */
const stock = await page.evaluate(() => {
  const r = state.reagents[0];
  const before = num(r.qty), logsBefore = state.logs.length;
  openStock("reagents", r.id);
  const form = document.getElementById("mForm");
  form.querySelector('[name="action"]').value = "出库";
  form.querySelector('[name="qty"]').value = "9999";
  form.requestSubmit();
  const blocked = !document.getElementById("modal").classList.contains("hidden") && num(r.qty) === before;
  form.querySelector('[name="qty"]').value = "1";
  form.requestSubmit();
  return {
    blocked,
    after: num(r.qty), delta: before - num(r.qty),
    logs: state.logs.length - logsBefore,
    modalClosed: document.getElementById("modal").classList.contains("hidden")
  };
});
check(stock.blocked, "超量出库被拦住");
check(stock.delta === 1 && stock.logs === 1, "正常出库扣库存并留流水");
check(stock.modalClosed, "保存后弹窗关闭");

/* ---------------------------- 5. 表格导入（制表符粘贴） ---------------------------- */
const imp = await page.evaluate(() => {
  setView("data");
  document.getElementById("imp-text").value =
    "品系\t性别\t笼数\t只数/笼\t出生日期\t实验目的\n" +
    "C57BL/6J\t雄\t2\t5\t2026/01/05\t导入测试\n" +
    "BAD\t雌\t0\t0\t\t只数为 0 应被跳过\n" +
    "ICR\t雌\t3\t4\t46320\t日期序列号测试";
  previewImport();
  const parsed = importState.records.length, skipped = importState.skipped;
  doImport();
  const icr = state.mice.filter(r => r.strain === "ICR")[0];
  return { parsed, skipped, dob: icr ? icr.dob : "", mice: state.mice.length };
});
check(imp.parsed === 2 && imp.skipped === 1, "导入解析：识别 2 行、跳过 1 行");
check(/^2026-\d\d-\d\d$/.test(imp.dob), "Excel 日期序列号转换正确（46320 → " + imp.dob + "）");

/* ---------------------------- 6. 排序 / 搜索 / 撤销 ---------------------------- */
const misc = await page.evaluate(() => {
  setView("mice");
  const th = document.querySelector('th[data-sort="cages"]');
  th.click();
  const sorted = ui.sort.mice && ui.sort.mice.k === "cages";
  ui.q.mice = "BALB";
  const filtered = filterMice().length;
  ui.q.mice = "";
  setView("mice");
  const before = state.mice.length;
  undo();
  undo();
  return { sorted, filtered, before, after: state.mice.length };
});
check(misc.sorted, "点表头能排序");
check(misc.filtered === 1, "搜索筛选命中 1 条（BALB）");
check(misc.after < misc.before, "Ctrl+Z 撤销数据变化（" + misc.before + " → " + misc.after + "）");

/* ---------------------------- 7. CSV / 备份 / 打印 ---------------------------- */
const io = await page.evaluate(() => {
  setView("consumables");
  const csv = toCSV(["a", "b"], [["x,y", 'z"z']]);
  exportCSV("reorder");
  exportCSV("mice");
  backupJSON();
  setView("mice");
  printCages();
  return { csvOk: csv.indexOf('"x,y"') > 0 && csv.indexOf('"z""z"') > 0, cages: document.querySelectorAll("#printArea .cage").length };
});
check(io.csvOk, "CSV 转义正确（逗号 / 引号）");
check(io.cages > 0, "笼牌生成 " + io.cages + " 张");

/* ---------------------------- 8. 主题 ---------------------------- */
const themed = await page.evaluate(() => {
  const seq = [];
  ["auto", "light", "dark"].forEach(() => { cycleTheme(); seq.push(document.documentElement.dataset.theme); });
  themeMode = "dark"; applyTheme();
  const darkBg = getComputedStyle(document.body).backgroundColor;
  themeMode = "light"; applyTheme();
  const lightBg = getComputedStyle(document.body).backgroundColor;
  return { seq, darkBg, lightBg };
});
check(themed.darkBg !== themed.lightBg, "深色 / 浅色主题背景不同（" + themed.darkBg + " vs " + themed.lightBg + "）");

/* ---------------------------- 9. 响应式：860px 不横向溢出 ---------------------------- */
await page.setViewport({ width: 860, height: 900 });
await page.evaluate(() => { themeMode = "light"; applyTheme(); setView("reagents"); });
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
check(overflow <= 1, "窄屏（860px）无横向溢出（溢出 " + overflow + "px）");

/* ---------------------------- 10. 截图（演示模式，不碰 localStorage） ---------------------------- */
await page.setViewport({ width: 1440, height: 950 });
const shot = await browser.newPage();
await shot.setViewport({ width: 1440, height: 950 });
await shot.goto(PAGE + "?demo=1", { waitUntil: "load" });
await shot.waitForFunction(() => typeof window.render === "function");
const shotPages = [
  ["dash", "screenshot-dashboard.png"],
  ["mice", "screenshot-mice.png"],
  ["reagents", "screenshot-reagents.png"],
  ["logs", "screenshot-logs.png"]
];
for (const [view, file] of shotPages) {
  await shot.evaluate(v => { setView(v); }, view);
  await new Promise(r => setTimeout(r, 120));
  await shot.screenshot({ path: path.join(DOCS, file) });
}
await shot.evaluate(() => { themeMode = "dark"; applyTheme(); setView("dash"); });
await new Promise(r => setTimeout(r, 150));
await shot.screenshot({ path: path.join(DOCS, "screenshot-dark.png") });
const demoFlag = await shot.evaluate(() => {
  localStorage.removeItem(KEY);      // 先清干净，再故意触发一次 save()
  state.settings.expWarn = 45;
  save();
  return { demo: DEMO, stored: localStorage.getItem(KEY) };
});
check(demoFlag.demo && !demoFlag.stored, "?demo=1 演示模式不写入 localStorage");
console.log("截图已写入 docs/（" + (shotPages.length + 1) + " 张）");

/* ---------------------------- 汇总 ---------------------------- */
check(errs.length === 0, "控制台无报错" + (errs.length ? "：" + errs.join(" | ") : ""));
await browser.close();

console.log(problems.length ? `\n✗ ${problems.length} 项未通过` : "\n✓ 全部通过");
process.exit(problems.length ? 1 : 0);
