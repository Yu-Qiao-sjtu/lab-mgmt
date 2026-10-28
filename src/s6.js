
/* ============================== CSV 导出 ============================== */
function csvCell(v) {
  const s = String(v ?? "");
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function toCSV(headers, rows) {
  return "\ufeff" + [headers.map(csvCell).join(",")].concat(rows.map(r => r.map(csvCell).join(","))).join("\r\n");
}
function exportCSV(kind) {
  const stamp = todayStr().replace(/-/g, "");
  let csv = "", name = "";
  if (kind === "mice") {
    name = `小鼠记录-${stamp}.csv`;
    const rows = sortBy(filterMice(), ui.sort.mice, MICE_SORT).map(r => {
      const a = ageOf(r);
      return [r.strain, r.sex, a.w === null ? "" : nf(a.w), r.dob || "", r.cages, r.perCage, totalMice(r),
        r.purpose, r.project, r.earTag, r.room, r.keeper, r.status || "在养", r.note];
    });
    csv = toCSV(["品系", "性别", "周龄", "出生日期", "笼数", "只数/笼", "总只数", "实验目的", "项目", "耳号/笼号", "房间/架位", "负责人", "状态", "备注"], rows);
  } else if (kind === "breeding") {
    name = `繁育台账-${stamp}.csv`;
    const rows = sortBy(filterBreeding(), ui.sort.breeding, BREED_SORT).map(r => [
      r.code, r.strain, r.father, r.mother, r.paired, r.pregCheck, r.born, r.pups, r.weanedDate, r.weanedCount,
      r.destCages, r.destPerCage, r.purpose, r.project, r.room, r.keeper, r.status || "配对中", r.note
    ]);
    csv = toCSV(["配对编号", "品系", "父本耳号", "母本耳号", "合笼日期", "孕检日期", "出生日期", "窝仔数", "断奶日期", "断奶只数", "分笼笼数", "分笼只数/笼", "实验目的", "项目", "房间/架位", "负责人", "状态", "备注"], rows);
  } else if (kind === "reagents") {
    name = `试剂库存-${stamp}.csv`;
    csv = toCSV(["名称", "货号", "品牌", "规格", "类别", "库存", "单位", "库存下限", "单价", "存放位置", "开封日期", "有效期至", "剩余天数", "供应商", "备注"],
      filterStock("reagents").map(r => [r.name, r.catNo, r.brand, r.spec, r.category, r.qty, r.unit, r.min, r.unitPrice,
        r.location, r.openDate, r.expiry, r.expiry ? dayDiff(r.expiry) : "", r.supplier, r.note]));
  } else if (kind === "consumables") {
    name = `耗材库存-${stamp}.csv`;
    csv = toCSV(["名称", "规格", "库存", "单位", "安全库存", "单价", "存放位置", "供应商", "备注"],
      filterStock("consumables").map(r => [r.name, r.spec, r.qty, r.unit, r.min, r.unitPrice, r.location, r.supplier, r.note]));
  } else if (kind === "logs") {
    name = `出入库流水-${stamp}.csv`;
    csv = toCSV(["日期", "类型", "物品", "动作", "数量", "单位", "单价", "金额", "项目", "操作人", "备注"],
      filterLogs().map(l => [l.date, l.kind === "reagents" ? "试剂" : "耗材", l.itemName, l.action, l.qty, l.unit, l.unitPrice, l.amount, l.project, l.operator, l.note]));
  } else if (kind === "reorder") {
    const stock = ui.view === "consumables" ? "consumables" : "reagents";
    name = `补货清单-${stamp}.csv`;
    csv = toCSV(["名称", "品牌", "货号", "规格", "单位", "当前库存", "日均消耗", "可用天数", "建议补货量", "供应商", "存放位置", "备注"],
      reorderList(stock).map(({ r, u }) => [r.name, r.brand, r.catNo, r.spec, r.unit, num(r.qty),
        u.day ? nf2(u.day) : "", u.daysLeft === null ? "" : Math.max(0, Math.floor(u.daysLeft)),
        u.day ? suggestQty(u) : "", r.supplier, r.location, r.note]));
  } else return;
  download(csv, name, "text/csv;charset=utf-8");
  toast("已导出 " + name);
}

/* ============================== JSON 备份 / 恢复 ============================== */
function backupJSON() {
  const stamp = todayStr().replace(/-/g, "");
  download(JSON.stringify(state, null, 2), `实验室管理备份-${stamp}.json`, "application/json");
  toast("备份已下载");
}
function importJSON(file) {
  if (!file) return;
  const fr = new FileReader();
  fr.onload = () => {
    try {
      const o = JSON.parse(fr.result);
      const looksOk = o && typeof o === "object" && (Array.isArray(o.mice) || Array.isArray(o.reagents) || Array.isArray(o.consumables) || Array.isArray(o.breeding));
      if (!looksOk) throw new Error("不是本工具的备份文件");
      const n = (o.mice || []).length + (o.reagents || []).length + (o.consumables || []).length + (o.breeding || []).length;
      if (!confirm(`即将用备份覆盖当前数据（小鼠 ${(o.mice || []).length} / 繁育 ${(o.breeding || []).length} / 试剂 ${(o.reagents || []).length} / 耗材 ${(o.consumables || []).length}）。\n当前数据会先放进撤销栈，可用 Ctrl+Z 回退。继续？`)) return;
      pushUndo("从 JSON 恢复");
      state = migrate(o);
      save();
      render();
      toast(`恢复成功，共 ${n} 条记录`);
    } catch (e) { toast("导入失败：" + e.message, true); }
    finally { const i = $("#fileImport"); if (i) i.value = ""; }
  };
  fr.readAsText(file, "utf-8");
}

/* ============================== 表格导入（Excel / CSV 粘贴） ============================== */
let importState = { kind: "mice", records: [], dups: 0, skipped: 0, headers: [], error: "" };

const IMPORT_ALIAS = {
  mice: {
    strain: ["品系", "strain", "品系名称"], sex: ["性别", "sex"], ageWeeks: ["周龄", "ageweeks", "周龄（周）"],
    dob: ["出生日期", "dob", "出生", "生日"], cages: ["笼数", "笼子数量", "cages", "笼"],
    perCage: ["只数/笼", "只数每笼", "percage", "per_cage", "每笼只数"], purpose: ["实验目的", "purpose", "目的"],
    project: ["项目", "项目/课题", "project", "课题"], earTag: ["耳号/笼号", "耳号", "笼号", "eartag", "ear_tag"],
    room: ["房间/架位", "房间", "架位", "room"], keeper: ["负责人", "keeper", "饲养人"],
    status: ["状态", "status"], note: ["备注", "note"]
  },
  breeding: {
    code: ["配对编号", "编号", "code"], strain: ["品系", "strain"], father: ["父本耳号", "父本", "father"],
    mother: ["母本耳号", "母本", "mother"], paired: ["合笼日期", "合笼", "paired", "配种日期"],
    pregCheck: ["孕检日期", "孕检", "pregcheck"], born: ["出生日期", "出生", "born"],
    pups: ["窝仔数", "仔数", "pups"], weanedDate: ["断奶日期", "断奶", "weaneddate"],
    weanedCount: ["断奶只数", "weanedcount"], destCages: ["分笼笼数", "destcages"],
    destPerCage: ["分笼只数/笼", "destpercage"], purpose: ["实验目的", "目的", "去 向", "purpose"],
    project: ["项目", "项目/课题", "project"], room: ["房间/架位", "房间", "架位", "room"],
    keeper: ["负责人", "keeper"], status: ["状态", "status"], note: ["备注", "note"]
  },
  reagents: {
    name: ["试剂名称", "名称", "name"], catNo: ["货号", "catno", "cat_no"], brand: ["品牌", "brand"],
    spec: ["规格", "spec"], category: ["类别", "category", "分类"], qty: ["库存数量", "库存", "qty", "数量"],
    unit: ["单位", "unit"], min: ["库存下限", "下限", "min", "安全库存"], unitPrice: ["单价", "unitprice", "unit_price", "单价（元/单位）"],
    location: ["存放位置", "位置", "location"], openDate: ["开封日期", "opendate"], expiry: ["有效期至", "有效期", "expiry", "到期日"],
    supplier: ["供应商", "supplier"], note: ["备注", "note"]
  },
  consumables: {
    name: ["耗材名称", "名称", "name"], spec: ["规格", "spec"], qty: ["库存数量", "库存", "qty"],
    unit: ["单位", "unit"], min: ["安全库存", "下限", "min"], unitPrice: ["单价", "unitprice"],
    location: ["存放位置", "位置", "location"], supplier: ["供应商", "supplier"], note: ["备注", "note"]
  }
};
const DUP_KEY = {
  mice: r => [r.strain, r.purpose, r.earTag, r.cages, r.perCage].join("|"),
  breeding: r => [r.code, r.strain, r.paired].join("|"),
  reagents: r => [r.name, r.catNo, r.spec, r.location].join("|"),
  consumables: r => [r.name, r.spec, r.location].join("|")
};
const normHeader = h => String(h || "").toLowerCase().replace(/[（(].*?[）)]/g, "").replace(/[\s_\-／/]/g, "");
function headerToKey(kind, h) {
  const n = normHeader(h);
  if (!n) return null;
  const map = IMPORT_ALIAS[kind] || {};
  for (const k in map) if (map[k].some(a => normHeader(a) === n)) return k;
  return null;
}
function splitDelimited(line, d) {
  const out = [];
  let cur = "", quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else quoted = false; }
      else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === d) { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out.map(s => s.trim());
}
function parseTable(text) {
  const lines = String(text || "").replace(/\r\n?/g, "\n").split("\n").filter(l => l.trim() !== "");
  if (!lines.length) return [];
  const head = lines[0];
  const tabs = (head.match(/\t/g) || []).length;
  const commas = (head.match(/,/g) || []).length;
  const semis = (head.match(/;/g) || []).length;
  const d = tabs >= commas && tabs >= semis ? "\t" : (semis > commas ? ";" : ",");
  return lines.map(l => splitDelimited(l, d));
}

