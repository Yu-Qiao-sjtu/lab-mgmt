
/* ============================== 字段定义 ============================== */
const SCHEMA = {
  mice: [
    { k: "strain", l: "品系", t: "text", req: 1, ph: "如 C57BL/6J、BALB/c、NOD-SCID", list: 1 },
    { k: "sex", l: "性别", t: "select", opts: ["雄", "雌", "混合"] },
    { k: "cages", l: "笼子数量", t: "number", req: 1, step: "1", min: 0, ph: "笼数" },
    { k: "perCage", l: "只数 / 笼", t: "number", req: 1, step: "1", min: 0, ph: "每笼只数" },
    { k: "dob", l: "出生日期", t: "date", hint: "填了就自动算周龄，最准" },
    { k: "ageWeeks", l: "周龄（无出生日期时手填）", t: "number", step: "0.5", min: 0, ph: "如 8", hint: "按「周龄截至」日期换算到今天" },
    { k: "ageDate", l: "周龄截至日期", t: "date" },
    { k: "purpose", l: "实验目的", t: "textarea", req: 1, wide: 1, list: 1, ph: "如 荷瘤观察 28 天 / 药物处理 / 繁育保种 / 对照" },
    { k: "project", l: "项目 / 课题", t: "text", list: 1 },
    { k: "earTag", l: "耳号 / 笼号", t: "text", ph: "如 1-3 号笼" },
    { k: "room", l: "房间 / 架位", t: "text", list: 1, ph: "如 SPF-2 房 A3 架" },
    { k: "keeper", l: "负责人", t: "text", list: 1 },
    { k: "status", l: "状态", t: "select", opts: ["在养", "已结束"], def: "在养" },
    { k: "note", l: "备注", t: "textarea", wide: 1 }
  ],
  breeding: [
    { k: "code", l: "配对编号", t: "text", list: 1, ph: "如 B26-01（自发编号，便于追溯）" },
    { k: "strain", l: "品系", t: "text", req: 1, list: 1, ph: "如 C57BL/6J、BALB/c" },
    { k: "father", l: "父本耳号", t: "text", ph: "雄性编号" },
    { k: "mother", l: "母本耳号", t: "text", ph: "雌性编号" },
    { k: "paired", l: "合笼日期", t: "date", req: 1, hint: "按合笼 + 妊娠天数推算预产期" },
    { k: "pregCheck", l: "孕检日期", t: "date", hint: "见栓 / 孕检阳性当天" },
    { k: "born", l: "出生日期", t: "date", hint: "填了按「出生 + 断奶天数」提醒断奶" },
    { k: "pups", l: "窝仔数", t: "number", step: "1", min: 0 },
    { k: "weanedDate", l: "断奶日期", t: "date" },
    { k: "weanedCount", l: "断奶只数", t: "number", step: "1", min: 0 },
    { k: "destCages", l: "分笼笼数", t: "number", step: "1", min: 0, hint: "断奶后分成几笼" },
    { k: "destPerCage", l: "分笼只数/笼", t: "number", step: "1", min: 0 },
    { k: "purpose", l: "实验目的 / 去向", t: "textarea", wide: 1, list: 1, ph: "如 繁育保种 / 断奶后转 MC38 荷瘤" },
    { k: "project", l: "项目 / 课题", t: "text", list: 1 },
    { k: "room", l: "房间 / 架位", t: "text", list: 1 },
    { k: "keeper", l: "负责人", t: "text", list: 1 },
    { k: "status", l: "select", opts: ["配对中", "怀孕", "哺乳", "已断奶", "已结束"], def: "配对中" },
    { k: "note", l: "备注", t: "textarea", wide: 1 }
  ],
  reagents: [
    { k: "name", l: "试剂名称", t: "text", req: 1, list: 1, ph: "如 Anti-CD3 antibody" },
    { k: "catNo", l: "货号", t: "text" },
    { k: "brand", l: "品牌", t: "text", list: 1, ph: "如 CST / Thermo" },
    { k: "spec", l: "规格", t: "text", ph: "如 100 µL / 500 mL" },
    { k: "category", l: "类别", t: "text", list: 1, ph: "抗体 / 试剂盒 / 化学试剂 / 培养基 / 细胞因子" },
    { k: "qty", l: "库存数量", t: "number", step: "any", min: 0, def: 0 },
    { k: "unit", l: "单位", t: "text", list: 1, ph: "µL / mL / 支 / 瓶 / 盒 / 次" },
    { k: "min", l: "库存下限", t: "number", step: "any", min: 0, def: 0, hint: "低于或等于此值时提醒补货" },
    { k: "unitPrice", l: "单价（元 / 单位）", t: "number", step: "any", min: 0, ph: "如 320", hint: "用于出库成本统计，可留空" },
    { k: "location", l: "存放位置", t: "text", list: 1, ph: "如 4℃冰箱 A-2 / -20℃ B-1" },
    { k: "openDate", l: "开封日期", t: "date" },
    { k: "expiry", l: "有效期至", t: "date" },
    { k: "supplier", l: "供应商", t: "text", list: 1 },
    { k: "note", l: "备注", t: "textarea", wide: 1 }
  ],
  consumables: [
    { k: "name", l: "耗材名称", t: "text", req: 1, list: 1, ph: "如 10 µL 吸头 / 6 孔板 / 离心管" },
    { k: "spec", l: "规格", t: "text", ph: "如 96 支/盒 / 50 mL" },
    { k: "qty", l: "库存数量", t: "number", step: "any", min: 0, def: 0 },
    { k: "unit", l: "单位", t: "text", list: 1, ph: "盒 / 包 / 个 / 箱" },
    { k: "min", l: "安全库存", t: "number", step: "any", min: 0, def: 0, hint: "低于或等于此值时提醒补货" },
    { k: "unitPrice", l: "单价（元 / 单位）", t: "number", step: "any", min: 0, ph: "可留空" , hint: "用于出库成本统计" },
    { k: "location", l: "存放位置", t: "text", list: 1 },
    { k: "supplier", l: "供应商", t: "text", list: 1 },
    { k: "note", l: "备注", t: "textarea", wide: 1 }
  ]
};
const KIND_LABEL = { mice: "小鼠", breeding: "繁育", reagents: "试剂", consumables: "耗材" };

