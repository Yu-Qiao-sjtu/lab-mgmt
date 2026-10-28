
/* ============================== 表单弹窗 ============================== */
let editing = { kind: null, id: null };

function fieldHTML(kind, f, val) {
  const id = "f_" + f.k;
  let input;
  const listAttr = f.list ? ` list="dl_${kind}_${f.k}"` : "";
  switch (f.t) {
    case "textarea":
      input = `<textarea id="${id}" name="${f.k}" rows="2" placeholder="${esc(f.ph || "")}">${esc(val ?? "")}</textarea>`;
      break;
    case "select":
      input = `<select id="${id}" name="${f.k}">${(f.opts || []).map(o => `<option${o === (val ?? f.def ?? f.opts[0]) ? " selected" : ""}>${esc(o)}</option>`).join("")}</select>`;
      break;
    case "date":
      input = `<input id="${id}" name="${f.k}" type="date" value="${esc(val || "")}">`;
      break;
    case "number":
      input = `<input id="${id}" name="${f.k}" type="number" step="${f.step || "any"}" min="${f.min ?? 0}" value="${val === null || val === undefined || val === "" ? "" : esc(val)}" placeholder="${esc(f.ph || "")}">`;
      break;
    default:
      input = `<input id="${id}" name="${f.k}" type="text" value="${esc(val ?? "")}" placeholder="${esc(f.ph || "")}"${listAttr}>`;
  }
  return `<label class="field${f.wide ? " wide" : ""}"><span>${esc(f.l)}${f.req ? " <b>*</b>" : ""}</span>${input}${f.hint ? `<em>${esc(f.hint)}</em>` : ""}</label>`;
}

/* 下拉自动补全的值：本表已有值 + 自定义补充 */
function listValues(kind, key, extra) {
  const vals = new Set(state[kind].map(r => r[key]).filter(v => v !== "" && v !== null && v !== undefined));
  (extra || []).forEach(v => { if (v) vals.add(v); });
  return [...vals];
}

function openForm(kind, id) {
  const fields = SCHEMA[kind];
  const rec = id ? state[kind].find(x => x.id === id) : null;
  editing = { kind, id: id || null };
  const isNew = !rec;
  const title = { mice: "小鼠记录", breeding: "繁育配对", reagents: "试剂", consumables: "耗材" }[kind];

  const extra = kind === "mice" ? listValues("breeding", "strain") : [];
  const dl = fields.filter(f => f.list).map(f => {
    const vals = listValues(kind, f.k, f.k === "strain" ? extra : []);
    return `<datalist id="dl_${kind}_${f.k}">${vals.map(v => `<option value="${esc(v)}">`).join("")}</datalist>`;
  }).join("");

  $("#mTitle").textContent = (isNew ? "新增" : "编辑") + title;
  $("#mBody").innerHTML = dl + fields.map(f => fieldHTML(kind, f, rec ? rec[f.k] : (f.def ?? ""))).join("");
  $("#mHint").innerHTML = "";
  $("#modal").classList.remove("hidden");
  const first = $("#mBody input, #mBody select, #mBody textarea");
  if (first) setTimeout(() => first.focus(), 30);

  if (kind === "mice") hookMouseForm();
  if (kind === "breeding") hookBreedForm();
  $("#mForm").onsubmit = onSubmitForm;
}

function hookMouseForm() {
  const c = $("#f_cages"), p = $("#f_perCage"), dob = $("#f_dob"), aw = $("#f_ageWeeks"), ad = $("#f_ageDate");
  const hint = $("#mHint");
  if (!c || !p) return;
  const upd = () => {
    const t = num(c.value) * num(p.value);
    let s = `合计 <span class="total">${nf(t)}</span> 只`;
    if (dob.value) {
      const w = (Date.now() - new Date(dob.value + "T00:00:00").getTime()) / 86400000 / 7;
      s += ` · 按出生日期约 <span class="total">${nf(w)}</span> 周`;
    } else if (aw.value) {
      s += ` · 手填周龄 ${nf(num(aw.value))} 周`;
      if (ad.value) s += `（截至 ${esc(ad.value)}，按今天已 ${nf(num(aw.value) + (dayDiff(ad.value) || 0) / -7)} 周）`;
    }
    hint.innerHTML = s;
  };
  [c, p, dob, aw, ad].forEach(el => el && el.addEventListener("input", upd));
  upd();
}

