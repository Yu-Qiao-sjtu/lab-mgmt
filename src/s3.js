
/* ============================== 视图：小鼠 ============================== */
const MICE_SORT = {
  strain: r => r.strain || "",
  age: r => ageOf(r).w,
  cages: r => num(r.cages),
  perCage: r => num(r.perCage),
  total: r => totalMice(r),
  purpose: r => r.purpose || "",
  status: r => (isActive(r) ? 0 : 1),
  project: r => r.project || ""
};

function viewMice() {
  const strains = [...new Set(state.mice.map(r => r.strain).filter(Boolean))].sort();
  const layout = state.settings.cardLayout || "6";
  $("#content").innerHTML = `
    <div class="toolbar">
      <input id="q-mice" class="search" placeholder="搜索 品系 / 实验目的 / 项目 / 耳号 / 房间 / 负责人（Ctrl+K）" value="${esc(ui.q.mice)}">
      <select id="f-status">
        <option value="all"${ui.status === "all" ? " selected" : ""}>全部状态</option>
        <option value="active"${ui.status === "active" ? " selected" : ""}>仅在养</option>
        <option value="done"${ui.status === "done" ? " selected" : ""}>仅已结束</option>
      </select>
      <select id="f-strain"><option value="all">全部品系</option>${strains.map(s => `<option value="${esc(s)}"${ui.strain === s ? " selected" : ""}>${esc(s)}</option>`).join("")}</select>
      <button class="btn primary" data-act="new">+ 新增记录</button>
      <select id="f-layout" title="笼牌版式（A4）">
        <option value="4"${layout === "4" ? " selected" : ""}>笼牌 2×2（大）</option>
        <option value="6"${layout === "6" ? " selected" : ""}>笼牌 2×3（中）</option>
        <option value="9"${layout === "9" ? " selected" : ""}>笼牌 3×3（小）</option>
      </select>
      <button class="btn" data-act="print">🖨 打印笼牌</button>
      <button class="btn" data-act="csv">导出 CSV</button>
    </div>
    <div class="cards" id="miceStats"></div>
    <div class="panel">
      <h3>小鼠记录 <em>周龄填出生日期后自动更新；只数 = 笼数 × 只数/笼；点表头排序</em></h3>
      <div class="tablewrap" id="miceRows"></div>
    </div>`;
  $("#q-mice").oninput = e => { ui.q.mice = e.target.value; rowsMice(); statsMice(); };
  $("#f-status").onchange = e => { ui.status = e.target.value; rowsMice(); statsMice(); };
  $("#f-strain").onchange = e => { ui.strain = e.target.value; rowsMice(); statsMice(); };
  $("#f-layout").onchange = e => { state.settings.cardLayout = e.target.value; save(); toast("笼牌版式已保存"); };
  $("#content .toolbar").onclick = e => {
    const b = e.target.closest("button[data-act]");
    if (!b) return;
    if (b.dataset.act === "new") openForm("mice");
    if (b.dataset.act === "print") printCages();
    if (b.dataset.act === "csv") exportCSV("mice");
  };
  $("#miceRows").onclick = e => {
    const b = e.target.closest("button[data-act]");
    if (!b) return;
    const id = b.dataset.id;
    const act = b.dataset.act;
    if (act === "edit") openForm("mice", id);
    if (act === "copy") copyRecord("mice", id);
    if (act === "del") delRecord("mice", id);
    if (act === "toggle") {
      const r = state.mice.find(x => x.id === id);
      if (!r) return;
      pushUndo(isActive(r) ? "结束记录" : "恢复记录");
      r.status = isActive(r) ? "已结束" : "在养";
      r.updatedAt = new Date().toISOString();
      save();
      rowsMice();
      statsMice();
      toast("已标记为「" + r.status + "」");
    }
  };
  rowsMice();
  statsMice();
}