function buildImport(kind, rows) {
  const out = { kind, records: [], dups: 0, skipped: 0, headers: [], error: "" };
  if (!rows.length) { out.error = "没有内容：先粘贴表格或选择文件"; return out; }
  const map = rows[0].map(h => headerToKey(kind, h));
  out.headers = map;
  if (!map.some(Boolean)) { out.error = "没认出表头：第一行需要是列名（例如 品系 / 笼数 / 只数/笼）"; return out; }
  const req = SCHEMA[kind].filter(f => f.req).map(f => f.k);
  const dupKeys = new Set(state[kind].map(r => DUP_KEY[kind](r)));
  rows.slice(1).forEach(cells => {
    const obj = {};
    map.forEach((k, i) => { if (k && cells[i] !== undefined) obj[k] = cells[i]; });
    const hasValue = Object.values(obj).some(v => String(v ?? "").trim() !== "");
    if (!hasValue) return;
    const rec = normalizeRecord(kind, obj);
    if (req.some(k => rec[k] === "" || rec[k] === null || rec[k] === undefined)) { out.skipped++; return; }
    if (kind === "mice" && totalMice(rec) <= 0) { out.skipped++; return; }
    if (dupKeys.has(DUP_KEY[kind](rec))) out.dups++;
    out.records.push(rec);
  });
  return out;
}