/* ============================== 计算 ============================== */
function ageOf(r) {
  if (r.dob) {
    const d = (Date.now() - new Date(r.dob + "T00:00:00").getTime()) / 86400000;
    return { w: d / 7, from: "dob" };
  }
  if (r.ageWeeks !== null && r.ageWeeks !== undefined && r.ageWeeks !== "") {
    let w = num(r.ageWeeks);
    const ref = r.ageDate || (r.createdAt ? r.createdAt.slice(0, 10) : todayStr());
    const back = dayDiff(ref);
    w += (back === null ? 0 : back) / -7;
    return { w, from: "manual", ref };
  }
  return { w: null, from: "none" };
}
const totalMice = r => num(r.cages) * num(r.perCage);
const isActive = r => (r.status || "在养") !== "已结束";
const expDays = r => (r.expiry ? dayDiff(r.expiry) : null);
const stockValue = r => num(r.qty) * num(r.unitPrice);
const isLow = r => num(r.min) > 0 && num(r.qty) <= num(r.min);

/* ---------- 消耗预测：按最近 N 天的「出库」流水估日均用量与可用天数 ---------- */
const usageWindow = () => Math.max(7, Math.min(730, num(state.settings.usageDays) || 90));
const reorderDays = () => Math.max(1, Math.min(365, num(state.settings.reorderDays) || 30));

function usageOf(kind, r) {
  const win = usageWindow();
  const since = addDays(todayStr(), -(win - 1));
  let sum = 0, n = 0, last = "";
  for (const l of state.logs) {
    if (l.kind !== kind || l.action !== "出库") continue;
    const sameItem = l.itemId ? l.itemId === r.id : String(l.itemName || "") === String(r.name || "");
    if (!sameItem) continue;
    const d = l.date || "";
    if (!d || d < since) continue;
    sum += num(l.qty);
    n++;
    if (d > last) last = d;
  }
  const day = sum / win;                        // 日均消耗量
  const qty = num(r.qty);
  const daysLeft = day > 0 ? qty / day : null;  // 还能用多少天
  return {
    win, sum, n, last, day, qty, daysLeft,
    due: daysLeft === null ? "" : addDays(todayStr(), Math.floor(daysLeft)),
    reorder: reorderDays()
  };
}
/* 建议补到多少：撑过「补货提前期 + 30 天」 */
const suggestQty = u => (u.day > 0 ? Math.ceil(u.day * (u.reorder + 30)) : 0);

