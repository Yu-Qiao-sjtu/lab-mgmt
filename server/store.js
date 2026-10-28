"use strict";
/* ==========================================================================
 * 服务端数据层（零依赖）
 *
 *  - data/db.json      业务数据 + 修订号 + 最近变更（原子写入：先写 .tmp 再 rename）
 *  - data/backups/     每天第一份写入时留一份全量备份，保留 30 天
 *  - data/audit.jsonl  审计日志（谁、什么时候、改了哪几条），只追加
 *
 * 多人并发的处理原则：
 *   1. 每条记录独立更新（按 id 合并），不是整库覆盖；
 *   2. 每条记录带 _v 版本号（每次写入 +1）与 _by / _at 来源信息；
 *      客户端回传的 _v 与服务端不一致 → 判为冲突，拒绝覆盖并回给前端，
 *      不再静默 last-write-wins（参考 MuriArc 的 revision 校验）；
 *   3. 删除是软删除：打 deletedAt / deletedBy 保留墓碑，管理员可恢复；
 *      墓碑超过 TOMBSTONE_DAYS 天由 pruneTombstones() 物理清理；
 *   4. 客户端断线很久后回来，变更日志已过期 → 自动整体刷新。
 * ========================================================================== */
const fs = require("fs");
const path = require("path");

const COLLS = ["mice", "breeding", "reagents", "consumables", "logs"];
const MAX_CHANGES = 4000;
const MAX_BACKUPS = 30;
const AUDIT_ROTATE_BYTES = 5 * 1024 * 1024;
const TOMBSTONE_DAYS = 90;   // 软删除记录的保留期，超期物理清理

function blankData() {
  return {
    mice: [], breeding: [], reagents: [], consumables: [], logs: [],
    settings: {
      expWarn: 30, gestDays: 20, weanDays: 21, cardLayout: "6", snapshots: 7,
      usageDays: 90, reorderDays: 30, theme: "auto"
    },
    meta: { v: 3, updated: null, createdAt: null }
  };
}

const clone = o => JSON.parse(JSON.stringify(o));
const dayStamp = d => d.toLocaleDateString("sv-SE").replace(/-/g, "");
const live = r => !!r && !r.deletedAt;   // 未软删除的“活”记录

/* 只把活记录交出去；墓碑留在库里给管理员恢复 */
function liveData(data) {
  const out = clone(data);
  COLLS.forEach(c => { if (Array.isArray(out[c])) out[c] = out[c].filter(live); });
  return out;
}

/* 只保留普通字段：挡掉原型污染和超大字段 */
function sanitize(value, depth = 0) {
  if (depth > 4) return null;
  if (value === null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return value.length > 4000 ? value.slice(0, 4000) : value;
  if (Array.isArray(value)) return value.slice(0, 500).map(v => sanitize(v, depth + 1));
  if (typeof value === "object") {
    const out = {};
    for (const k of Object.keys(value)) {
      if (k === "__proto__" || k === "constructor" || k === "prototype") continue;
      if (k.length > 64) continue;
      const v = sanitize(value[k], depth + 1);
      if (v !== null || value[k] === null) out[k] = v;
    }
    return out;
  }
  return null;
}

function writeJSONAtomic(file, obj) {
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(obj), { encoding: "utf8", mode: 0o600 });
  fs.renameSync(tmp, file);
}

class Store {
  constructor(dir) {
    this.dir = dir;
    this.file = path.join(dir, "db.json");
    this.backupDir = path.join(dir, "backups");
    this.auditFile = path.join(dir, "audit.jsonl");
    fs.mkdirSync(this.backupDir, { recursive: true });
    this.db = this._read();
    this._lastBackup = null;
  }