function importPreviewHTML() {
  const st = importState;
  if (st.error) return `<div class="tag bad">${esc(st.error)}</div>`;
  if (!st.records.length) return '<div class="muted">还没有解析结果。粘贴表格后点「解析预览」。</div>';
  const cols = SCHEMA[st.kind].slice(0, 6);
  const rows = st.records.slice(0, 8).map(r => `<tr>${cols.map(f => `<td>${esc(cut(r[f.k] ?? "", 24)) || '<span class="muted">—</span>'}</td>`).join("")}</tr>`).join("");
  return `<div class="tag info">解析到 ${st.records.length} 条${st.skipped ? `<span class="tag warn" style="margin-left:6px">跳过 ${st.skipped} 条（缺必填 / 只数为 0）</span>` : ""}${st.dups ? `<span class="tag warn" style="margin-left:6px">疑似重复 ${st.dups} 条</span>` : ""}</div>
    <div class="tablewrap" style="max-height:240px;margin-top:8px">
      <table><thead><tr>${cols.map(f => `<th>${esc(f.l)}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table>
    </div>
    <div class="muted" style="margin-top:6px">预览前 8 条；确认导入会追加到现有数据（不会覆盖）。</div>`;
}

function previewImport() {
  const text = $("#imp-text") ? $("#imp-text").value : "";
  const kind = $("#imp-kind") ? $("#imp-kind").value : importState.kind;
  importState = buildImport(kind, parseTable(text));
  const box = $("#imp-preview");
  if (box) box.innerHTML = importPreviewHTML();
  if (importState.error) toast(importState.error, true);
  else if (!importState.records.length) toast("没有可导入的行，检查表头和内容", true);
}

function readImportFile(file) {
  if (!file) return;
  const fr = new FileReader();
  fr.onload = () => {
    const ta = $("#imp-text");
    if (ta) ta.value = String(fr.result || "");
    previewImport();
    const i = $("#impFile");
    if (i) i.value = "";
  };
  fr.readAsText(file, "utf-8");
}

function doImport() {
  const st = importState;
  if (!st.records.length) { toast("先点「解析预览」，确认能认出表头", true); return; }
  if (st.dups && !confirm(`有 ${st.dups} 条看起来和现有记录重复，仍然全部导入？`)) return;
  pushUndo(`导入${KIND_LABEL[st.kind]} ${st.records.length} 条`);
  state[st.kind] = st.records.concat(state[st.kind]);
  save();
  const n = st.records.length;
  importState = { kind: st.kind, records: [], dups: 0, skipped: 0, headers: [], error: "" };
  render();
  toast(`已导入 ${n} 条${KIND_LABEL[st.kind]}记录`);
}

/* ============================== 其他操作 ============================== */
function clearAll() {
  if (!confirm("确定清空全部数据？\n小鼠、繁育、试剂、耗材、流水都会删除（可用 Ctrl+Z 撤销）。")) return;
  if (!confirm("再确认一次：真的清空？")) return;
  pushUndo("清空全部数据");
  state = blankState();
  save();
  render();
  toast("已清空，Ctrl+Z 可撤销");
}

function loadDemo(silent) {
  if (!silent && state.mice.length + state.reagents.length + state.consumables.length + state.breeding.length > 0 &&
    !confirm("示例数据会追加到现有数据后面（不会删除已有内容）。继续？")) return;
  if (!silent) pushUndo("载入示例数据");
  const t = todayStr();
  const d8 = addDays(t, -56), d20 = addDays(t, -140);
  const mk = (kind, o) => Object.assign({ id: uid(), createdAt: new Date().toISOString() }, normalizeRecord(kind, o));
  state.mice.push(
    mk("mice", { strain: "C57BL/6J", sex: "雄", cages: 6, perCage: 5, dob: d8, purpose: "MC38 荷瘤模型，观察 21 天肿瘤生长", project: "PD-1 联合治疗", earTag: "1-6 号笼", room: "SPF-2 A3 架", keeper: "", status: "在养", note: "" }),
    mk("mice", { strain: "BALB/c", sex: "雌", cages: 4, perCage: 5, ageWeeks: 8, ageDate: t, purpose: "药物毒性预实验（对照 + 低/中/高剂量）", project: "小分子安全性评价", earTag: "7-10 号笼", room: "SPF-2 A4 架", keeper: "", status: "在养", note: "" }),
    mk("mice", { strain: "NOD-SCID", sex: "雌", cages: 2, perCage: 4, ageWeeks: 6, ageDate: d20, purpose: "人源 PBMC 移植（Hu-Mice）", project: "免疫重建", room: "SPF-3 B1 架", status: "在养", note: "需无菌操作" })
  );
  state.breeding.push(
    mk("breeding", { code: "B26-01", strain: "C57BL/6J", father: "M-11", mother: "F-07", paired: addDays(t, -12), pregCheck: addDays(t, -6), born: "", pups: null, purpose: "繁育保种，断奶后转荷瘤组", project: "PD-1 联合治疗", room: "SPF-2 A1 架", keeper: "", status: "怀孕", note: "" }),
    mk("breeding", { code: "B26-02", strain: "BALB/c", father: "M-03", mother: "F-12", paired: addDays(t, -26), pregCheck: addDays(t, -20), born: addDays(t, -16), pups: 7, weanedDate: "", weanedCount: null, destCages: 2, destPerCage: 4, purpose: "断奶后转毒性预实验", project: "小分子安全性评价", room: "SPF-2 A2 架", status: "哺乳", note: "即将断奶" })
  );
  state.reagents.push(
    mk("reagents", { name: "Anti-mouse PD-1 (RMP1-14)", catNo: "BE0146", brand: "BioXCell", spec: "100 mg", category: "抗体", qty: 2, unit: "支", min: 1, unitPrice: 3200, location: "-20℃ B-1", openDate: "", expiry: addDays(t, 12), supplier: "代理商 A", note: "体内用，勿反复冻融" }),
    mk("reagents", { name: "RPMI-1640 培养基", catNo: "11875093", brand: "Gibco", spec: "500 mL", category: "培养基", qty: 1, unit: "瓶", min: 2, unitPrice: 260, location: "4℃ 冰箱 A-2", expiry: addDays(t, 200), supplier: "本地代理", note: "" }),
    mk("reagents", { name: "Mouse IFN-γ ELISA Kit", catNo: "MIF00", brand: "R&D", spec: "96 T", category: "试剂盒", qty: 1, unit: "盒", min: 1, unitPrice: 1800, location: "4℃ 冰箱 A-1", expiry: addDays(t, -5), supplier: "", note: "已过期，待处理" })
  );
  state.consumables.push(
    mk("consumables", { name: "10 µL 无菌吸头", spec: "96 支/盒", qty: 8, unit: "盒", min: 5, unitPrice: 45, location: "耗材柜 2 层", supplier: "Axygen", note: "" }),
    mk("consumables", { name: "6 孔细胞培养板", spec: "50 个/箱", qty: 1, unit: "箱", min: 2, unitPrice: 380, location: "耗材柜 3 层", supplier: "Corning", note: "" }),
    mk("consumables", { name: "胎牛血清 FBS（50 mL 分装）", spec: "50 mL/支", qty: 2, unit: "支", min: 1, unitPrice: 320, location: "-20℃ C-2", supplier: "Gibco", note: "分装后避免反复冻融" })
  );

  /* 示例流水：让「近 30 天出入库」「日均消耗 / 可用天数」「补货建议」有内容可看 */
  const lg = (kind, item, action, qty, daysAgo, project, operator, note) => {
    const d = addDays(t, -daysAgo);
    const price = numOrNull(item.unitPrice);
    state.logs.push({
      id: uid(), ts: new Date(d + "T09:00:00").getTime(), date: d, kind,
      itemId: item.id, itemName: item.name, unit: item.unit || "", action, qty,
      unitPrice: price, amount: price === null ? null : Math.round(qty * price * 100) / 100,
      project: project || "", operator: operator || "", note: note || ""
    });
  };
  const [re1, re2, re3] = state.reagents, [co1, co2, co3] = state.consumables;
  lg("reagents", re1, "入库", 2, 40, "PD-1 联合治疗", "本人", "首批到货");
  lg("reagents", re1, "出库", 0.5, 18, "PD-1 联合治疗", "本人", "第 1 次给药");
  lg("reagents", re2, "入库", 1, 25, "小分子安全性评价", "本人", "");
  lg("reagents", re2, "出库", 1, 8, "小分子安全性评价", "本人", "换液");
  lg("reagents", re3, "出库", 1, 2, "免疫重建", "本人", "过期前用掉一部分");
  lg("consumables", co1, "出库", 3, 20, "PD-1 联合治疗", "本人", "铺板");
  lg("consumables", co1, "入库", 4, 5, "PD-1 联合治疗", "本人", "补货");
  lg("consumables", co2, "出库", 1, 3, "小分子安全性评价", "本人", "");
  [58, 48, 38, 28, 18, 8].forEach(d => lg("consumables", co3, "出库", 1, d, "免疫重建", "本人", "每周换液分装"));

  if (silent) return;   // 演示模式：调用方统一 render，且不写盘
  save();
  render();
  toast("示例数据已载入，可直接改成自己的");
}

/* ============================== 主题（浅色 / 深色 / 跟随系统） ============================== */
const THEMES = ["auto", "light", "dark"];
const THEME_LABEL = { auto: "跟随系统", light: "浅色", dark: "深色" };
let themeMode = (() => {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (THEMES.indexOf(saved) >= 0) return saved;
  } catch (e) { /* 隐私模式读不到 localStorage 也没关系 */ }
  return THEMES.indexOf(state.settings.theme) >= 0 ? state.settings.theme : "auto";
})();
const prefersDark = () => !!(window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);

function applyTheme() {
  const dark = themeMode === "dark" || (themeMode === "auto" && prefersDark());
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
  const b = $("#btn-theme");
  if (b) {
    b.textContent = themeMode === "auto" ? "🌓" : dark ? "🌙" : "☀️";
    b.title = `主题：${THEME_LABEL[themeMode]}（点击切换）`;
  }
}
function cycleTheme() {
  themeMode = THEMES[(THEMES.indexOf(themeMode) + 1) % THEMES.length];
  try { localStorage.setItem(THEME_KEY, themeMode); } catch (e) { /* ignore */ }
  state.settings.theme = themeMode;   // 跟着 JSON 备份走，换机器也能带上
  save();
  applyTheme();
  toast("主题：" + THEME_LABEL[themeMode]);
}

/* ============================== 路由 / 启动 ============================== */
const TITLES = {
  dash: ["概览", "小鼠总量 · 繁育节点 · 库存预警"],
  mice: ["小鼠统计", "品系 / 周龄 / 笼数 / 只数·笼 / 实验目的"],
  breeding: ["繁育台账", "配对 · 孕检 · 出生 · 断奶 / 转小鼠"],
  reagents: ["试剂库存", "库存 · 位置 · 有效期 · 成本"],
  consumables: ["耗材库存", "库存 · 安全库存 · 成本"],
  logs: ["出入库流水", "变动记录 · 项目成本"],
  data: ["数据 · 设置", "备份 · 导入导出 · 参数"]
};
const VIEWS = {
  dash: viewDash, mice: viewMice, breeding: viewBreeding,
  reagents: () => viewStock("reagents"),
  consumables: () => viewStock("consumables"),
  logs: viewLogs, data: viewData
};

function setView(v) {
  if (!VIEWS[v]) v = "dash";
  ui.view = v;
  $$("#nav button").forEach(b => b.classList.toggle("active", b.dataset.view === v));
  render();
  window.scrollTo(0, 0);
}

function render() {
  const meta = TITLES[ui.view] || TITLES.dash;
  $("#viewTitle").innerHTML = `${esc(meta[0])}<span>${esc(meta[1])}</span>`;
  $("#content").onclick = null;
  (VIEWS[ui.view] || viewDash)();
  paintUndo();
  paintSaveInfo();
}

/* 表头排序（事件委托，切视图也不会失效） */
document.getElementById("content").addEventListener("click", e => {
  const th = e.target.closest("th[data-sort]");
  if (!th) return;
  const key = th.dataset.sort;
  const cur = ui.sort[ui.view];
  ui.sort[ui.view] = cur && cur.k === key ? { k: key, dir: -cur.dir } : { k: key, dir: 1 };
  render();
});

document.getElementById("nav").addEventListener("click", e => {
  const b = e.target.closest("button[data-view]");
  if (!b) return;
  ui.cat = "all";
  ui.logKind = "all";
  ui.logProject = "all";
  setView(b.dataset.view);
});

document.addEventListener("keydown", e => {
  const modalOpen = !$("#modal").classList.contains("hidden");
  const mod = e.ctrlKey || e.metaKey;
  if (e.key === "Escape" && modalOpen) closeModal();
  if (mod && e.key === "Enter" && modalOpen) { const f = $("#mForm"); if (f) f.requestSubmit(); }
  if (mod && !e.shiftKey && String(e.key).toLowerCase() === "z" && !modalOpen) { e.preventDefault(); undo(); }
  if (mod && String(e.key).toLowerCase() === "k") {
    e.preventDefault();
    const s = document.querySelector("#content .search");
    if (s) { s.focus(); s.select(); }
  }
});
$("#modal").addEventListener("click", e => { if (e.target.id === "modal") closeModal(); });
$("#btn-theme").onclick = cycleTheme;
applyTheme();
if (window.matchMedia) {
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  if (mq.addEventListener) mq.addEventListener("change", () => { if (themeMode === "auto") applyTheme(); });
}

/* 演示模式：带 ?demo 打开时载入示例数据，只读不存 */
if (DEMO) {
  const bar = $("#demoBar");
  if (bar) {
    bar.style.display = "";
    bar.innerHTML = "🔎 <b>演示模式</b>：下面是示例数据，所有改动都不会保存到本机。" +
      "把 <code>index.html</code> 下载下来双击打开，就能录入自己的数据（只存在你自己的浏览器里）。" +
      '<a href="?" style="margin-left:6px">退出演示</a>';
  }
  loadDemo(true);
}

render();
paintSaveInfo();