const gestDays = () => Math.max(1, num(state.settings.gestDays) || 20);
const weanDays = () => Math.max(1, num(state.settings.weanDays) || 21);
const breedOpen = r => ["已断奶", "已结束"].indexOf(r.status || "配对中") < 0;
function breedStage(r) {
  const s = r.status || "配对中";
  if (s === "已断奶" || s === "已结束") return { key: "closed", label: s, cls: "" };
  if (r.born || s === "哺乳") return { key: "lact", label: "哺乳", cls: "info" };
  if (r.pregCheck || s === "怀孕") return { key: "preg", label: "怀孕", cls: "warn" };
  return { key: "pair", label: "配对中", cls: "ok" };
}
const expectBorn = r => r.born || (r.paired ? addDays(r.paired, gestDays()) : "");
const expectWean = r => r.weanedDate || (r.born ? addDays(r.born, weanDays()) : "");

/* ============================== 过滤 / 排序 ============================== */
const ui = {
  view: "dash",
  q: { mice: "", breeding: "", reagents: "", consumables: "", logs: "" },
  status: "all", strain: "all", cat: "all", logKind: "all", logProject: "all", breedStage: "all",
  sort: { mice: null, breeding: null, reagents: null, consumables: null, logs: { k: "date", dir: -1 } }
};

function filterMice() {
  const q = ui.q.mice.trim().toLowerCase();
  return state.mice.filter(r => {
    if (ui.status === "active" && !isActive(r)) return false;
    if (ui.status === "done" && isActive(r)) return false;
    if (ui.strain !== "all" && (r.strain || "") !== ui.strain) return false;
    if (!q) return true;
    return [r.strain, r.purpose, r.project, r.earTag, r.room, r.keeper, r.note, r.sex].join(" ").toLowerCase().includes(q);
  });
}
function filterStock(kind) {
  const q = ui.q[kind].trim().toLowerCase();
  return state[kind].filter(r => {
    if (kind === "reagents" && ui.cat !== "all" && (r.category || "") !== ui.cat) return false;
    if (!q) return true;
    return [r.name, r.catNo, r.brand, r.spec, r.category, r.location, r.supplier, r.note].join(" ").toLowerCase().includes(q);
  });
}
function filterLogs() {
  const q = ui.q.logs.trim().toLowerCase();
  return state.logs
    .filter(l => ui.logKind === "all" || l.kind === ui.logKind)
    .filter(l => ui.logProject === "all" || (l.project || "") === ui.logProject)
    .filter(l => !q || [l.itemName, l.action, l.operator, l.note, l.project].join(" ").toLowerCase().includes(q))
    .sort((a, b) => (b.date || "").localeCompare(a.date || "") || (b.ts || 0) - (a.ts || 0));
}
function filterBreeding() {
  const q = ui.q.breeding.trim().toLowerCase();
  return state.breeding.filter(r => {
    const open = breedOpen(r);
    if (ui.breedStage === "open" && !open) return false;
    if (ui.breedStage === "closed" && open) return false;
    if (ui.breedStage === "preg" && !(open && !r.born)) return false;
    if (ui.breedStage === "wean" && !(open && r.born && !r.weanedDate)) return false;
    if (!q) return true;
    return [r.code, r.strain, r.father, r.mother, r.purpose, r.project, r.room, r.keeper, r.note].join(" ").toLowerCase().includes(q);
  });
}

