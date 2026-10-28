
/* ==========================================================================
 * 多用户模式（连服务器）
 *
 * 同一个 index.html 有两种活法：
 *   1. 双击打开（file://）或托管在静态空间 → 纯离线，数据在 localStorage，和以前一模一样；
 *   2. 由 node server/index.js 提供 → 先登录，数据在服务器，多人实时同步。
 *
 * 同步策略（为什么不会互相覆盖）：
 *   - 每次保存只发「变了的那几条记录」，按 id 合并，不是整库覆盖；
 *   - 记录上带 _by / _at，谁改的、什么时候改的，服务端审计里查得到；
 *   - 同一条记录两人同时改 → 后写的生效，对方下一次轮询会看到新版本并提示；
 *   - 断网时改动暂存在当前页面，恢复后自动重发（不静默丢失）。
 * ========================================================================== */
const ROLE_TEXT = { admin: "管理员", editor: "实验员", viewer: "只读" };
const COLLS = ["mice", "breeding", "reagents", "consumables", "logs"];

let MODE = DEMO ? "demo" : "offline";   // demo / offline / server
let ME = null;                          // 当前登录用户
let MY_PERMS = null;                    // 服务端下发的权限
let REV = 0;                            // 服务器修订号（用于增量拉取）
let SYNCED = null;                      // 最后一次同步成功时的数据快照
let syncTimer = null, syncing = false, lastSyncAt = 0, lastSyncErr = "", pollTimer = null;
let pendingRender = false;
/* CSRF：写操作必须带登录时下发的令牌（防跨站伪造请求） */
let CSRF = "";
const _rawFetch = window.fetch.bind(window);
function apiFetch(url, opts) {
  opts = opts || {};
  const m = String(opts.method || "GET").toUpperCase();
  if (m !== "GET" && CSRF && String(url).indexOf("/api/login") < 0) {
    opts.headers = Object.assign({}, opts.headers || {}, { "X-CSRF-Token": CSRF });
  }
  return _rawFetch(url, opts);
}


const isAdmin = () => !!(MY_PERMS && MY_PERMS.manageUsers);
const canWrite = () => {
  if (MODE !== "server") return true;          // 离线版一直是原来自助的样子
  return !!(MY_PERMS && MY_PERMS.writeData);
};
const myName = () => (ME && (ME.name || ME.username)) || "";
const coreOf = s => ({
  mice: s.mice, breeding: s.breeding, reagents: s.reagents,
  consumables: s.consumables, logs: s.logs, settings: s.settings
});
const snapshotOf = s => JSON.parse(JSON.stringify(coreOf(s)));

/* 记录比较时忽略服务端打的时间戳，否则自己的改动会被反复重发 */
function stripped(rec) {
  const o = {};
  for (const k in rec) if (k !== "_by" && k !== "_at") o[k] = rec[k];
  return o;
}
const canonical = rec => {
  const s = stripped(rec);
  return JSON.stringify(s, Object.keys(s).sort());
};

function buildPatch(base, cur) {
  const patch = {};
  for (const coll of COLLS) {
    const bmap = new Map((base[coll] || []).map(r => [r.id, r]));
    const cmap = new Map((cur[coll] || []).map(r => [r.id, r]));
    const up = [], del = [];
    cmap.forEach((r, id) => {
      if (!r || !id) return;
      const o = bmap.get(id);
      if (!o || canonical(o) !== canonical(r)) up.push(stripped(r));
    });
    bmap.forEach((r, id) => { if (!cmap.has(id)) del.push(id); });
    if (up.length || del.length) patch[coll] = { up, del };
  }
  if (MY_PERMS && MY_PERMS.writeSettings && JSON.stringify(base.settings) !== JSON.stringify(cur.settings)) {
    patch.settings = cur.settings;
  }
  return patch;
}

const hasLocal = () => !!SYNCED && Object.keys(buildPatch(SYNCED, coreOf(state))).length > 0;

/* ---------------------------- 登录界面 ---------------------------- */
const AUTH_HINT = {
  bad_credentials: "用户名或密码不对。忘了密码请找管理员重置。",
  locked: "尝试次数太多，稍等几分钟再试。",
  disabled: "这个账号已被停用，请联系管理员。"
};

