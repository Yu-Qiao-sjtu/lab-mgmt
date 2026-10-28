"use strict";
/* ==========================================================================
 * 实验室管理台 · 单文件离线版
 * 小鼠 / 繁育 / 试剂 / 耗材 / 出入库 / 成本 / 备份
 *
 * 设计约束：
 *   1. 只有一个 index.html，双击就能用，不需要装任何东西；
 *   2. 数据全部留在本机浏览器 localStorage，不联网、不上传；
 *   3. 老版本数据必须能直接打开（键名 labmgmt.v1 永不改，靠 meta.v 迁移）。
 * ========================================================================== */

const KEY = "labmgmt.v1";          // 历史键名，勿改：改了老用户的数据就读不到
const SNAP_KEY = "labmgmt.snapshots"; // 每日自动快照
const THEME_KEY = "labmgmt.theme";    // 主题偏好（独立存，避免污染业务数据）
const DATA_V = 3;

/* index.html?demo=1 → 演示模式：载入示例数据、只读不存，用于在线预览 / 截图 */
const DEMO = /(^|[?&])demo(=|&|$)/.test(location.search);

/* ---------------------------- 基础工具 ---------------------------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const uid = () => Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
const pad2 = n => String(n).padStart(2, "0");
const num = v => { const n = parseFloat(String(v ?? "").replace(/[,，\s]/g, "")); return isNaN(n) ? 0 : n; };
const numOrNull = v => { const s = String(v ?? "").replace(/[,，\s]/g, ""); if (s === "") return null; const n = parseFloat(s); return isNaN(n) ? null : n; };
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const nf = n => (Math.round(n * 10) / 10).toString();
const nf2 = n => (Math.round(n * 100) / 100).toString();
const money = n => (Math.round(n * 100) / 100).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const cut = (s, n = 60) => { const t = String(s ?? ""); return t.length > n ? t.slice(0, n) + "…" : t; };
const todayStr = () => new Date().toLocaleDateString("sv-SE");

/* 日期：统一成 YYYY-MM-DD；兼容 Excel 里常见的 2026/10/28、2026.10.28、日期序列号 */
function isoDate(v) {
  if (v === null || v === undefined || v === "") return "";
  const s0 = String(v).trim();
  if (/^\d{5}(\.\d+)?$/.test(s0)) {
    const n = Number(s0);
    if (n > 20000 && n < 80000) {
      return new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 86400000).toISOString().slice(0, 10);
    }
  }
  const m = s0.match(/^(\d{4})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})/);
  if (m) return `${m[1]}-${pad2(m[2])}-${pad2(m[3])}`;
  const d = new Date(s0.replace(/\./g, "-"));
  return isNaN(d.getTime()) ? "" : d.toLocaleDateString("sv-SE");
}
function addDays(date, n) {
  if (!date) return "";
  const d = new Date(date + "T00:00:00");
  if (isNaN(d.getTime())) return "";
  d.setDate(d.getDate() + n);
  return d.toLocaleDateString("sv-SE");
}
/* 距离今天还有多少天：正数=将来，负数=已过去，空/非法=null */
function dayDiff(date) {
  if (!date) return null;
  const d = new Date(date + "T00:00:00");
  if (isNaN(d.getTime())) return null;
  return Math.round((d.getTime() - new Date(todayStr() + "T00:00:00").getTime()) / 86400000);
}
function download(text, filename, mime) {
  const blob = new Blob([text], { type: mime || "text/plain;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

/* ---------------------------- 数据层 ---------------------------- */
function blankState() {
  return {
    mice: [], breeding: [], reagents: [], consumables: [], logs: [],
    settings: {
      expWarn: 30, gestDays: 20, weanDays: 21, cardLayout: "6", snapshots: 7,
      usageDays: 90,    // 消耗预测的统计窗口（天）
      reorderDays: 30,  // 库存还能撑几天时提醒补货
      theme: "auto"     // auto / light / dark
    },
    meta: { v: DATA_V, updated: null, createdAt: null }
  };
}

/* 把任意来源（老数据 / JSON 备份 / 表格导入）的记录修剪成统一形状 */
function normalizeRecord(kind, r) {
  const o = Object.assign({}, r);
  if (!o.id) o.id = uid();
  if (!o.createdAt) o.createdAt = new Date().toISOString();
  if (kind === "mice") {
    o.strain = String(o.strain || "").trim();
    o.cages = numOrNull(o.cages) ?? 0;
    o.perCage = numOrNull(o.perCage) ?? 0;
    o.ageWeeks = numOrNull(o.ageWeeks);
    o.dob = isoDate(o.dob);
    o.ageDate = isoDate(o.ageDate);
    o.status = o.status === "已结束" ? "已结束" : "在养";
  } else if (kind === "breeding") {
    o.strain = String(o.strain || "").trim();
    o.paired = isoDate(o.paired);
    o.pregCheck = isoDate(o.pregCheck);
    o.born = isoDate(o.born);
    o.weanedDate = isoDate(o.weanedDate);
    ["pups", "weanedCount", "destCages", "destPerCage"].forEach(k => { o[k] = numOrNull(o[k]); });
    if (["配对中", "怀孕", "哺乳", "已断奶", "已结束"].indexOf(o.status) < 0) o.status = "配对中";
  } else {
    o.name = String(o.name || "").trim();
    o.qty = numOrNull(o.qty) ?? 0;
    o.min = numOrNull(o.min) ?? 0;
    if (kind === "reagents") {
      o.unitPrice = numOrNull(o.unitPrice);
      o.openDate = isoDate(o.openDate);
      o.expiry = isoDate(o.expiry);
    }
  }
  return o;
}

function migrate(raw) {
  const b = blankState();
  if (!raw || typeof raw !== "object") return b;
  return {
    mice: (Array.isArray(raw.mice) ? raw.mice : []).map(r => normalizeRecord("mice", r)),
    breeding: (Array.isArray(raw.breeding) ? raw.breeding : []).map(r => normalizeRecord("breeding", r)),
    reagents: (Array.isArray(raw.reagents) ? raw.reagents : []).map(r => normalizeRecord("reagents", r)),
    consumables: (Array.isArray(raw.consumables) ? raw.consumables : []).map(r => normalizeRecord("consumables", r)),
    logs: (Array.isArray(raw.logs) ? raw.logs : []).map(l => {
      const o = Object.assign({}, l);
      if (!o.id) o.id = uid();
      o.date = isoDate(o.date) || todayStr();
      o.qty = num(o.qty);
      o.unitPrice = numOrNull(o.unitPrice);
      o.amount = numOrNull(o.amount);
      if (o.amount === null && o.unitPrice !== null) o.amount = Math.round(o.qty * o.unitPrice * 100) / 100;
      if (!o.ts) o.ts = new Date(o.date + "T00:00:00").getTime() || Date.now();
      return o;
    }),
    settings: Object.assign({}, b.settings, raw.settings || {}),
    meta: Object.assign({}, b.meta, raw.meta || {}, { v: DATA_V })
  };
}

function loadState() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return blankState();
    return migrate(JSON.parse(raw));
  } catch (e) {
    console.warn("读取本地数据失败，已按空数据启动", e);
    return blankState();
  }
}

let state = DEMO ? blankState() : loadState();
if (DEMO) state.meta.demo = 1;

function save() {
  if (DEMO) { paintSaveInfo(); return true; } // 演示模式：只在内存里改，绝不写入本机存储
  state.meta.updated = Date.now();
  if (!state.meta.createdAt) state.meta.createdAt = state.meta.updated;
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    dailySnapshot();
  } catch (e) {
    toast("保存失败：浏览器存储空间不足，请先到「数据 · 设置」导出 JSON 备份", true);
    paintSaveInfo();
    return false;
  }
  paintSaveInfo();
  return true;
}