function sortBy(list, sort, getters) {
  if (!sort || !sort.k || !getters[sort.k]) return list;
  const get = getters[sort.k], dir = sort.dir || 1;
  return list.slice().sort((a, b) => {
    const x = get(a), y = get(b);
    const ex = x === null || x === undefined || x === "", ey = y === null || y === undefined || y === "";
    if (ex && ey) return 0;
    if (ex) return 1;
    if (ey) return -1;
    if (x === y) return 0;
    return (x > y ? 1 : -1) * dir;
  });
}
function thSort(view, key, label, cls) {
  const s = ui.sort[view];
  const on = s && s.k === key;
  const arrow = on ? (s.dir > 0 ? " ▲" : " ▼") : "";
  return `<th class="sortable${on ? " on" : ""}${cls ? " " + cls : ""}" data-sort="${key}">${label}${arrow}</th>`;
}

/* ============================== 提醒 ============================== */
function alerts() {
  const out = [];
  const warn = num(state.settings.expWarn) || 30;
  state.reagents.forEach(r => {
    const d = expDays(r);
    if (d === null) return;
    if (d < 0) out.push({ cls: "bad", kind: "试剂", txt: `已过期 ${-d} 天`, name: r.name, extra: `${r.expiry} · ${r.location || ""}`, go: "reagents" });
    else if (d <= warn) out.push({ cls: "warn", kind: "试剂", txt: `${d} 天后过期`, name: r.name, extra: `${r.expiry} · ${r.location || ""}`, go: "reagents" });
  });
  ["reagents", "consumables"].forEach(kind => {
    state[kind].forEach(r => {
      if (isLow(r)) {
        out.push({
          cls: "warn", kind: KIND_LABEL[kind], txt: "库存不足", name: r.name,
          extra: `剩 ${nf2(num(r.qty))} ${r.unit || ""} / 下限 ${nf2(num(r.min))}`, go: kind
        });
        return; // 已经缺货就不再重复提示「快用完」
      }
      const u = usageOf(kind, r);
      if (u.daysLeft === null || u.daysLeft > u.reorder) return;
      const d = Math.max(0, Math.floor(u.daysLeft));
      out.push({
        cls: d <= 7 ? "bad" : "warn", kind: KIND_LABEL[kind],
        txt: d === 0 ? "库存已用尽" : `约 ${d} 天后用完`,
        name: r.name,
        extra: `日均 ${nf2(u.day)} ${r.unit || ""} · 剩 ${nf2(num(r.qty))} · 建议补 ${nf2(suggestQty(u))} ${r.unit || ""}`,
        go: kind
      });
    });
  });
  state.breeding.filter(breedOpen).forEach(r => {
    const name = `${r.strain || "繁育"}${r.code ? " · " + r.code : ""}`;
    const extra = `${r.father || "-"} × ${r.mother || "-"} · ${r.room || ""}`;
    if (!r.born) {
      const d = dayDiff(expectBorn(r));
      if (d === null) return;
      if (d < -7) out.push({ cls: "bad", kind: "繁育", txt: `超预产期 ${-d} 天`, name, extra, go: "breeding" });
      else if (d < 0) out.push({ cls: "warn", kind: "繁育", txt: `已到预产期（${-d} 天）`, name, extra, go: "breeding" });
      else if (d <= 3) out.push({ cls: "warn", kind: "繁育", txt: `预计 ${d} 天内生产`, name, extra: expectBorn(r), go: "breeding" });
    } else if (!r.weanedDate) {
      const d = dayDiff(expectWean(r));
      if (d === null) return;
      if (d < 0) out.push({ cls: "bad", kind: "繁育", txt: `该断奶了（超 ${-d} 天）`, name, extra: `出生 ${r.born} · ${r.pups || "?"} 仔`, go: "breeding" });
      else if (d <= 3) out.push({ cls: "warn", kind: "繁育", txt: `${d} 天后断奶`, name, extra: `出生 ${r.born} · ${r.pups || "?"} 仔`, go: "breeding" });
    }
  });
  const rank = { bad: 0, warn: 1 };
  return out.sort((a, b) => (rank[a.cls] ?? 2) - (rank[b.cls] ?? 2));
}