  _read() {
    let db = null;
    try {
      if (fs.existsSync(this.file)) db = JSON.parse(fs.readFileSync(this.file, "utf8"));
    } catch (e) {
      // 坏了也不能把老数据直接丢掉：改名留证，然后从空库启动
      const bad = this.file + ".broken-" + Date.now();
      try { fs.renameSync(this.file, bad); } catch (_) { /* ignore */ }
      console.error(`[store] db.json 解析失败，已备份为 ${path.basename(bad)}：${e.message}`);
    }
    const base = blankData();
    const out = {
      version: 1,
      rev: 0,
      data: base,
      changes: [],
      savedAt: null
    };
    if (db && typeof db === "object") {
      out.rev = Number(db.rev) || 0;
      out.changes = Array.isArray(db.changes) ? db.changes.slice(-MAX_CHANGES) : [];
      const d = db.data || {};
      COLLS.forEach(c => { if (Array.isArray(d[c])) out.data[c] = d[c]; });
      if (d.settings && typeof d.settings === "object") {
        out.data.settings = Object.assign(base.settings, d.settings);
      }
      if (d.meta && typeof d.meta === "object") out.data.meta = Object.assign(base.meta, d.meta);
      if (!out.data.meta.createdAt) out.data.meta.createdAt = new Date().toISOString();
    } else {
      out.data.meta.createdAt = new Date().toISOString();
    }
    return out;
  }

  get rev() { return this.db.rev; }
  snapshot() { return { rev: this.db.rev, data: liveData(this.db.data) }; }

  /* 每日备份：当天还没备过就备一份，并清理超过 30 天的 */
  _dailyBackup() {
    const stamp = dayStamp(new Date());
    if (this._lastBackup === stamp) return;
    this._lastBackup = stamp;
    const target = path.join(this.backupDir, `db-${stamp}.json`);
    try {
      if (!fs.existsSync(target)) writeJSONAtomic(target, this.db);
      const files = fs.readdirSync(this.backupDir)
        .filter(f => /^db-\d{8}\.json$/.test(f)).sort();
      while (files.length > MAX_BACKUPS) {
        const f = files.shift();
        try { fs.unlinkSync(path.join(this.backupDir, f)); } catch (_) { /* ignore */ }
      }
    } catch (e) {
      console.error("[store] 每日备份失败：" + e.message);
    }
  }

  _persist() {
    this.db.savedAt = new Date().toISOString();
    try {
      writeJSONAtomic(this.file, this.db);
      this._dailyBackup();
    } catch (e) {
      console.error("[store] 写入失败：" + e.message);
      throw e;
    }
  }

  _bump(changes) {
    const rev = ++this.db.rev;
    const at = Date.now();
    changes.forEach(c => { c.rev = rev; c.at = at; });
    this.db.changes.push(...changes);
    if (this.db.changes.length > MAX_CHANGES) {
      this.db.changes = this.db.changes.slice(-MAX_CHANGES);
    }
    this.db.data.meta.updated = at;
    this._persist();
    return rev;
  }