function paintSaveInfo() {
  const t = state.meta.updated ? new Date(state.meta.updated) : null;
  const el = $("#saveInfo");
  if (!el) return;
  if (DEMO) {
    el.textContent = "演示模式：示例数据不保存\n下载 index.html 双击即可录入真实数据";
    el.style.whiteSpace = "pre-line";
    return;
  }
  el.textContent = t
    ? `已自动保存 ${t.getFullYear()}-${pad2(t.getMonth() + 1)}-${pad2(t.getDate())} ${pad2(t.getHours())}:${pad2(t.getMinutes())}\nv${state.meta.v} · Ctrl+Z 撤销 · Ctrl+K 搜索`
    : "尚无数据，改动会自动保存在本机";
  el.style.whiteSpace = "pre-line";
}

/* ---------- 每日快照：每天第一次保存时留一份，最多留 N 份 ---------- */
function readSnapshots() {
  try {
    const list = JSON.parse(localStorage.getItem(SNAP_KEY) || "[]");
    return Array.isArray(list) ? list.filter(s => s && s.date && typeof s.json === "string") : [];
  } catch (e) { return []; }
}
function dailySnapshot() {
  const today = todayStr();
  const list = readSnapshots();
  if (list.length && list[0].date === today) return;
  const json = JSON.stringify(state);
  if (json.length > 1200000) return; // 数据太大就不占空间了
  list.unshift({ date: today, ts: Date.now(), json });
  const keep = Math.max(1, Math.min(30, num(state.settings.snapshots) || 7));
  localStorage.setItem(SNAP_KEY, JSON.stringify(list.slice(0, keep)));
}
function snapshotInfo() {
  const list = readSnapshots();
  return { list, bytes: list.reduce((n, s) => n + s.json.length, 0) };
}
function restoreSnapshot(date) {
  const s = readSnapshots().find(x => x.date === date);
  if (!s) { toast("快照不存在，可能已被清理", true); return; }
  if (!confirm(`用 ${date} 的自动快照覆盖当前数据？\n当前数据会先放进撤销栈（Ctrl+Z 可回退）。`)) return;
  pushUndo("恢复快照 " + date);
  try { state = migrate(JSON.parse(s.json)); } catch (e) { toast("快照已损坏，无法恢复", true); return; }
  save();
  render();
  toast("已恢复到 " + date + " 的快照");
}