/* 近期繁育节点：预产 / 断奶 */
function breedingTimeline() {
  const ev = [];
  state.breeding.filter(breedOpen).forEach(r => {
    if (!r.born) {
      const d = expectBorn(r);
      if (d) ev.push({ date: d, day: dayDiff(d), txt: "预计生产", r });
    } else if (!r.weanedDate) {
      const d = expectWean(r);
      if (d) ev.push({ date: d, day: dayDiff(d), txt: "预计断奶", r });
    }
  });
  return ev.sort((a, b) => String(a.date).localeCompare(String(b.date))).slice(0, 8);
}

/* ============================== 小图表（纯 div，无外部依赖） ============================== */
function hBarsHTML(items, unitTxt) {
  if (!items.length) return '<div class="muted">暂无数据</div>';
  const max = Math.max(...items.map(i => i.value)) || 1;
  return `<div class="hbars">${items.map(i => `
    <div class="hrow" title="${esc(i.label)}：${nf(i.value)}${esc(unitTxt || "")}">
      <span class="hl">${esc(i.label)}</span>
      <span class="hb"><i style="width:${Math.max(2, (i.value / max) * 100).toFixed(1)}%"></i></span>
      <b class="hv">${nf(i.value)}</b>
    </div>`).join("")}</div>`;
}

/* 近 N 天每天出入库笔数：入库在下（绿）、出库在上（青） */
function stockTrend(days) {
  const start = addDays(todayStr(), -(days - 1));
  const map = {};
  for (let i = 0; i < days; i++) { const d = addDays(start, i); map[d] = { date: d, inQ: 0, outQ: 0 }; }
  state.logs.forEach(l => {
    const o = map[l.date || ""];
    if (!o) return;
    if (l.action === "入库") o.inQ++; else o.outQ++;
  });
  return Object.values(map);
}
function trendHTML(list) {
  const max = Math.max(1, ...list.map(d => d.inQ + d.outQ));
  const bars = list.map(d => {
    const tot = d.inQ + d.outQ;
    const hOf = v => (tot ? (v / tot) * 100 : 0).toFixed(1);
    const hpx = tot ? (tot / max) * 100 : 0;
    return `<div class="bar" style="height:${hpx.toFixed(1)}%" title="${esc(d.date)}：入库 ${d.inQ} 笔 / 出库 ${d.outQ} 笔">
      <i class="i-out" style="height:${hOf(d.outQ)}%"></i><i class="i-in" style="height:${hOf(d.inQ)}%"></i>
    </div>`;
  }).join("");
  const first = list[0] ? list[0].date : "";
  return `<div class="trend">${bars}</div>
    <div class="trend-x"><span>${esc(first)}</span><span>共 ${list.reduce((s, d) => s + d.inQ + d.outQ, 0)} 笔流水</span><span>今天</span></div>`;
}

