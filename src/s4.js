
/* ============================== 视图：流水 ============================== */
function costSummary(list) {
  const byProject = {};
  list.forEach(l => {
    if (l.action !== "出库") return;
    const k = l.project || "(未归属项目)";
    const o = byProject[k] || (byProject[k] = { n: 0, qty: 0, amount: 0 });
    o.n++;
    o.qty += num(l.qty);
    o.amount += num(l.amount);
  });
  const byItem = {};
  list.forEach(l => {
    if (l.action !== "出库") return;
    const k = (l.kind === "reagents" ? "试剂 · " : "耗材 · ") + (l.itemName || "");
    const o = byItem[k] || (byItem[k] = { n: 0, qty: 0, amount: 0 });
    o.n++;
    o.qty += num(l.qty);
    o.amount += num(l.amount);
  });
  return { byProject, byItem };
}

function viewLogs() {
  const projects = [...new Set(state.logs.map(l => l.project).filter(Boolean))].sort();
  $("#content").innerHTML = `
    <div class="toolbar">
      <input id="q-logs" class="search" placeholder="搜索 物品 / 操作人 / 备注 / 项目" value="${esc(ui.q.logs)}">
      <select id="f-kind">
        <option value="all"${ui.logKind === "all" ? " selected" : ""}>全部类型</option>
        <option value="reagents"${ui.logKind === "reagents" ? " selected" : ""}>试剂</option>
        <option value="consumables"${ui.logKind === "consumables" ? " selected" : ""}>耗材</option>
      </select>
      <select id="f-proj"><option value="all">全部项目</option>${projects.map(p => `<option value="${esc(p)}"${ui.logProject === p ? " selected" : ""}>${esc(p)}</option>`).join("")}</select>
      <button class="btn" data-act="csv">导出 CSV</button>
    </div>
    <div class="cards" id="logStats"></div>
    <div class="panel">
      <h3>出入库流水 <em>删除流水不会回滚库存；出库填了项目就自动进成本统计</em></h3>
      <div class="tablewrap" id="logRows"></div>
    </div>
    <div class="grid2" id="costPanels"></div>`;
  $("#q-logs").oninput = e => { ui.q.logs = e.target.value; rowsLogs(); statsLogs(); };
  $("#f-kind").onchange = e => { ui.logKind = e.target.value; rowsLogs(); statsLogs(); };
  $("#f-proj").onchange = e => { ui.logProject = e.target.value; rowsLogs(); statsLogs(); };
  $("#content .toolbar").onclick = e => {
    if (e.target.closest("button[data-act=csv]")) exportCSV("logs");
  };
  $("#logRows").onclick = e => {
    const b = e.target.closest("button[data-act=del]");
    if (!b) return;
    const l = state.logs.find(x => x.id === b.dataset.id);
    if (!l) return;
    if (!confirm(`删除这条流水？\n${l.date} ${l.itemName} ${l.action} ${l.qty}\n（库存不会回滚）`)) return;
    pushUndo("删除流水");
    state.logs = state.logs.filter(x => x.id !== b.dataset.id);
    save();
    rowsLogs();
    statsLogs();
    toast("已删除流水");
  };
  rowsLogs();
  statsLogs();
}

function statsLogs() {
  const list = filterLogs();
  const inQ = list.filter(l => l.action === "入库").length;
  const outQ = list.filter(l => l.action === "出库").length;
  const last = list[0] ? list[0].date : "—";
  const month = todayStr().slice(0, 7);
  const monthOut = list.filter(l => l.action === "出库" && (l.date || "").slice(0, 7) === month).reduce((s, l) => s + num(l.amount), 0);
  $("#logStats").innerHTML = `
    <div class="stat card"><div class="k">流水条数</div><div class="v">${list.length}</div><div class="s">最近 ${esc(last)}</div></div>
    <div class="stat card"><div class="k">入库</div><div class="v" style="color:var(--ok)">${inQ}</div><div class="s">次</div></div>
    <div class="stat card"><div class="k">出库</div><div class="v" style="color:var(--accent-d)">${outQ}</div><div class="s">次</div></div>
    <div class="stat card"><div class="k">本月出库金额</div><div class="v">${monthOut ? "¥" + money(monthOut) : "—"}</div><div class="s">${month} · 按单价推算</div></div>`;
  paintCostPanels();
}