function statsMice() {
  const list = filterMice(), act = list.filter(isActive);
  const cages = act.reduce((s, r) => s + num(r.cages), 0);
  const mice = act.reduce((s, r) => s + totalMice(r), 0);
  const perCage = cages ? mice / cages : 0;
  const strains = new Set(act.map(r => r.strain).filter(Boolean));
  $("#miceStats").innerHTML = `
    <div class="stat card"><div class="k">在养总只数</div><div class="v">${nf(mice)}</div><div class="s">筛选结果内</div></div>
    <div class="stat card"><div class="k">笼数合计</div><div class="v">${nf(cages)}</div><div class="s">平均 ${perCage ? nf(perCage) : "—"} 只/笼</div></div>
    <div class="stat card"><div class="k">品系数</div><div class="v">${strains.size}</div><div class="s">${esc(cut([...strains].join("、"), 34)) || "—"}</div></div>
    <div class="stat card"><div class="k">记录条数</div><div class="v">${list.length}</div><div class="s">在养 ${act.length} / 已结束 ${list.length - act.length}</div></div>`;
}

function rowsMice() {
  const list = sortBy(filterMice(), ui.sort.mice, MICE_SORT);
  if (!list.length) {
    $("#miceRows").innerHTML = '<div class="empty">没有符合条件的记录。点「+ 新增记录」开始。</div>';
    return;
  }
  const rows = list.map(r => {
    const a = ageOf(r);
    const ageTxt = a.w === null ? '<span class="tag warn">未填</span>'
      : `${nf(a.w)} 周<div class="muted" style="font-size:11px">${a.from === "dob" ? "按出生日期" : "按记录日推算"}</div>`;
    const st = isActive(r) ? '<span class="tag ok">在养</span>' : '<span class="tag">已结束</span>';
    return `<tr>
      <td><b>${esc(r.strain || "")}</b><div class="muted" style="font-size:11.5px">${esc([r.sex, r.earTag].filter(Boolean).join(" · "))}</div></td>
      <td class="nowrap">${ageTxt}</td>
      <td class="num">${nf(num(r.cages))}</td>
      <td class="num">${nf(num(r.perCage))}</td>
      <td class="num"><b>${nf(totalMice(r))}</b></td>
      <td class="wrap-cell">${esc(r.purpose || "")}</td>
      <td class="wrap-cell">${esc([r.project, r.room].filter(Boolean).join(" · ")) || '<span class="muted">—</span>'}</td>
      <td>${st}</td>
      <td class="nowrap">
        <button class="btn mini" data-act="edit" data-id="${r.id}">编辑</button>
        <button class="btn mini" data-act="copy" data-id="${r.id}" title="复制一条一样的，方便批量录入">复制</button>
        <button class="btn mini" data-act="toggle" data-id="${r.id}">${isActive(r) ? "结束" : "恢复"}</button>
        <button class="btn mini danger" data-act="del" data-id="${r.id}">删</button>
      </td></tr>`;
  }).join("");
  const act = list.filter(isActive);
  const tc = act.reduce((s, r) => s + num(r.cages), 0);
  const tm = act.reduce((s, r) => s + totalMice(r), 0);
  $("#miceRows").innerHTML = `<table>
    <thead><tr>${thSort("mice", "strain", "品系 / 性别")}${thSort("mice", "age", "周龄")}${thSort("mice", "cages", "笼数", "num")}${thSort("mice", "perCage", "只数/笼", "num")}${thSort("mice", "total", "总只数", "num")}${thSort("mice", "purpose", "实验目的")}${thSort("mice", "project", "项目 · 位置")}${thSort("mice", "status", "状态")}<th>操作</th></tr></thead>
    <tbody>${rows}</tbody>
    <tfoot><tr><td colspan="2">显示 ${list.length} 条（在养 ${act.length} 条）</td><td class="num">${nf(tc)}</td><td class="num"></td><td class="num">${nf(tm)}</td><td colspan="4"></td></tr></tfoot>
  </table>`;
  paintUndo();
}

/* ============================== 视图：繁育 ============================== */
const BREED_SORT = {
  strain: r => r.strain || "",
  paired: r => r.paired || "",
  born: r => r.born || expectBorn(r),
  wean: r => r.weanedDate || expectWean(r),
  pups: r => num(r.pups),
  status: r => (breedOpen(r) ? 0 : 1)
};