/* ============================== 视图：概览 ============================== */
function viewDash() {
  const act = state.mice.filter(isActive);
  const cages = act.reduce((s, r) => s + num(r.cages), 0);
  const mice = act.reduce((s, r) => s + totalMice(r), 0);
  const strains = new Set(act.map(r => r.strain).filter(Boolean));
  const al = alerts();
  const bad = al.filter(a => a.cls === "bad").length;
  const openBreed = state.breeding.filter(breedOpen);
  const lowRe = state.reagents.filter(isLow).length;
  const lowCo = state.consumables.filter(isLow).length;
  const runout = kind => state[kind].filter(r => {
    if (isLow(r)) return false;
    const u = usageOf(kind, r);
    return u.daysLeft !== null && u.daysLeft <= u.reorder;
  }).length;
  const runRe = runout("reagents"), runCo = runout("consumables");
  const noData = !state.mice.length && !state.reagents.length && !state.consumables.length && !state.breeding.length;

  const byStrain = {};
  act.forEach(r => {
    const k = r.strain || "(未填品系)";
    const o = byStrain[k] || (byStrain[k] = { cages: 0, mice: 0, n: 0, wk: [], purposes: new Set(), projects: new Set() });
    o.cages += num(r.cages);
    o.mice += totalMice(r);
    o.n++;
    const a = ageOf(r);
    if (a.w !== null) o.wk.push(a.w);
    if (r.purpose) o.purposes.add(r.purpose.trim());
    if (r.project) o.projects.add(r.project.trim());
  });
  const strainRows = Object.entries(byStrain).sort((a, b) => b[1].mice - a[1].mice).map(([k, o]) => {
    const w0 = o.wk.length ? Math.min(...o.wk) : null;
    const w1 = o.wk.length ? Math.max(...o.wk) : null;
    return `<tr><td><b>${esc(k)}</b></td><td class="num">${o.n}</td><td class="num">${nf(o.cages)}</td>
      <td class="num">${nf(o.mice)}</td>
      <td class="nowrap">${w0 === null ? '<span class="muted">—</span>' : nf(w0) + " ~ " + nf(w1) + " 周"}</td>
      <td class="wrap-cell">${esc([...o.purposes].join("；")) || '<span class="muted">—</span>'}</td>
      <td class="wrap-cell">${esc([...o.projects].join("；")) || '<span class="muted">—</span>'}</td></tr>`;
  }).join("");

  const tl = breedingTimeline();
  const topStrains = Object.entries(byStrain)
    .sort((a, b) => b[1].mice - a[1].mice)
    .slice(0, 8)
    .map(([k, o]) => ({ label: k, value: o.mice }));
  const tlRows = tl.map(e => {
    const d = e.day;
    const tag = d === null ? "" : d < 0 ? `<span class="tag bad">已过 ${-d} 天</span>` : d === 0 ? '<span class="tag warn">今天</span>' : `<span class="tag ${d <= 3 ? "warn" : "info"}">${d} 天后</span>`;
    return `<tr><td class="nowrap">${esc(e.date)}</td><td>${tag}</td><td><b>${esc(e.r.strain || "")}</b> ${esc(e.r.code || "")}</td>
      <td>${esc(e.txt)}</td><td class="nowrap">${esc([e.r.father, e.r.mother].filter(Boolean).join(" × ")) || '<span class="muted">—</span>'}</td>
      <td>${esc(e.r.room || "")}</td></tr>`;
  }).join("");

  $("#content").innerHTML = `
    ${noData ? `<div class="panel welcome">
      <div class="body">
        <h2>👋 第一次用？从这里开始</h2>
        <p class="muted">数据只存在这台电脑的浏览器里，不联网、不上传。改动会自动保存，每天自动留一份快照。</p>
        <div class="toolbar" style="margin-bottom:0">
          <button class="btn primary" data-go="new-mice">+ 新增第一条小鼠记录</button>
          <button class="btn" data-go="demo">载入示例数据（可随时删）</button>
          <button class="btn" data-go="import">从 Excel / CSV 导入</button>
        </div>
      </div>
    </div>` : ""}

    <div class="cards">
      <div class="stat card"><div class="k">在养小鼠总数</div><div class="v">${nf(mice)}</div><div class="s">共 ${nf(cages)} 笼 · ${strains.size} 个品系</div></div>
      <div class="stat card"><div class="k">繁育进行中</div><div class="v">${openBreed.length}</div><div class="s">待断奶 ${state.breeding.filter(r => breedOpen(r) && r.born && !r.weanedDate).length} 窝</div></div>
      <div class="stat card"><div class="k">试剂品种</div><div class="v">${state.reagents.length}</div><div class="s">${[lowRe ? lowRe + " 项库存不足" : "", runRe ? runRe + " 项即将用完" : ""].filter(Boolean).join(" · ") || "库存正常"}</div></div>
      <div class="stat card"><div class="k">耗材品种</div><div class="v">${state.consumables.length}</div><div class="s">${[lowCo ? lowCo + " 项库存不足" : "", runCo ? runCo + " 项即将用完" : ""].filter(Boolean).join(" · ") || "库存正常"}</div></div>
      <div class="stat card ${al.length ? (bad ? "bad" : "warn") : "ok"}"><div class="k">待处理提醒</div><div class="v">${al.length}</div><div class="s">${bad ? bad + " 项需马上处理" : "临期 / 缺货 / 繁育节点"}</div></div>
    </div>

    <div class="grid2">
      <div class="panel">
        <h3>品系只数分布 <em>仅「在养」记录，前 8 个品系</em></h3>
        <div class="body">${hBarsHTML(topStrains, " 只")}</div>
      </div>
      <div class="panel">
        <h3>近 30 天出入库 <em><span class="lg lg-out"></span>出库 <span class="lg lg-in"></span>入库 · 柱高 = 当天流水笔数</em></h3>
        <div class="body">${trendHTML(stockTrend(30))}</div>
      </div>
    </div>

    <div class="panel">
      <h3>品系汇总 <em>仅统计「在养」记录；只数 = 笼数 × 只数/笼</em></h3>
      <div class="tablewrap">
        <table>
          <thead><tr><th>品系</th><th class="num">记录数</th><th class="num">笼数</th><th class="num">只数</th><th>周龄范围</th><th>实验目的</th><th>项目</th></tr></thead>
          <tbody>${strainRows || '<tr><td colspan="7" class="empty">还没有在养的小鼠记录，去「小鼠统计」新增一条吧</td></tr>'}</tbody>
          <tfoot><tr><td>合计</td><td class="num">${act.length}</td><td class="num">${nf(cages)}</td><td class="num">${nf(mice)}</td><td colspan="3"></td></tr></tfoot>
        </table>
      </div>
    </div>

    <div class="panel">
      <h3>繁育近期节点 <em>预产 = 合笼 + ${gestDays()} 天；断奶 = 出生 + ${weanDays()} 天（可在「数据 · 设置」改）</em></h3>
      <div class="tablewrap">
        <table>
          <thead><tr><th>日期</th><th>倒计时</th><th>品系 / 编号</th><th>节点</th><th>父母本</th><th>位置</th></tr></thead>
          <tbody>${tlRows || '<tr><td colspan="6" class="empty">暂无进行中的繁育记录</td></tr>'}</tbody>
        </table>
      </div>
    </div>

    <div class="panel">
      <h3>提醒 <em>有效期阈值 ${num(state.settings.expWarn) || 30} 天，可在「数据 · 设置」里调整</em></h3>
      <div class="body">
        ${al.length ? `<div class="items">${al.map(a => `<div class="row"><span class="tag ${a.cls}">${esc(a.txt)}</span><b>${esc(a.name)}</b><span class="r">${esc(a.kind)} · ${esc(a.extra)}</span></div>`).join("")}</div>`
      : '<div class="muted">🎉 没有过期、缺货或繁育节点提醒。</div>'}
      </div>
    </div>

    <div class="panel">
      <h3>最近出入库 <em>最新 8 条</em></h3>
      <div class="tablewrap">
        <table>
          <thead><tr><th>日期</th><th>类型</th><th>物品</th><th>动作</th><th class="num">数量</th><th class="num">金额</th><th>项目</th><th>操作人</th><th>备注</th></tr></thead>
          <tbody>${state.logs.slice().sort((a, b) => (b.ts || 0) - (a.ts || 0)).slice(0, 8).map(l => `
            <tr><td class="nowrap">${esc(l.date || "")}</td><td>${l.kind === "reagents" ? "试剂" : "耗材"}</td><td>${esc(l.itemName)}</td>
            <td><span class="tag ${l.action === "入库" ? "ok" : "info"}">${esc(l.action)}</span></td>
            <td class="num">${nf2(num(l.qty))} ${esc(l.unit || "")}</td>
            <td class="num">${l.amount === null || l.amount === undefined ? '<span class="muted">—</span>' : "¥" + money(l.amount)}</td>
            <td>${esc(l.project || "") || '<span class="muted">—</span>'}</td>
            <td>${esc(l.operator || "")}</td><td class="wrap-cell">${esc(cut(l.note, 40))}</td></tr>`).join("")
        || '<tr><td colspan="9" class="empty">暂无流水</td></tr>'}</tbody>
        </table>
      </div>
    </div>`;

  $("#content").onclick = e => {
    const b = e.target.closest("button[data-go]");
    if (!b) return;
    const go = b.dataset.go;
    if (go === "new-mice") openForm("mice");
    if (go === "demo") loadDemo();
    if (go === "import") { setView("data"); setTimeout(() => { const el = $("#imp-text"); if (el) el.focus(); }, 50); }
  };
}