function paintCostPanels() {
  const list = filterLogs();
  const { byProject, byItem } = costSummary(list);
  const projRows = Object.entries(byProject).sort((a, b) => b[1].amount - a[1].amount).map(([k, o]) =>
    `<tr><td><b>${esc(k)}</b></td><td class="num">${o.n}</td><td class="num">${nf2(o.qty)}</td><td class="num">¥${money(o.amount)}</td></tr>`).join("");
  const itemRows = Object.entries(byItem).sort((a, b) => b[1].amount - a[1].amount).slice(0, 10).map(([k, o]) =>
    `<tr><td>${esc(k)}</td><td class="num">${nf2(o.qty)}</td><td class="num">¥${money(o.amount)}</td></tr>`).join("");
  const total = Object.values(byProject).reduce((s, o) => s + o.amount, 0);
  $("#costPanels").innerHTML = `
    <div class="panel">
      <h3>项目成本 <em>按「出库」流水汇总，需在试剂/耗材上填单价</em></h3>
      <div class="tablewrap">
        <table>
          <thead><tr><th>项目</th><th class="num">出库次数</th><th class="num">数量</th><th class="num">金额</th></tr></thead>
          <tbody>${projRows || '<tr><td colspan="4" class="empty">还没有带项目的出库流水</td></tr>'}</tbody>
          <tfoot><tr><td>合计</td><td class="num"></td><td class="num"></td><td class="num">¥${money(total)}</td></tr></tfoot>
        </table>
      </div>
    </div>
    <div class="panel">
      <h3>消耗最多 <em>前 10 项（按出库金额）</em></h3>
      <div class="tablewrap">
        <table>
          <thead><tr><th>物品</th><th class="num">数量</th><th class="num">金额</th></tr></thead>
          <tbody>${itemRows || '<tr><td colspan="3" class="empty">暂无出库流水</td></tr>'}</tbody>
        </table>
      </div>
    </div>`;
}

function rowsLogs() {
  const list = filterLogs();
  if (!list.length) { $("#logRows").innerHTML = '<div class="empty">暂无流水记录。</div>'; return; }
  $("#logRows").innerHTML = `<table>
    <thead><tr><th>日期</th><th>类型</th><th>物品</th><th>动作</th><th class="num">数量</th><th class="num">单价</th><th class="num">金额</th><th>项目</th><th>操作人</th><th>备注</th><th></th></tr></thead>
    <tbody>${list.map(l => `<tr>
      <td class="nowrap">${esc(l.date || "")}</td>
      <td>${l.kind === "reagents" ? "试剂" : "耗材"}</td>
      <td>${esc(l.itemName)}</td>
      <td><span class="tag ${l.action === "入库" ? "ok" : "info"}">${esc(l.action)}</span></td>
      <td class="num">${nf2(num(l.qty))} ${esc(l.unit || "")}</td>
      <td class="num">${l.unitPrice === null || l.unitPrice === undefined ? '<span class="muted">—</span>' : "¥" + nf2(num(l.unitPrice))}</td>
      <td class="num">${l.amount === null || l.amount === undefined ? '<span class="muted">—</span>' : "¥" + money(num(l.amount))}</td>
      <td>${esc(l.project || "") || '<span class="muted">—</span>'}</td>
      <td>${esc(l.operator || "")}</td>
      <td class="wrap-cell">${esc(l.note || "")}</td>
      <td><button class="btn mini ghost" data-act="del" data-id="${l.id}">删</button></td></tr>`).join("")}</tbody>
  </table>`;
  paintUndo();
}