/* ---------- 撤销：每次写操作前压一份状态，Ctrl+Z 回退 ---------- */
const undoStack = [];
function pushUndo(label) {
  try { undoStack.push({ label: label || "操作", json: JSON.stringify(state) }); } catch (e) { return; }
  if (undoStack.length > 20) undoStack.shift();
  paintUndo();
}
function paintUndo() {
  const box = $("#topActions");
  if (!box) return;
  const has = undoStack.length > 0;
  box.innerHTML = `<button class="btn mini ghost" id="btn-undo" type="button"${has ? "" : " disabled"} title="Ctrl+Z">↩ 撤销${has ? "（" + esc(cut(undoStack[undoStack.length - 1].label, 14)) + "）" : ""}</button>`;
  const b = $("#btn-undo");
  if (b) b.onclick = undo;
}
function undo() {
  const snap = undoStack.pop();
  if (!snap) { toast("没有可撤销的操作", true); return; }
  try { state = migrate(JSON.parse(snap.json)); } catch (e) { toast("撤销失败", true); return; }
  save();
  render();
  toast("已撤销：" + snap.label);
}

/* ---------------------------- 提示条 ---------------------------- */
let toastTimer;
function toast(msg, isErr) {
  const el = $("#toast");
  if (!el) return;
  el.textContent = msg;
  el.className = "show" + (isErr ? " err" : "");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = ""; }, isErr ? 4500 : 2200);
}