function showAuth(opts) {
  const o = opts || {};
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  const el = $("#authScreen");
  if (!el) return;
  el.classList.remove("hidden");
  const err = o.error || "";
  el.innerHTML = o.forceChange ? `
    <div class="auth-card">
      <div class="auth-brand">🔒 先设置你自己的密码</div>
      <p class="auth-sub">第一次登录必须改密码：初始密码是管理员给的，别人也知道，不能继续用。</p>
      <form id="authForm" autocomplete="off">
        <label>原密码（管理员给的）<input type="password" id="authOld" required autocomplete="current-password"></label>
        <label>新密码（至少 6 位，需含大写字母 + 数字 + 特殊符号）<input type="password" id="authNew" required autocomplete="new-password"></label>
        <label>再输一次<input type="password" id="authNew2" required autocomplete="new-password"></label>
        <button class="btn primary" type="submit">${o.busy ? "提交中…" : "保存并进入"}</button>
        <div class="auth-err" id="authErr">${esc(err)}</div>
      </form>
      <div class="auth-foot">${esc(ME ? myName() : "")} · <a href="#" id="authLogout">退出</a></div>
    </div>` : `
    <div class="auth-card">
      <div class="auth-brand">🐭 实验室管理台</div>
      <p class="auth-sub">小鼠 · 繁育 · 试剂 · 耗材 · 多用户版</p>
      <form id="authForm" autocomplete="off">
        <label>用户名<input id="authUser" required autocomplete="username" autocapitalize="none" spellcheck="false"></label>
        <label>密码<input type="password" id="authPw" required autocomplete="current-password"></label>
        <button class="btn primary" type="submit">${o.busy ? "登录中…" : "登录"}</button>
        <div class="auth-err" id="authErr">${esc(err)}</div>
      </form>
      <div class="auth-foot">
        没有账号？找实验室管理员开。<br>
        <span class="mono">${esc(location.host)}</span>
      </div>
    </div>`;

  const form = $("#authForm");
  if (o.forceChange) {
    form.onsubmit = async e => {
      e.preventDefault();
      const oldPw = $("#authOld").value, a = $("#authNew").value, b = $("#authNew2").value;
      if (a !== b) { $("#authErr").textContent = "两次输入的新密码不一样"; return; }
      showAuth(Object.assign({}, o, { forceChange: true, busy: true }));
      const r = await apiFetch("/api/password", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ old: oldPw, new: a })
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { showAuth({ forceChange: true, error: j.error || "改密码失败" }); return; }
      toast("密码已更新");
      await enterApp();
    };
    $("#authLogout").onclick = e => { e.preventDefault(); remoteLogout(true); };
  } else {
    form.onsubmit = async e => {
      e.preventDefault();
      const u = $("#authUser").value.trim(), p = $("#authPw").value;
      const btn = form.querySelector("button");
      btn.disabled = true; btn.textContent = "登录中…";
      $("#authErr").textContent = "";
      try {
        const r = await apiFetch("/api/login", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ username: u, password: p })
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) {
          $("#authErr").textContent = j.error || AUTH_HINT[j.code] || "登录失败";
          btn.disabled = false; btn.textContent = "登录";
          return;
        }
        ME = j.user; MY_PERMS = j.perms; if (j.csrf) CSRF = j.csrf;
        await enterApp();
      } catch (err2) {
        $("#authErr").textContent = "连不上服务器：检查电脑和网络，或问管理员服务是否在运行";
        btn.disabled = false; btn.textContent = "登录";
      }
    };
    setTimeout(() => { const i = $("#authUser"); if (i) i.focus(); }, 50);
  }
}

function hideAuth() {
  const el = $("#authScreen");
  if (el) { el.classList.add("hidden"); el.innerHTML = ""; }
}

