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
 *   2. 同一条记录两人同时改 → 后写入的生效（last-write-wins），
 *      但每条记录都打上 _by / _at，审计里能查到最后是谁改的；
 *   3. 客户端断线很久后回来，变更日志已过期 → 自动整体刷新。
 * ========================================================================== */
const fs = require("fs");
const path = require("path");

const COLLS = ["mice", "breeding", "reagents", "consumables", "logs"];
const MAX_CHANGES = 4000;
const MAX_BACKUPS = 30;
const AUDIT_ROTATE_BYTES = 5 * 1024 * 1024;

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
  snapshot() { return { rev: this.db.rev, data: clone(this.db.data) }; }

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
    let touched = 0;

    for (const coll of COLLS) {
      const p = patch[coll];
      if (!p || typeof p !== "object") continue;
      const arr = this.db.data[coll];

      // 先删，再写，避免下标错位
      const dels = Array.isArray(p.del) ? p.del.slice(0, 2000) : [];
      dels.forEach(id => {
        if (typeof id !== "string") return;
        const i = arr.findIndex(r => r && r.id === id);
        if (i >= 0) {
          arr.splice(i, 1);
          changes.push({ coll, id, del: true });
          touched++;
        }
      });

      const ups = Array.isArray(p.up) ? p.up.slice(0, 2000) : [];
      const idx = new Map();
      arr.forEach((r, i) => { if (r && r.id) idx.set(r.id, i); });
      ups.forEach(raw => {
        if (!raw || typeof raw !== "object") return;
        const rec = sanitize(raw);
        if (!rec || typeof rec.id !== "string" || !rec.id) return;
        rec._by = user.name || user.username;
        rec._at = Date.now();
        const i = idx.get(rec.id);
        if (i === undefined) {
          arr.push(rec);
          idx.set(rec.id, arr.length - 1);
        } else {
          arr[i] = rec;
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

    if (!touched) return { rev: this.db.rev, changes: [], touched: 0 };
    const rev = this._bump(changes);
    return { rev, changes, touched };
  }

  changesSince(since) {
    const s = Number(since) || 0;
    if (s >= this.db.rev) return { rev: this.db.rev, changes: [] };
    const oldest = this.db.changes.length ? this.db.changes[0].rev : this.db.rev + 1;
    if (s < oldest - 1) return { full: true, rev: this.db.rev, data: clone(this.db.data) };
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
    return {
      rev: this.db.rev,
      counts: {
        mice: d.mice.length, breeding: d.breeding.length, reagents: d.reagents.length,
        consumables: d.consumables.length, logs: d.logs.length
      },
      bytes: Buffer.byteLength(JSON.stringify(d), "utf8"),
      savedAt: this.db.savedAt
    };
  }
}

module.exports = { Store, COLLS, blankData };