  /* 应用客户端补丁：{mice:{up:[rec],del:[id]}, ...} */
  applyPatch(user, patch, opts) {
    const allowSettings = !!(opts && opts.allowSettings);
    const changes = [];
    const conflicts = [];
    let touched = 0;

    for (const coll of COLLS) {
      const p = patch[coll];
      if (!p || typeof p !== "object") continue;
      const arr = this.db.data[coll];

      const idx = new Map();
      arr.forEach((r, i) => { if (r && r.id) idx.set(r.id, i); });

      // 先删（软删除：保留墓碑，可恢复），再写，避免下标错位
      const dels = Array.isArray(p.del) ? p.del.slice(0, 2000) : [];
      dels.forEach(id => {
        if (typeof id !== "string") return;
        const i = idx.get(id);
        if (i === undefined) return;
        const rec = arr[i];
        if (rec.deletedAt) return;                       // 已是墓碑，幂等
        rec.deletedAt = Date.now();
        rec.deletedBy = user.name || user.username;
        rec._v = (Number(rec._v) || 0) + 1;
        rec._by = rec.deletedBy;
        rec._at = rec.deletedAt;
        changes.push({ coll, id, del: true });
        touched++;
      });

      const ups = Array.isArray(p.up) ? p.up.slice(0, 2000) : [];
      ups.forEach(raw => {
        if (!raw || typeof raw !== "object") return;
        const rec = sanitize(raw);
        if (!rec || typeof rec.id !== "string" || !rec.id) return;
        const i = idx.get(rec.id);
        const cur = i === undefined ? null : arr[i];
        const hasV = Number.isFinite(Number(rec._v)) && rec._v !== null && rec._v !== "";
        const clientV = hasV ? Number(rec._v) : null;
        const serverV = cur ? (Number(cur._v) || 0) : 0;
        // 乐观锁：客户端基于旧版本改 → 拒绝覆盖，交给前端提示刷新
        if (cur && clientV !== null && clientV !== serverV) {
          conflicts.push({
            coll, id: rec.id, serverV, clientV,
            by: cur._by || "", at: cur._at || null, deleted: !!cur.deletedAt
          });
          return;
        }
        rec._v = serverV + 1;
        rec._by = user.name || user.username;
        rec._at = Date.now();
        delete rec.deletedAt;
        delete rec.deletedBy;
        if (cur) {
          arr[i] = rec;
        } else {
          arr.push(rec);
          idx.set(rec.id, arr.length - 1);
        }
        changes.push({ coll, id: rec.id, rec });
        touched++;
      });
    }

    if (allowSettings && patch.settings && typeof patch.settings === "object") {
      const s = sanitize(patch.settings);
      this.db.data.settings = Object.assign({}, this.db.data.settings, s);
      this.db.data.settings.theme = this.db.data.settings.theme || "auto";
      changes.push({ coll: "settings", id: "settings", rec: clone(this.db.data.settings) });
      touched++;
    }

    if (!touched) return { rev: this.db.rev, changes: [], conflicts, touched: 0 };
    const rev = this._bump(changes);
    return { rev, changes, conflicts, touched };
  }

  changesSince(since) {
    const s = Number(since) || 0;
    if (s >= this.db.rev) return { rev: this.db.rev, changes: [] };
    const oldest = this.db.changes.length ? this.db.changes[0].rev : this.db.rev + 1;
    if (s < oldest - 1) return { full: true, rev: this.db.rev, data: liveData(this.db.data) };
    return { rev: this.db.rev, changes: this.db.changes.filter(c => c.rev > s) };
  }

  replaceAll(data, user) {
    const base = blankData();
    const next = blankData();
    COLLS.forEach(c => {
      if (Array.isArray(data[c])) next[c] = data[c].map(r => sanitize(r)).filter(r => r && r.id);
    });
    next.settings = Object.assign(base.settings, sanitize(data.settings || {}) || {});
    next.meta = Object.assign(base.meta, { createdAt: (data.meta && data.meta.createdAt) || new Date().toISOString() });
    this.db.data = next;
    const changes = COLLS.map(c => ({ coll: c, id: "*", fullReplace: true }));
    return this._bump(changes);
  }

  audit(entry) {
    const line = JSON.stringify(Object.assign({ t: new Date().toISOString() }, entry)) + "\n";
    try {
      const st = fs.existsSync(this.auditFile) ? fs.statSync(this.auditFile) : null;
      if (st && st.size > AUDIT_ROTATE_BYTES) {
        fs.renameSync(this.auditFile, this.auditFile + "." + Date.now());
      }
      fs.appendFileSync(this.auditFile, line, { encoding: "utf8", mode: 0o600 });
    } catch (e) {
      console.error("[store] 审计日志写入失败：" + e.message);
    }
  }

  readAudit(limit = 200, userFilter = "") {
    let text = "";
    try { text = fs.readFileSync(this.auditFile, "utf8"); } catch (e) { return []; }
    const lines = text.split("\n").filter(Boolean);
    const out = [];
    for (let i = lines.length - 1; i >= 0 && out.length < limit; i--) {
      try {
        const o = JSON.parse(lines[i]);
        if (userFilter && String(o.user || "").indexOf(userFilter) < 0) continue;
        out.push(o);
      } catch (e) { /* 跳过坏行 */ }
    }
    return out;
  }