async function enterApp() {
  const r = await apiFetch("/api/bootstrap");
  if (r.status === 401) { ME = null; showAuth({ error: "登录已过期，请重新登录" }); return; }
  const j = await r.json().catch(() => null);
  /* 首次登录未改密码：服务端不让读数据，必须先改密码 */
  if (r.status === 403 && j && j.mustChangePassword) { showAuth({ forceChange: true }); return; }
  if (!j || !j.data) { showAuth({ error: (j && j.error) || "服务器返回异常" }); return; }
  if (j.user && j.user.mustChangePassword) { ME = j.user; MY_PERMS = j.perms; if (j.csrf) CSRF = j.csrf; showAuth({ forceChange: true }); return; }
  ME = j.user || ME;
  MY_PERMS = j.perms || MY_PERMS; if (j.csrf) CSRF = j.csrf;
  state = migrate(j.data);
  REV = j.rev;
  SYNCED = snapshotOf(state);
  lastSyncAt = Date.now();
  lastSyncErr = "";
  hideAuth();
  paintIdentity();
  render();
  startPolling();
  toast(`已登录：${myName()}（${ROLE_TEXT[ME.role] || ME.role}）`);
}

function paintIdentity() {
  const chip = $("#userChip");
  if (chip) {
    if (MODE === "server" && ME) {
      chip.classList.remove("hidden");
      chip.innerHTML = `<span class="who" title="${esc(ME.username)}">👤 ${esc(myName())}<span class="role ${esc(ME.role)}">${esc(ROLE_TEXT[ME.role] || ME.role)}</span></span>
        <button class="btn mini ghost" id="btnPw" type="button" title="修改我的密码">🔑</button>
        <button class="btn mini ghost" id="btnLogout" type="button" title="退出登录">退出</button>`;
      $("#btnLogout").onclick = () => remoteLogout(false);
      $("#btnPw").onclick = changeMyPassword;
    } else {
      chip.classList.add("hidden");
      chip.innerHTML = "";
    }
  }
  $$("#nav button[data-admin]").forEach(b => { b.style.display = isAdmin() ? "" : "none"; });
  const ro = $("#roBar");
  if (ro) {
    const showRo = MODE === "server" && !canWrite();
    ro.style.display = showRo ? "" : "none";
    if (showRo) ro.innerHTML = "🔒 <b>只读账号</b>：可以查看和导出，不能修改数据。需要录入请找管理员要「实验员」权限。";
  }
}

async function remoteLogout(silent) {
  if (!silent && hasLocal() && !confirm("还有改动没同步到服务器，确定退出？")) return;
  try { await flush(); } catch (e) { /* ignore */ }
  try { await apiFetch("/api/logout", { method: "POST" }); } catch (e) { /* ignore */ }
  ME = null; MY_PERMS = null; SYNCED = null; REV = 0;
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  state = blankState();
  paintIdentity();
  render();
  showAuth({});
}

function sessionLost() {
  if (MODE !== "server") return;
  ME = null; MY_PERMS = null; SYNCED = null;
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  showAuth({ error: "登录已过期，请重新登录（未同步的改动会保留在页面上）" });
}

function changeMyPassword() {
  const oldPw = prompt("当前密码：");
  if (oldPw === null) return;
  const a = prompt("新密码（至少 6 位，需含大写字母 + 数字 + 特殊符号）：");
  if (a === null) return;
  const b = prompt("再输一次新密码：");
  if (b === null) return;
  if (a !== b) { toast("两次输入不一样", true); return; }
  apiFetch("/api/password", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ old: oldPw, new: a })
  }).then(async r => {
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { toast(j.error || "改密码失败", true); return; }
    toast("密码已更新");
    ME.mustChangePassword = false;
  }).catch(() => toast("网络错误，稍后再试", true));
}

/* ---------------------------- 同步 ---------------------------- */
function queueSync() {
  paintSaveInfo();
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => { syncTimer = null; flush(); }, 600);
}