function viewBreeding() {
  $("#content").innerHTML = `
    <div class="toolbar">
      <input id="q-breed" class="search" placeholder="搜索 品系 / 配对编号 / 父母本 / 项目 / 负责人" value="${esc(ui.q.breeding)}">
      <select id="f-stage">
        <option value="all"${ui.breedStage === "all" ? " selected" : ""}>全部</option>
        <option value="open"${ui.breedStage === "open" ? " selected" : ""}>进行中</option>
        <option value="preg"${ui.breedStage === "preg" ? " selected" : ""}>待生产</option>
        <option value="wean"${ui.breedStage === "wean" ? " selected" : ""}>待断奶</option>
        <option value="closed"${ui.breedStage === "closed" ? " selected" : ""}>已断奶 / 已结束</option>
      </select>
      <button class="btn primary" data-act="new">+ 新增配对</button>
      <button class="btn" data-act="csv">导出 CSV</button>
    </div>
    <div class="cards" id="breedStats"></div>
    <div class="panel">
      <h3>繁育台账 <em>预产 = 合笼 + ${gestDays()} 天；断奶 = 出生 + ${weanDays()} 天；断奶后可一键转成小鼠记录</em></h3>
      <div class="tablewrap" id="breedRows"></div>
    </div>`;
  $("#q-breed").oninput = e => { ui.q.breeding = e.target.value; rowsBreeding(); statsBreeding(); };
  $("#f-stage").onchange = e => { ui.breedStage = e.target.value; rowsBreeding(); statsBreeding(); };
  $("#content .toolbar").onclick = e => {
    const b = e.target.closest("button[data-act]");
    if (!b) return;
    if (b.dataset.act === "new") openForm("breeding");
    if (b.dataset.act === "csv") exportCSV("breeding");
  };
  $("#breedRows").onclick = e => {
    const b = e.target.closest("button[data-act]");
    if (!b) return;
    const id = b.dataset.id, act = b.dataset.act;
    const r = state.breeding.find(x => x.id === id);
    if (act === "edit") openForm("breeding", id);
    if (act === "del") delRecord("breeding", id);
    if (act === "convert") openConvert(id);
    if (act === "weannow" && r) {
      pushUndo("标记断奶");
      r.weanedDate = todayStr();
      if (r.weanedCount === null || r.weanedCount === undefined) r.weanedCount = r.pups;
      r.status = "已断奶";
      r.updatedAt = new Date().toISOString();
      save();
      rowsBreeding();
      statsBreeding();
      toast("已标记断奶，可点「转小鼠」生成小鼠记录");
    }
  };
  rowsBreeding();
  statsBreeding();
}

function statsBreeding() {
  const list = filterBreeding();
  const open = list.filter(breedOpen);
  const waitBorn = open.filter(r => !r.born && r.paired).length;
  const waitWean = open.filter(r => r.born && !r.weanedDate).length;
  const closed = list.length - open.length;
  const pups = open.filter(r => r.born).reduce((s, r) => s + num(r.pups), 0);
  $("#breedStats").innerHTML = `
    <div class="stat card"><div class="k">进行中配对</div><div class="v">${open.length}</div><div class="s">含怀孕 / 哺乳</div></div>
    <div class="stat card ${waitBorn ? "warn" : ""}"><div class="k">待生产</div><div class="v">${waitBorn}</div><div class="s">已合笼未记录出生</div></div>
    <div class="stat card ${waitWean ? "warn" : "ok"}"><div class="k">待断奶</div><div class="v">${waitWean}</div><div class="s">当前窝仔合计 ${pups} 只</div></div>
    <div class="stat card"><div class="k">已断奶 / 已结束</div><div class="v">${closed}</div><div class="s">记录留存可追溯</div></div>`;
}