function hookBreedForm() {
  const paired = $("#f_paired"), born = $("#f_born"), weaned = $("#f_weanedDate");
  const hint = $("#mHint");
  if (!paired) return;
  const upd = () => {
    const parts = [];
    if (born.value) {
      parts.push(`已出生 ${Math.max(0, -dayDiff(born.value))} 天`);
      if (!weaned.value) parts.push(`预计 ${addDays(born.value, weanDays())} 断奶`);
    } else if (paired.value) {
      parts.push(`预计 ${addDays(paired.value, gestDays())} 生产（合笼 + ${gestDays()} 天）`);
    }
    if (weaned.value) parts.push(`已于 ${weaned.value} 断奶`);
    hint.innerHTML = parts.join(" · ") || "填「合笼日期」后自动推算预产期";
  };
  [paired, born, weaned].forEach(el => el && el.addEventListener("input", upd));
  upd();
}

function readForm(kind) {
  const out = {};
  SCHEMA[kind].forEach(f => {
    const el = document.getElementById("f_" + f.k);
    if (!el) return;
    const v = el.value;
    if (f.t === "number") out[f.k] = v === "" ? null : num(v);
    else out[f.k] = String(v).trim();
  });
  return out;
}

function onSubmitForm(ev) {
  ev.preventDefault();
  const { kind, id } = editing;
  if (!kind || !SCHEMA[kind]) return;
  const data = readForm(kind);
  const missing = SCHEMA[kind].filter(f => f.req && (data[f.k] === "" || data[f.k] === null)).map(f => f.l);
  if (missing.length) { toast("请填写：" + missing.join("、"), true); return; }
  if (kind === "mice" && totalMice(data) <= 0) { toast("笼子数量和只数/笼都要大于 0，否则总只数为 0", true); return; }
  if (kind === "breeding" && data.born && data.paired && data.born < data.paired) {
    toast("出生日期早于合笼日期，请检查", true);
    return;
  }
  /* 繁育状态随里程碑自动推进（用户手动选了「已结束」则不动） */
  if (kind === "breeding" && data.status !== "已结束") {
    if (data.weanedDate) data.status = "已断奶";
    else if (data.born) { if (data.status === "配对中") data.status = "哺乳"; }
    else if (data.pregCheck && data.status === "配对中") data.status = "怀孕";
  }

  pushUndo(id ? `编辑${KIND_LABEL[kind]}` : `新增${KIND_LABEL[kind]}`);
  if (id) {
    const rec = state[kind].find(x => x.id === id);
    Object.assign(rec, normalizeRecord(kind, data), { updatedAt: new Date().toISOString() });
  } else {
    state[kind].unshift(Object.assign({ id: uid(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }, normalizeRecord(kind, data)));
  }
  save();
  closeModal();
  render();
  toast(id ? "已保存修改" : "已新增");
}

function closeModal() {
  $("#modal").classList.add("hidden");
  $("#mForm").onsubmit = null;
  editing = { kind: null, id: null };
}

function delRecord(kind, id) {
  const rec = state[kind].find(x => x.id === id);
  if (!rec) return;
  const name = kind === "mice" ? `${rec.strain}（${rec.purpose || ""}）`
    : kind === "breeding" ? `${rec.strain || ""} ${rec.code || ""}`
    : rec.name;
  if (!confirm(`确定删除「${name}」？\n删掉后可以按 Ctrl+Z 撤销。`)) return;
  pushUndo("删除" + KIND_LABEL[kind]);
  state[kind] = state[kind].filter(x => x.id !== id);
  save();
  render();
  toast("已删除，Ctrl+Z 可撤销");
}

function copyRecord(kind, id) {
  const rec = state[kind].find(x => x.id === id);
  if (!rec) return;
  pushUndo("复制" + KIND_LABEL[kind]);
  const copy = Object.assign({}, rec, { id: uid(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  state[kind].unshift(normalizeRecord(kind, copy));
  save();
  render();
  openForm(kind, copy.id);
  toast("已复制一条，改完笼号/耳号再保存");
}

/* ============================== 出入库 ============================== */
function openStock(kind, id) {
  const r = state[kind].find(x => x.id === id);
  if (!r) return;
  editing = { kind: "__stock", id };
  const projects = [...new Set(state.logs.map(l => l.project).filter(Boolean))].sort();
  const price = numOrNull(r.unitPrice);
  $("#mTitle").textContent = `${r.name} · 出入库`;
  $("#mBody").innerHTML = `
    <div class="field wide"><span>当前库存</span><div style="padding:6px 0;font-weight:700;font-size:16px">${nf2(num(r.qty))} ${esc(r.unit || "")}${price !== null ? ` <span class="muted" style="font-size:12px;font-weight:400">· 单价 ¥${nf2(price)}</span>` : ""}</div></div>
    <label class="field"><span>日期</span><input type="date" name="date" value="${todayStr()}"></label>
    <label class="field"><span>动作</span><select name="action"><option>入库</option><option>出库</option></select></label>
    <label class="field"><span>数量 <b>*</b></span><input type="number" name="qty" step="any" min="0" placeholder="如 1"></label>
    <label class="field"><span>单价（元 / 单位）</span><input type="number" name="unitPrice" step="any" min="0" value="${price === null ? "" : esc(price)}" placeholder="留空则不计成本"></label>
    <label class="field"><span>项目 / 课题</span><input type="text" name="project" list="dl-projects" placeholder="如 PD-1 联合治疗"><datalist id="dl-projects">${projects.map(p => `<option value="${esc(p)}">`).join("")}</datalist></label>
    <label class="field"><span>操作人</span><input type="text" name="operator" placeholder="姓名"></label>
    <label class="field wide"><span>备注</span><textarea name="note" rows="2" placeholder="如 新到货 / 实验消耗 / 借出"></textarea></label>`;
  $("#mHint").innerHTML = "";
  $("#modal").classList.remove("hidden");
  const qtyEl = $('[name="qty"]'), priceEl = $('[name="unitPrice"]');
  const upd = () => {
    const q = num(qtyEl.value), p = numOrNull(priceEl.value);
    $("#mHint").innerHTML = p === null ? "填单价后自动算金额" : `本次金额约 <span class="total">¥${money(q * p)}</span>`;
  };
  [qtyEl, priceEl].forEach(el => el && el.addEventListener("input", upd));
  upd();
  setTimeout(() => qtyEl && qtyEl.focus(), 30);

  $("#mForm").onsubmit = ev => {
    ev.preventDefault();
    const fd = new FormData($("#mForm"));
    const qty = num(fd.get("qty"));
    if (qty <= 0) { toast("数量必须大于 0", true); return; }
    const action = String(fd.get("action"));
    if (action === "出库" && qty > num(r.qty)) { toast(`库存不足，当前只有 ${nf2(num(r.qty))} ${r.unit || ""}`, true); return; }
    const unitPrice = numOrNull(fd.get("unitPrice"));
    pushUndo(`${action} ${r.name}`);
    r.qty = Math.round((num(r.qty) + (action === "入库" ? qty : -qty)) * 100) / 100;
    if (unitPrice !== null) r.unitPrice = unitPrice;
    r.updatedAt = new Date().toISOString();
    state.logs.push({
      id: uid(), ts: Date.now(), date: String(fd.get("date")) || todayStr(),
      kind, itemId: r.id, itemName: r.name, unit: r.unit || "",
      action, qty,
      unitPrice,
      amount: unitPrice === null ? null : Math.round(qty * unitPrice * 100) / 100,
      project: String(fd.get("project") || "").trim(),
      operator: String(fd.get("operator") || "").trim(),
      note: String(fd.get("note") || "").trim()
    });
    save();
    closeModal();
    render();
    toast(`${action}成功，当前 ${nf2(num(r.qty))} ${r.unit || ""}`);
  };
}

/* ============================== 繁育 → 小鼠 ============================== */
function openConvert(id) {
  const r = state.breeding.find(x => x.id === id);
  if (!r) return;
  editing = { kind: "__convert", id };
  const count = num(r.weanedCount) || num(r.pups) || 0;
  const cages = num(r.destCages) || (count ? Math.ceil(count / 5) : 1);
  const perCage = num(r.destPerCage) || (cages ? Math.max(1, Math.round(count / cages)) : 5);
  $("#mTitle").textContent = `转成小鼠记录 · ${r.strain} ${r.code || ""}`;
  $("#mBody").innerHTML = `
    <div class="field wide"><span>来源</span><div class="muted" style="padding:4px 0">
      ${esc(r.strain)} · 父 ${esc(r.father || "-")} × 母 ${esc(r.mother || "-")} · 出生 ${esc(r.born || "—")} · ${count ? count + " 只仔鼠" : "未填仔数"}
    </div></div>
    <label class="field"><span>笼子数量 <b>*</b></span><input type="number" name="cages" step="1" min="1" value="${cages}"></label>
    <label class="field"><span>只数 / 笼 <b>*</b></span><input type="number" name="perCage" step="1" min="1" value="${perCage}"></label>
    <label class="field"><span>性别</span><select name="sex"><option>混合</option><option>雄</option><option>雌</option></select></label>
    <label class="field"><span>出生日期</span><input type="date" name="dob" value="${esc(r.born || "")}"></label>
    <label class="field wide"><span>实验目的</span><textarea name="purpose" rows="2">${esc(r.purpose || "繁育自产，断奶后备用")}</textarea></label>
    <label class="field"><span>项目 / 课题</span><input type="text" name="project" value="${esc(r.project || "")}"></label>
    <label class="field"><span>房间 / 架位</span><input type="text" name="room" value="${esc(r.room || "")}"></label>
    <label class="field"><span>负责人</span><input type="text" name="keeper" value="${esc(r.keeper || "")}"></label>`;
  $("#mHint").innerHTML = "";
  $("#modal").classList.remove("hidden");
  const cagesEl = $('[name="cages"]'), perEl = $('[name="perCage"]');
  const upd = () => { $("#mHint").innerHTML = `合计 <span class="total">${nf(num(cagesEl.value) * num(perEl.value))}</span> 只`; };
  [cagesEl, perEl].forEach(el => el && el.addEventListener("input", upd));
  upd();

  $("#mForm").onsubmit = ev => {
    ev.preventDefault();
    const fd = new FormData($("#mForm"));
    const data = {
      strain: r.strain, sex: String(fd.get("sex")), cages: num(fd.get("cages")), perCage: num(fd.get("perCage")),
      dob: isoDate(fd.get("dob")), purpose: String(fd.get("purpose") || "").trim() || "繁育自产",
      project: String(fd.get("project") || "").trim(), room: String(fd.get("room") || "").trim(),
      keeper: String(fd.get("keeper") || "").trim(),
      earTag: r.code ? "配对 " + r.code : "", status: "在养",
      note: `由繁育台账转入（配对 ${r.code || "-"}，母 ${r.mother || "-"}）`
    };
    if (totalMice(data) <= 0) { toast("笼数和只数/笼必须大于 0", true); return; }
    pushUndo("繁育转小鼠");
    state.mice.unshift(Object.assign({ id: uid(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }, normalizeRecord("mice", data)));
    if (!r.weanedDate) r.weanedDate = todayStr();
    if (!r.weanedCount) r.weanedCount = count || totalMice(data);
    r.status = "已断奶";
    r.updatedAt = new Date().toISOString();
    save();
    closeModal();
    setView("mice");
    toast("已生成小鼠记录，共 " + nf(totalMice(data)) + " 只");
  };
}

/* ============================== 打印笼牌 ============================== */
function printCages() {
  const list = filterMice().filter(isActive);
  if (!list.length) { toast("当前筛选下没有在养记录", true); return; }
  const date = todayStr();
  const layout = state.settings.cardLayout || "6";
  const cages = list.reduce((s, r) => s + num(r.cages), 0);
  $("#printArea").innerHTML = `<h2 class="print-h">笼牌 · ${date} · 共 ${list.length} 条 / ${nf(cages)} 笼</h2>
    <div class="cage-grid l${layout}">${list.map(r => {
      const a = ageOf(r);
      return `<div class="cage">
        <div class="t">${esc(r.strain || "")} ${esc(r.sex ? "· " + r.sex : "")}</div>
        <div class="g">
          ${r.earTag ? `笼号/耳号：${esc(r.earTag)}<br>` : ""}
          笼数：<b>${nf(num(r.cages))}</b> · 只数/笼：<b>${nf(num(r.perCage))}</b> · 合计 <b>${nf(totalMice(r))}</b> 只<br>
          周龄：${a.w === null ? "____" : nf(a.w) + " 周"}${r.dob ? "（出生 " + esc(r.dob) + "）" : ""}<br>
          ${r.project ? "项目：" + esc(r.project) + "<br>" : ""}
          ${r.room ? "位置：" + esc(r.room) : ""}
        </div>
        <div class="p">实验目的：${esc(r.purpose || "")}${r.keeper ? "　负责人：" + esc(r.keeper) : ""}　${date}</div>
      </div>`;
    }).join("")}</div>`;
  window.print();
}