async function flush(keepalive) {
  if (MODE !== "server" || !ME || syncing || !SYNCED) return false;
  const snap = snapshotOf(state);
  const patch = buildPatch(SYNCED, snap);
  if (!Object.keys(patch).length) { SYNCED = snap; return true; }
  syncing = true;
  try {
    const r = await apiFetch("/api/sync", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ baseRev: REV, patch }),
      keepalive: !!keepalive
    });
    if (r.status === 401) { sessionLost(); return false; }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      lastSyncErr = j.error || "HTTP " + r.status;
      toast("保存失败：" + lastSyncErr, true);
      return false;
    }
    if (j.conflicts && j.conflicts.length) {
      // 这些记录别人先改过：服务端保住了对方版本，本地这次没有写入
      const n = j.conflicts.length;
      const who = [...new Set(j.conflicts.map(c => c.by).filter(Boolean))].join("、");
      REV = j.rev;
      lastSyncAt = Date.now();
      lastSyncErr = `冲突 ${n} 条`;
      toast(`${who ? who + " " : ""}刚改过这 ${n} 条记录，已载入最新版本，请重新编辑`, true);
      await pullAll();
      return false;
    }
    REV = j.rev;
    SYNCED = snap;                 // 注意：用发送前的快照，避免把服务端的 _by 当成"又改了"
    lastSyncAt = Date.now();
    lastSyncErr = "";
    return true;
  } catch (e) {
    lastSyncErr = "网络断开，改动留在本页，联网后自动重发";
    return false;
  } finally {
    syncing = false;
    paintSaveInfo();
  }
}

/* 冲突后整库重拉：服务端版本为准，避免本地反复用旧 _v 重试 */
async function pullAll() {
  try {
    const r = await apiFetch("/api/changes?since=0");
    if (r.status === 401) { sessionLost(); return; }
    const j = await r.json().catch(() => null);
    if (!j || !j.data) return;
    state = migrate(j.data);
    REV = j.rev;
    SYNCED = snapshotOf(state);
    render();
  } catch (e) { /* 网络抖动：下次轮询再拉 */ }
}

function applyChanges(list) {
  let others = 0;
  const names = new Set();
  list.forEach(c => {
    if (!c || c.fullReplace) return;
    if (c.coll === "settings") {
      if (c.rec && !hasLocal()) state.settings = Object.assign({}, state.settings, c.rec);
      return;
    }
    const arr = state[c.coll];
    if (!arr) return;
    if (c.del) {
      const i = arr.findIndex(r => r.id === c.id);
      if (i >= 0) arr.splice(i, 1);
      return;
    }
    if (!c.rec) return;
    const i = arr.findIndex(r => r.id === c.id);
    if (i >= 0) arr[i] = c.rec; else arr.push(c.rec);
    if (c.rec._by && c.rec._by !== myName()) { others++; names.add(c.rec._by); }
  });
  return { others, names: [...names] };
}

/* 用户正在输入 / 正在填写弹窗时不要重绘，否则输入框会被清空 */
function softRender() {
  const ae = document.activeElement;
  const typing = ae && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA" || ae.tagName === "SELECT" || ae.isContentEditable);
  const modalOpen = $("#modal") && !$("#modal").classList.contains("hidden");
  if (typing || modalOpen || !canWrite()) { pendingRender = true; return; }
  render();
}

async function poll(force) {
  if (MODE !== "server" || !ME || !SYNCED) return;
  if (document.hidden && !force) return;
  if (hasLocal()) await flush();
  if (hasLocal()) return;                 // 本地还没存完，先别动远端数据
  try {
    const r = await apiFetch(`/api/changes?since=${REV}`);
    if (r.status === 401) { sessionLost(); return; }
    const j = await r.json().catch(() => null);
    if (!j) return;
    if (j.full) {
      state = migrate(j.data);
      REV = j.rev;
      SYNCED = snapshotOf(state);
      render();
      toast("数据已整体刷新");
      return;
    }
    if (j.rev) REV = j.rev;
    if (j.changes && j.changes.length) {
      const info = applyChanges(j.changes);
      SYNCED = snapshotOf(state);
      softRender();
      if (info.others) toast(`${info.names.join("、")} 刚更新了 ${info.others} 条记录`);
    }
  } catch (e) { /* 网络抖动：下次轮询再说 */ }
}

function startPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(() => poll(false), 6000);
}