function rowsBreeding() {
  const list = sortBy(filterBreeding(), ui.sort.breeding, BREED_SORT);
  if (!list.length) {
    $("#breedRows").innerHTML = '<div class="empty">还没有繁育记录。点「+ 新增配对」记下一窝。</div>';
    return;
  }
  const rows = list.map(r => {
    const st = breedStage(r);
    const eb = expectBorn(r), ew = expectWean(r);
    const bornCell = r.born
      ? `<span class="nowrap">${esc(r.born)}</span>${r.pups ? `<div class="muted" style="font-size:11px">${nf(num(r.pups))} 仔</div>` : ""}`
      : (eb ? `<span class="muted">预产 ${esc(eb)}</span>` : '<span class="muted">—</span>');
    const weanCell = r.weanedDate
      ? `<span class="nowrap">${esc(r.weanedDate)}</span><div class="muted" style="font-size:11px">${r.weanedCount ? "断奶 " + nf(num(r.weanedCount)) + " 只" : ""}</div>`
      : (ew ? `<span class="tag ${dayDiff(ew) < 0 ? "bad" : "info"}">${esc(ew)}</span>` : '<span class="muted">—</span>');
    return `<tr>
      <td><b>${esc(r.strain || "")}</b><div class="muted" style="font-size:11.5px">${esc([r.code, r.room].filter(Boolean).join(" · "))}</div></td>
      <td class="nowrap">${esc([r.father, r.mother].filter(Boolean).join(" × ")) || '<span class="muted">—</span>'}</td>
      <td class="nowrap">${esc(r.paired || "")}</td>
      <td class="nowrap">${esc(r.pregCheck || "") || '<span class="muted">—</span>'}</td>
      <td>${bornCell}</td>
      <td>${weanCell}</td>
      <td><span class="tag ${st.cls}">${esc(st.label)}</span></td>
      <td class="wrap-cell">${esc([r.purpose, r.project].filter(Boolean).join(" · ")) || '<span class="muted">—</span>'}</td>
      <td class="nowrap">
        <button class="btn mini" data-act="edit" data-id="${r.id}">编辑</button>
        ${breedOpen(r) && r.born && !r.weanedDate ? `<button class="btn mini" data-act="weannow" data-id="${r.id}">断奶</button>` : ""}
        <button class="btn mini primary" data-act="convert" data-id="${r.id}" title="按断奶只数生成一条小鼠记录">转小鼠</button>
        <button class="btn mini danger" data-act="del" data-id="${r.id}">删</button>
      </td></tr>`;
  }).join("");
  $("#breedRows").innerHTML = `<table>
    <thead><tr>${thSort("breeding", "strain", "品系 / 编号")}<th>父母本</th>${thSort("breeding", "paired", "合笼")}<th>孕检</th>${thSort("breeding", "born", "出生 / 仔数")}${thSort("breeding", "wean", "断奶")}${thSort("breeding", "status", "状态")}<th>目的 / 项目</th><th>操作</th></tr></thead>
    <tbody>${rows}</tbody>
    <tfoot><tr><td colspan="9">显示 ${list.length} 条（进行中 ${list.filter(breedOpen).length} 条）</td></tr></tfoot>
  </table>`;
  paintUndo();
}

/* ============================== 视图：试剂 / 耗材 ============================== */
const STOCK_SORT = {
  name: r => r.name || "",
  category: r => r.category || "",
  qty: r => num(r.qty),
  min: r => num(r.min),
  value: r => stockValue(r),
  price: r => num(r.unitPrice),
  expiry: r => (r.expiry || "9999-12-31"),
  location: r => r.location || "",
  supplier: r => r.supplier || "",
  runout: r => { const u = usageOf(ui.view === "consumables" ? "consumables" : "reagents", r); return u.daysLeft === null ? 999999 : u.daysLeft; }
};

function viewStock(kind) {
  const isRe = kind === "reagents";
  const cats = isRe ? [...new Set(state.reagents.map(r => r.category).filter(Boolean))].sort() : [];
  $("#content").innerHTML = `
    <div class="toolbar">
      <input id="q-stock" class="search" placeholder="搜索 名称 / 货号 / 品牌 / 位置 / 供应商" value="${esc(ui.q[kind])}">
      ${isRe ? `<select id="f-cat"><option value="all">全部类别</option>${cats.map(c => `<option value="${esc(c)}"${ui.cat === c ? " selected" : ""}>${esc(c)}</option>`).join("")}</select>` : ""}
      <button class="btn primary" data-act="new">+ 新增${isRe ? "试剂" : "耗材"}</button>
      <button class="btn" data-act="csv">导出 CSV</button>
    </div>
    <div class="cards" id="stockStats"></div>
    <div class="panel">
      <h3>${isRe ? "试剂库存" : "耗材库存"} <em>点「出入库」记流水（自动算金额）；「可用天数」按近 ${usageWindow()} 天出库量推算</em></h3>
      <div class="tablewrap" id="stockRows"></div>
    </div>
    <div class="panel">
      <h3>补货建议 <em>可用天数 ≤ ${reorderDays()} 天或已低于下限的品种；建议量按「撑过 ${reorderDays() + 30} 天」估算</em></h3>
      <div class="body" id="stockReorder"></div>
    </div>`;
  $("#q-stock").oninput = e => { ui.q[kind] = e.target.value; rowsStock(kind); statsStock(kind); };
  if (isRe) $("#f-cat").onchange = e => { ui.cat = e.target.value; rowsStock(kind); };
  $("#content .toolbar").onclick = e => {
    const b = e.target.closest("button[data-act]");
    if (!b) return;
    if (b.dataset.act === "new") openForm(kind);
    if (b.dataset.act === "csv") exportCSV(kind);
  };
  $("#stockRows").onclick = e => {
    const b = e.target.closest("button[data-act]");
    if (!b) return;
    const id = b.dataset.id;
    const act = b.dataset.act;
    if (act === "edit") openForm(kind, id);
    if (act === "del") delRecord(kind, id);
    if (act === "copy") copyRecord(kind, id);
    if (act === "stock") openStock(kind, id);
  };
  $("#stockReorder").onclick = e => {
    const b = e.target.closest("button[data-act]");
    if (b && b.dataset.act === "reorder-csv") exportCSV("reorder");
  };
  rowsStock(kind);
  statsStock(kind);
}