  stats() {
    const d = this.db.data;
    const n = c => (Array.isArray(d[c]) ? d[c].filter(live).length : 0);
    const trash = c => (Array.isArray(d[c]) ? d[c].filter(r => r && r.deletedAt).length : 0);
    return {
      rev: this.db.rev,
      counts: {
        mice: n("mice"), breeding: n("breeding"), reagents: n("reagents"),
        consumables: n("consumables"), logs: n("logs")
      },
      deleted: {
        mice: trash("mice"), breeding: trash("breeding"), reagents: trash("reagents"),
        consumables: trash("consumables"), logs: trash("logs")
      },
      bytes: Buffer.byteLength(JSON.stringify(d), "utf8"),
      savedAt: this.db.savedAt
    };
  }

  /* ---------- 回收站：软删除记录的查看 / 恢复 / 彻底删除 ---------- */
  listTombstones(limit = 200) {
    const out = [];
    for (const coll of COLLS) {
      const arr = this.db.data[coll];
      if (!Array.isArray(arr)) continue;
      arr.filter(r => r && r.deletedAt).forEach(r => {
        out.push({ coll, record: clone(r) });
      });
    }
    out.sort((a, b) => (b.record.deletedAt || 0) - (a.record.deletedAt || 0));
    return out.slice(0, limit);
  }

  /* 恢复：清掉墓碑标记，版本号 +1，重新广播一条 up 变更 */
  restore(user, coll, ids) {
    if (COLLS.indexOf(coll) < 0) return { ok: false, error: "集合不存在" };
    const arr = this.db.data[coll];
    const want = new Set((Array.isArray(ids) ? ids : []).filter(id => typeof id === "string"));
    const changes = [];
    const at = Date.now();
    const who = user.name || user.username;
    arr.forEach(r => {
      if (!r || !r.deletedAt || !want.has(r.id)) return;
      delete r.deletedAt;
      delete r.deletedBy;
      r._v = (Number(r._v) || 0) + 1;
      r._by = who;
      r._at = at;
      changes.push({ coll, id: r.id, rec: clone(r) });
    });
    if (!changes.length) return { ok: true, restored: 0, rev: this.db.rev, changes: [] };
    const rev = this._bump(changes);
    return { ok: true, restored: changes.length, rev, changes };
  }

  /* 彻底删除：物理移除，不可恢复（仅管理员） */
  purge(user, coll, ids) {
    if (COLLS.indexOf(coll) < 0) return { ok: false, error: "集合不存在" };
    const want = new Set((Array.isArray(ids) ? ids : []).filter(id => typeof id === "string"));
    const before = this.db.data[coll].length;
    this.db.data[coll] = this.db.data[coll].filter(r => !(r && r.deletedAt && want.has(r.id)));
    const removed = before - this.db.data[coll].length;
    if (!removed) return { ok: true, purged: 0, rev: this.db.rev };
    const rev = this._bump([{ coll, id: "*", purged: removed }]);
    return { ok: true, purged: removed, rev };
  }

  /* 墓碑保留期清理：超过 TOMBSTONE_DAYS 天物理删除 */
  pruneTombstones(days = TOMBSTONE_DAYS) {
    const cut = Date.now() - days * 86400000;
    let removed = 0;
    for (const coll of COLLS) {
      const arr = this.db.data[coll];
      if (!Array.isArray(arr)) continue;
      const keep = arr.filter(r => !(r && r.deletedAt && r.deletedAt < cut));
      removed += arr.length - keep.length;
      this.db.data[coll] = keep;
    }
    if (removed) this._persist();
    return removed;
  }
}

module.exports = { Store, COLLS, blankData };