/* ---------------------------- 界面上的写操作拦截 ---------------------------- */
/* 服务端会拒，但前端先拦一下，体验更好（也不会留下"看起来改了其实没存"的迷惑） */
const WRITE_ACTS = ["new", "edit", "del", "copy", "toggle", "convert", "weannow", "stock", "imp-do"];
const ADMIN_ACTS = ["clear", "rs", "snap", "snap-clear", "save-set", "u-create", "u-del", "u-role", "u-disable", "u-reset"];

document.addEventListener("click", e => {
  const b = e.target.closest && e.target.closest("button[data-act]");
  if (!b || MODE !== "server") return;
  const act = b.dataset.act;
  let msg = "";
  if (WRITE_ACTS.indexOf(act) >= 0 && !canWrite()) msg = "只读账号不能修改数据";
  else if (ADMIN_ACTS.indexOf(act) >= 0 && !isAdmin()) msg = "只有管理员能做这个操作";
  if (msg) {
    e.preventDefault();
    e.stopPropagation();
    toast(msg, true);
  }
}, true);

document.addEventListener("submit", e => {
  if (MODE !== "server" || e.target.id !== "mForm") return;
  if (canWrite()) return;
  e.preventDefault();
  e.stopPropagation();
  toast("只读账号不能修改数据", true);
}, true);

/* 输入框失焦后再补一次被推迟的重绘 */
document.addEventListener("focusout", () => {
  setTimeout(() => { if (pendingRender) { pendingRender = false; softRender(); } }, 250);
});
document.addEventListener("visibilitychange", () => { if (!document.hidden) poll(true); });
window.addEventListener("beforeunload", () => { if (MODE === "server" && hasLocal()) flush(true); });
window.addEventListener("online", () => { poll(true); });

/* ---------------------------- 账号管理（管理员） ---------------------------- */
let USERS = [], USER_ME = "";
const ACTION_TEXT = {
  login: "登录", "login-failed": "登录失败", logout: "退出", sync: "修改数据",
  "user-create": "新建账号", "user-update": "修改账号", "user-delete": "删除账号",
  password: "改密码", import: "全库恢复", export: "导出备份"
};
const fmtTime = t => {
  if (!t) return "—";
  const d = new Date(t);
  if (isNaN(d.getTime())) return "—";
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
};

function viewUsers() {
  $("#content").innerHTML = `
    <div class="panel">
      <h3>新建账号 <em>新账号第一次登录必须自己改密码</em></h3>
      <div class="body">
        <form id="newUserForm" class="toolbar" autocomplete="off">
          <input class="search" id="nu-user" placeholder="用户名（登录用，字母/数字）" required>
          <input class="search" id="nu-name" placeholder="姓名（显示用，可不填）">
          <input class="search" id="nu-pw" type="password" placeholder="初始密码（至少 6 位，需含大写 + 数字 + 符号）" required>
          <select id="nu-role">
            <option value="editor">实验员（录入 / 编辑 / 删除）</option>
            <option value="viewer">只读（只能看和导出）</option>
            <option value="admin">管理员（全部 + 账号管理）</option>
          </select>
          <button class="btn primary" type="submit">+ 创建</button>
        </form>
        <div class="hintbox">
          权限只有服务端说了算，前端隐藏按钮只是顺手：
          <b>管理员</b> 全部功能 + 账号管理 + 全库备份恢复 + 操作日志；
          <b>实验员</b> 录入 / 编辑 / 删除业务数据，不能改全局设置、不能管账号、不能恢复全库；
          <b>只读</b> 只能查看和导出 CSV。
        </div>
      </div>
    </div>
    <div class="panel">
      <h3>账号列表 <em id="uCount"></em></h3>
      <div class="body" id="userRows"><div class="muted">加载中…</div></div>
    </div>`;

  $("#newUserForm").onsubmit = async e => {
    e.preventDefault();
    const body = {
      username: $("#nu-user").value.trim(),
      name: $("#nu-name").value.trim(),
      password: $("#nu-pw").value,
      role: $("#nu-role").value
    };
    const r = await apiFetch("/api/users", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body)
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { toast(j.error || "创建失败", true); return; }
    toast(`已创建 ${body.username}，初始密码告诉本人，首次登录要改`);
    loadUsers();
  };
  loadUsers();
}