function statsStock(kind) {
  const list = filterStock(kind);
  const cats = new Set(list.map(r => r.category).filter(Boolean));
  const low = list.filter(isLow).length;
  const run = list.filter(r => {
    if (isLow(r)) return false;
    const u = usageOf(kind, r);
    return u.daysLeft !== null && u.daysLeft <= u.reorder;
  }).length;
  const exp = kind === "reagents" ? list.filter(r => r.expiry && expDays(r) !== null && expDays(r) <= (num(state.settings.expWarn) || 30)).length : 0;
  const val = list.reduce((s, r) => s + stockValue(r), 0);
  $("#stockStats").innerHTML = `
    <div class="stat card"><div class="k">品种数</div><div class="v">${list.length}</div><div class="s">${kind === "reagents" ? cats.size + " 个类别" : "耗材"}</div></div>
    <div class="stat card ${low ? "warn" : "ok"}"><div class="k">库存不足</div><div class="v">${low}</div><div class="s">低于或等于下限</div></div>
    <div class="stat card ${run ? "warn" : "ok"}"><div class="k">即将用完</div><div class="v">${run}</div><div class="s">可用 ≤ ${reorderDays()} 天</div></div>
    ${kind === "reagents"
      ? `<div class="stat card ${exp ? "warn" : "ok"}"><div class="k">临期 / 过期</div><div class="v">${exp}</div><div class="s">阈值 ${num(state.settings.expWarn) || 30} 天</div></div>`
      : `<div class="stat card"><div class="k">单位种类</div><div class="v">${new Set(list.map(r => r.unit).filter(Boolean)).size}</div><div class="s">按单位分别统计</div></div>`}
    <div class="stat card"><div class="k">库存金额</div><div class="v">${val ? "¥" + money(val) : "—"}</div><div class="s">库存 × 单价，未填单价不计</div></div>`;
}