/* ============================== 视图：数据 · 设置 ============================== */
function viewData() {
  const bytes = new Blob([JSON.stringify(state)]).size;
  const snaps = snapshotInfo();
  const snapValue = (num(state.settings.snapshots) || 7);
  const SERVER = MODE === "server";
  const kindOpts = [["mice", "小鼠记录"], ["breeding", "繁育记录"], ["reagents", "试剂"], ["consumables", "耗材"]]
    .map(([k, l]) => `<option value="${k}"${importState.kind === k ? " selected" : ""}>${l}</option>`).join("");

  $("#content").innerHTML = `
    <div class="grid2">
      <div class="panel">
        <h3>备份与恢复 <em>建议每周导出一次</em></h3>
        <div class="body hintbox">
          ${SERVER
      ? '数据保存在<b>服务器</b>（<code>data/db.json</code>），所有登录的人看到同一份；服务器每天自动留一份备份，保留 30 天。这里的 JSON 是当前全量快照，适合归档或迁移。'
      : '数据保存在本机浏览器里（<code>localStorage</code>），换电脑、换浏览器、清浏览器数据都不会自动带走，所以要用 JSON 文件留底。'}
          <div style="margin:12px 0;display:flex;gap:8px;flex-wrap:wrap">
            <button class="btn primary" data-act="bk">⬇ 下载 JSON 备份</button>
            <button class="btn" data-act="rs">⬆ 从 JSON 恢复</button>
            <input type="file" id="fileImport" accept=".json,application/json" style="display:none">
          </div>
          <div>当前数据量：<b>${(bytes / 1024).toFixed(1)} KB</b> · 小鼠 ${state.mice.length} · 繁育 ${state.breeding.length} · 试剂 ${state.reagents.length} · 耗材 ${state.consumables.length} · 流水 ${state.logs.length}</div>
        </div>
      </div>

      ${SERVER ? `<div class="panel">
        <h3>服务器状态 <em>多人共享</em></h3>
        <div class="body">
          <div class="items">
            <div class="row"><b>当前账号</b><span class="r">${esc(myName())}（${esc(ROLE_TEXT[ME.role] || "")}）</span></div>
            <div class="row"><b>服务器</b><span class="r">${esc(location.host)}</span></div>
            <div class="row"><b>数据版本</b><span class="r">rev ${REV} · ${hasLocal() ? "有改动待保存" : "已同步"}</span></div>
            <div class="row"><b>最近同步</b><span class="r">${lastSyncAt ? esc(fmtTime(lastSyncAt)) : "—"}</span></div>
          </div>
          <div class="hintbox" style="margin-top:10px">其他人在别的电脑上改动，这里 6 秒内自动跟上；同一条记录两人同时改，以后保存的为准，日志里能查到是谁改的。</div>
        </div>
      </div>` : `<div class="panel">
        <h3>每日自动快照 <em>每天第一次保存时自动留一份，最多 ${snapValue} 份（占 ${(snaps.bytes / 1024).toFixed(1)} KB）</em></h3>
        <div class="body">
          ${snaps.list.length ? `<div class="items">${snaps.list.map(s => `<div class="row">
            <b>${esc(s.date)}</b>
            <span class="r">${(s.json.length / 1024).toFixed(1)} KB</span>
            <button class="btn mini" data-act="snap" data-date="${esc(s.date)}">恢复</button>
          </div>`).join("")}</div>` : '<div class="muted">还没有快照：改动一次数据后就会自动生成。</div>'}
          <div style="margin-top:10px"><button class="btn mini danger" data-act="snap-clear">清空所有快照</button></div>
        </div>
      </div>`}
    </div>

    <div class="panel">
      <h3>导入表格 <em>从 Excel / WPS / Numbers 复制粘贴，或选 .csv / .tsv 文件；表头会自动识别</em></h3>
      <div class="body">
        <div class="toolbar">
          <select id="imp-kind">${kindOpts}</select>
          <button class="btn" data-act="imp-file">📄 选择文件…</button>
          <input type="file" id="impFile" accept=".csv,.tsv,.txt,text/csv" style="display:none">
          <button class="btn" data-act="imp-parse">解析预览</button>
          <button class="btn primary" data-act="imp-do">确认导入</button>
          <button class="btn" data-act="imp-clear">清空</button>
        </div>
        <textarea id="imp-text" rows="5" style="width:100%;padding:10px;border:1px solid var(--line);border-radius:8px;font-family:ui-monospace,Consolas,monospace;font-size:12.5px" placeholder="把整块表格（含表头一行）粘贴到这里，例如：&#10;品系	性别	笼数	只数/笼	实验目的&#10;C57BL/6J	雄	6	5	MC38 荷瘤"></textarea>
        <div id="imp-preview" style="margin-top:12px">${importPreviewHTML()}</div>
      </div>
    </div>

    <div class="grid2">
      <div class="panel">
        <h3>导出 Excel / 表格</h3>
        <div class="body hintbox">
          导出的是 CSV（UTF-8 BOM），双击即可用 Excel / WPS 打开，中文不乱码；导出的表头可以直接再导入回来。
          <div style="margin:12px 0;display:flex;gap:8px;flex-wrap:wrap">
            <button class="btn" data-act="e-mice">小鼠 CSV</button>
            <button class="btn" data-act="e-breeding">繁育 CSV</button>
            <button class="btn" data-act="e-reagents">试剂 CSV</button>
            <button class="btn" data-act="e-consumables">耗材 CSV</button>
            <button class="btn" data-act="e-logs">流水 CSV</button>
          </div>
          <div>导出的是<b>当前筛选结果</b>；想导全部请先清空搜索条件。</div>
        </div>
      </div>

      <div class="panel">
        <h3>参数设置</h3>
        <div class="body hintbox">
          <div class="setting"><span>有效期提前提醒</span>
            <input type="number" id="set-exp" min="1" max="365" value="${num(state.settings.expWarn) || 30}"><em>天</em></div>
          <div class="setting"><span>小鼠妊娠天数</span>
            <input type="number" id="set-gest" min="1" max="60" value="${gestDays()}"><em>天（默认 20）</em></div>
          <div class="setting"><span>仔鼠断奶天数</span>
            <input type="number" id="set-wean" min="1" max="60" value="${weanDays()}"><em>天（默认 21）</em></div>
          <div class="setting"><span>保留自动快照</span>
            <input type="number" id="set-snap" min="1" max="30" value="${snapValue}"><em>份</em></div>
          <div class="setting"><span>消耗统计窗口</span>
            <input type="number" id="set-usage" min="7" max="730" value="${usageWindow()}"><em>天（用这段出库量算日均）</em></div>
          <div class="setting"><span>提前提醒补货</span>
            <input type="number" id="set-reorder" min="1" max="365" value="${reorderDays()}"><em>天（可用天数低于它就算「即将用完」）</em></div>
          <div style="margin-top:10px"><button class="btn primary" data-act="save-set">保存设置</button></div>
          <div style="margin-top:8px">周龄一律按“今天”实时换算；填了出生日期就会自动增长。<br>主题（浅色 / 深色 / 跟随系统）点右上角的 🌓 切换。</div>
        </div>
      </div>
    </div>

    <div class="panel">
      <h3>其他</h3>
      <div class="body hintbox">
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">
          <button class="btn" data-act="demo">载入示例数据</button>
          <button class="btn" data-act="clear">清空全部数据</button>
        </div>
        <div>• 数据版本 v${state.meta.v} · 单文件离线版，不上传任何数据。
        <br>• 多人同时用：不要把这个文件放在共享盘各自打开，会产生多份互不同步的数据。
        <br>• 手机/平板：文件拷过去用浏览器打开也能用，但与本机数据不互通（用 JSON 备份搬运）。</div>
      </div>
    </div>`;

  $("#content").onclick = e => {
    const b = e.target.closest("button[data-act]");
    if (!b) return;
    const act = b.dataset.act;
    if (act === "bk") backupJSON();
    if (act === "rs") $("#fileImport").click();
    if (act.startsWith("e-")) exportCSV(act.slice(2));
    if (act === "save-set") saveSettings();
    if (act === "demo") loadDemo();
    if (act === "clear") clearAll();
    if (act === "snap") restoreSnapshot(b.dataset.date);
    if (act === "snap-clear") {
      if (!confirm("清空所有自动快照？当前数据不受影响。")) return;
      localStorage.removeItem(SNAP_KEY);
      render();
      toast("快照已清空");
    }
    if (act === "imp-file") $("#impFile").click();
    if (act === "imp-parse") previewImport();
    if (act === "imp-do") doImport();
    if (act === "imp-clear") { importState = { kind: importState.kind, records: [], dups: 0, headers: [] }; $("#imp-text").value = ""; $("#imp-preview").innerHTML = importPreviewHTML(); }
  };
  $("#imp-kind").onchange = e => { importState.kind = e.target.value; importState.records = []; importState.dups = 0; $("#imp-preview").innerHTML = importPreviewHTML(); };
  $("#fileImport").onchange = e => importJSON(e.target.files[0]);
  $("#impFile").onchange = e => readImportFile(e.target.files[0]);
}

function saveSettings() {
  pushUndo("修改设置");
  state.settings.expWarn = Math.max(1, Math.min(365, num($("#set-exp").value) || 30));
  state.settings.gestDays = Math.max(1, Math.min(60, num($("#set-gest").value) || 20));
  state.settings.weanDays = Math.max(1, Math.min(60, num($("#set-wean").value) || 21));
  state.settings.snapshots = Math.max(1, Math.min(30, num($("#set-snap").value) || 7));
  state.settings.usageDays = Math.max(7, Math.min(730, num($("#set-usage").value) || 90));
  state.settings.reorderDays = Math.max(1, Math.min(365, num($("#set-reorder").value) || 30));
  save();
  render();
  toast("设置已保存");
}