async function loadUsers() {
  const box = $("#userRows");
  if (!box) return;
  try {
    const r = await apiFetch("/api/users");
    if (!r.ok) { box.innerHTML = `<div class="muted">读取失败（HTTP ${r.status}）</div>`; return; }
    const j = await r.json();
    USERS = j.users || [];
    USER_ME = j.me;
    renderUsers(j.stats);
  } catch (e) {
    box.innerHTML = '<div class="muted">连不上服务器</div>';
  }
}

function renderUsers(stats) {
  const box = $("#userRows");
  if (!box) return;
  const cnt = $("#uCount");
  if (cnt) {
    const s = stats ? ` · 数据 rev ${stats.rev}，小鼠 ${stats.counts.mice} / 试剂 ${stats.counts.reagents} / 耗材 ${stats.counts.consumables} / 流水 ${stats.counts.logs}（${(stats.bytes / 1024).toFixed(1)} KB）` : "";
    cnt.textContent = `${USERS.length} 个账号${s}`;
  }
  box.innerHTML = `<div class="tablewrap"><table>
    <thead><tr><th>用户名</th><th>姓名</th><th>角色</th><th>状态</th><th>最近登录</th><th>操作</th></tr></thead>
    <tbody>${USERS.map(u => {
    const self = u.id === USER_ME;
    const roleSel = self
      ? `<span class="tag info">${esc(ROLE_TEXT[u.role] || u.role)}</span>`
      : `<select data-uid="${u.id}" data-act="u-role">
             ${["admin", "editor", "viewer"].map(r => `<option value="${r}"${u.role === r ? " selected" : ""}>${ROLE_TEXT[r]}</option>`).join("")}
           </select>`;
    return `<tr>
        <td><b>${esc(u.username)}</b>${self ? ' <span class="tag">我</span>' : ""}</td>
        <td>${esc(u.name || "")}</td>
        <td>${roleSel}</td>
        <td>${u.disabled ? '<span class="tag bad">已停用</span>' : '<span class="tag ok">正常</span>'}${u.mustChangePassword ? ' <span class="tag warn">待改初始密码</span>' : ""}</td>
        <td class="nowrap">${esc(fmtTime(u.lastLogin))}<div class="muted" style="font-size:11px">${esc(u.lastIp || "")}</div></td>
        <td class="nowrap">
          <button class="btn mini" data-act="u-reset" data-uid="${u.id}" data-name="${esc(u.username)}">重置密码</button>
          ${self ? "" : `<button class="btn mini" data-act="u-disable" data-uid="${u.id}" data-disabled="${u.disabled ? "1" : "0"}">${u.disabled ? "启用" : "停用"}</button>
          <button class="btn mini danger" data-act="u-del" data-uid="${u.id}" data-name="${esc(u.username)}">删</button>`}
        </td></tr>`;
  }).join("")}</tbody></table></div>`;

  box.onclick = async e => {
    const b = e.target.closest("button[data-act]");
    if (!b) return;
    const uid = b.dataset.uid;
    if (b.dataset.act === "u-reset") {
      const pw = prompt(`把 ${b.dataset.name} 的密码重置成什么？（至少 6 位，需含大写 + 数字 + 符号；对方下次登录会被要求改）`);
      if (!pw) return;
      await userPatch(uid, { password: pw, mustChange: true }, "密码已重置");
    }
    if (b.dataset.act === "u-disable") {
      const next = b.dataset.disabled === "1";
      if (!next && !confirm(`停用 ${uid} 后对方立刻下线，确定？`)) return;
      await userPatch(uid, { disabled: !next }, next ? "已启用" : "已停用");
    }
    if (b.dataset.act === "u-del") {
      if (!confirm("删除账号后不能恢复，该用户的历史操作记录会保留。确定删除？")) return;
      const r = await apiFetch("/api/users/" + uid, { method: "DELETE" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { toast(j.error || "删除失败", true); return; }
      toast("账号已删除");
      loadUsers();
    }
  };
  box.onchange = async e => {
    const sel = e.target.closest("select[data-act=u-role]");
    if (!sel) return;
    await userPatch(sel.dataset.uid, { role: sel.value }, "角色已修改");
  };
}

async function userPatch(uid, body, okMsg) {
  const r = await apiFetch("/api/users/" + uid, {
    method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body)
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { toast(j.error || "修改失败", true); loadUsers(); return; }
  toast(okMsg);
  loadUsers();
}

/* ---------------------------- 操作日志（管理员） ---------------------------- */
let AUDIT_LIMIT = 200, AUDIT_USER = "";

function viewAudit() {
  $("#content").innerHTML = `
    <div class="panel">
      <h3>操作日志 <em>只追加，普通用户改不了；改密码、登录、每条数据的写入都记</em></h3>
      <div class="body">
        <div class="toolbar">
          <input class="search" id="au-user" placeholder="按用户名筛选（可留空）" value="${esc(AUDIT_USER)}">
          <select id="au-limit">
            ${[50, 200, 500, 1000].map(n => `<option value="${n}"${AUDIT_LIMIT === n ? " selected" : ""}>最近 ${n} 条</option>`).join("")}
          </select>
          <button class="btn primary" id="au-refresh" type="button">刷新</button>
        </div>
        <div id="auRows"><div class="muted">加载中…</div></div>
      </div>
    </div>`;
  $("#au-refresh").onclick = () => {
    AUDIT_USER = $("#au-user").value.trim();
    AUDIT_LIMIT = Number($("#au-limit").value) || 200;
    loadAudit();
  };
  $("#au-limit").onchange = $("#au-refresh").onclick;
  loadAudit();
}

async function loadAudit() {
  const box = $("#auRows");
  if (!box) return;
  try {
    const q = new URLSearchParams({ limit: AUDIT_LIMIT });
    if (AUDIT_USER) q.set("user", AUDIT_USER);
    const r = await apiFetch("/api/audit?" + q.toString());
    if (!r.ok) { box.innerHTML = `<div class="muted">读取失败（HTTP ${r.status}）</div>`; return; }
    const j = await r.json();
    const list = j.entries || [];
    if (!list.length) { box.innerHTML = '<div class="empty">还没有日志</div>'; return; }
    box.innerHTML = `<div class="tablewrap" style="max-height:62vh"><table>
      <thead><tr><th>时间</th><th>账号</th><th>动作</th><th>详情</th><th>IP</th></tr></thead>
      <tbody>${list.map(e => `<tr>
        <td class="nowrap">${esc(fmtTime(e.t))}</td>
        <td><b>${esc(e.user || "—")}</b></td>
        <td><span class="tag ${e.action === "login-failed" ? "bad" : e.action === "sync" ? "info" : ""}">${esc(ACTION_TEXT[e.action] || e.action)}</span></td>
        <td class="wrap-cell">${esc(typeof e.detail === "string" ? e.detail : (e.detail ? JSON.stringify(e.detail) : ""))}${e.rev ? ` <span class="muted">rev ${e.rev}</span>` : ""}</td>
        <td class="nowrap muted">${esc(e.ip || "")}</td>
      </tr>`).join("")}</tbody></table></div>`;
  } catch (e) {
    box.innerHTML = '<div class="muted">连不上服务器</div>';
  }
}

/* ---------------------------- 启动探测 ---------------------------- */
async function bootRemote() {
  if (DEMO) return;
  if (location.protocol === "file:") return;      // 双击打开：就是离线版
  let r;
  try { r = await apiFetch("/api/me", { headers: { accept: "application/json" } }); }
  catch (e) { return; }                            // 打不开就按离线处理
  const ct = String(r.headers.get("content-type") || "");
  if (ct.indexOf("json") < 0) return;              // GitHub Pages 之类静态托管 → 离线版
  let j = null;
  try { j = await r.json(); } catch (e) { return; }
  if (!j || !j.server) return;
  MODE = "server";
  paintIdentity();
  if (r.status === 401) { showAuth({}); return; }
  if (j.user && j.user.mustChangePassword) {
    ME = j.user; MY_PERMS = j.perms; if (j.csrf) CSRF = j.csrf;
    showAuth({ forceChange: true });
    return;
  }
  await enterApp();
}