function rowsStock(kind) {
  const isRe = kind === "reagents";
  const list = sortBy(filterStock(kind), ui.sort[kind], STOCK_SORT);
  if (!list.length) { $("#stockRows").innerHTML = `<div class="empty">还没有${isRe ? "试剂" : "耗材"}记录。</div>`; return; }
  const warn = num(state.settings.expWarn) || 30;
  const rows = list.map(r => {
    const q = num(r.qty), m = num(r.min);
    const lowCls = m > 0 && q <= m ? "bad" : "";
    const price = numOrNull(r.unitPrice);
    const u = usageOf(kind, r);
    const uCell = u.day > 0
      ? `<td class="num" title="近 ${u.win} 天出库 ${nf2(u.sum)} ${esc(r.unit || "")}（${u.n} 笔）· 预计 ${esc(u.due)} 用完 · 建议补 ${nf2(suggestQty(u))} ${esc(r.unit || "")}">
          <span class="muted" style="font-size:11.5px">${nf2(u.day)}${esc(r.unit ? " " + r.unit : "")}/天</span>
          <div><span class="tag ${u.daysLeft <= 7 ? "bad" : u.daysLeft <= u.reorder ? "warn" : "info"}">${Math.max(0, Math.floor(u.daysLeft))} 天</span></div>
        </td>`
      : `<td class="num"><span class="muted">—</span>${u.sum > 0 ? `<div class="muted" style="font-size:11px">窗口内无出库</div>` : ""}</td>`;
    let expCell = "";
    if (isRe) {
      const d = expDays(r);
      expCell = d === null ? '<span class="muted">—</span>'
        : d < 0 ? `<span class="tag bad">过期 ${-d} 天</span>`
        : d <= warn ? `<span class="tag warn">${d} 天后</span>`
        : `<span class="nowrap">${esc(r.expiry)}</span>`;
    }
    return `<tr>
      <td><b>${esc(r.name)}</b><div class="muted" style="font-size:11.5px">${esc([r.brand, r.catNo, r.spec].filter(Boolean).join(" · "))}</div></td>
      ${isRe ? `<td>${esc(r.category || "") || '<span class="muted">—</span>'}</td>` : ""}
      <td class="num"><span class="tag ${lowCls || "info"}">${nf2(q)} ${esc(r.unit || "")}</span>${m ? `<div class="muted" style="font-size:11px">下限 ${nf2(m)}</div>` : ""}</td>
      ${uCell}
      <td class="num">${price === null ? '<span class="muted">—</span>' : "¥" + nf2(price)}</td>
      <td class="num">${price === null ? '<span class="muted">—</span>' : "¥" + money(q * price)}</td>
      <td>${esc(r.location || "") || '<span class="muted">—</span>'}</td>
      ${isRe ? `<td class="nowrap">${expCell}</td>` : ""}
      <td>${esc(r.supplier || "") || '<span class="muted">—</span>'}</td>
      <td class="nowrap">
        <button class="btn mini" data-act="stock" data-id="${r.id}">出入库</button>
        <button class="btn mini" data-act="edit" data-id="${r.id}">编辑</button>
        <button class="btn mini" data-act="copy" data-id="${r.id}">复制</button>
        <button class="btn mini danger" data-act="del" data-id="${r.id}">删</button>
      </td></tr>`;
  }).join("");
  const cols = isRe ? 8 : 6;
  $("#stockRows").innerHTML = `<table>
    <thead><tr>${thSort(kind, "name", "名称 / 规格")}${isRe ? thSort(kind, "category", "类别") : ""}${thSort(kind, "qty", "库存", "num")}${thSort(kind, "runout", "日均 / 可用", "num")}${thSort(kind, "price", "单价", "num")}${thSort(kind, "value", "金额", "num")}<th>存放位置</th>${isRe ? thSort(kind, "expiry", "有效期") : ""}<th>供应商</th><th>操作</th></tr></thead>
    <tbody>${rows}</tbody>
    <tfoot><tr><td colspan="${cols}">显示 ${list.length} 条 · 合计金额 ¥${money(list.reduce((s, r) => s + stockValue(r), 0))}</td><td></td></tr></tfoot>
  </table>`;

  const need = reorderList(kind);
  const box = $("#stockReorder");
  if (box) {
    box.innerHTML = need.length
      ? `<div class="items">${need.map(({ r, u }) => `<div class="row">
          <span class="tag ${u.daysLeft === null ? "warn" : u.daysLeft <= 7 ? "bad" : "warn"}">${u.daysLeft === null ? "已低于下限" : Math.max(0, Math.floor(u.daysLeft)) + " 天"}</span>
          <b>${esc(r.name)}</b>
          <span class="r">剩 ${nf2(num(r.qty))} ${esc(r.unit || "")}${u.day > 0 ? ` · 日均 ${nf2(u.day)} · 建议补 ${nf2(suggestQty(u))} ${esc(r.unit || "")}` : ""} · ${esc(r.supplier || "未填供应商")}</span>
        </div>`).join("")}</div>
        <div style="margin-top:10px"><button class="btn mini" data-act="reorder-csv">导出补货清单 CSV</button></div>`
      : '<div class="muted">🎉 暂无需要补货的品种。</div>';
  }
  paintUndo();
}

/* 需要补货的品种（低于下限，或按当前消耗撑不到提醒天数） */
function reorderList(kind) {
  return state[kind]
    .map(r => ({ r, u: usageOf(kind, r) }))
    .filter(o => isLow(o.r) || (o.u.daysLeft !== null && o.u.daysLeft <= o.u.reorder))
    .sort((a, b) => (a.u.daysLeft === null ? 1e9 : a.u.daysLeft) - (b.u.daysLeft === null ? 1e9 : b.u.daysLeft));
}
