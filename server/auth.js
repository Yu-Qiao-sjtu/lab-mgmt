"use strict";
/* ==========================================================================
 * 账号 / 密码 / 会话（零依赖，只用 node:crypto）
 *
 *  - 密码用 scrypt + 每用户随机盐，存 "scrypt$salt$hash"，不存明文
 *  - 会话用随机 token，磁盘里只存 token 的 sha256，泄露文件也拿不到有效 token
 *  - 登录失败限速：同一 IP+用户名 6 次失败锁 5 分钟
 *  - users.json / sessions.json 与业务数据分开存：导出的业务数据不含密码哈希
 * ========================================================================== */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROLES = ["admin", "editor", "viewer"];
const ROLE_LABEL = { admin: "管理员", editor: "实验员", viewer: "只读" };
const PERM = {
  readData: ["admin", "editor", "viewer"],
  writeData: ["admin", "editor"],
  writeSettings: ["admin"],
  manageUsers: ["admin"],
  viewAudit: ["admin"],
  backup: ["admin"]
};
const SESSION_DAYS = 7;
const MAX_FAILS = 6;
const LOCK_MS = 5 * 60 * 1000;
const MIN_PASSWORD = 8;

function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(String(pw), salt, 64).toString("hex");
  return `scrypt$${salt}$${hash}`;
}

function verifyPassword(pw, stored) {
  const parts = String(stored || "").split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const [, salt, hash] = parts;
  let want;
  try { want = Buffer.from(hash, "hex"); } catch (e) { return false; }
  let got;
  try { got = crypto.scryptSync(String(pw), salt, 64); } catch (e) { return false; }
  return want.length === got.length && crypto.timingSafeEqual(want, got);
}

const sha256 = s => crypto.createHash("sha256").update(String(s)).digest("hex");
const newId = () => crypto.randomBytes(8).toString("hex");
const writeJSONAtomic = (file, obj) => {
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(obj), { encoding: "utf8", mode: 0o600 });
  fs.renameSync(tmp, file);
};

function passwordProblem(pw, username) {
  const s = String(pw || "");
  if (s.length < MIN_PASSWORD) return `密码至少 ${MIN_PASSWORD} 位`;
  if (s.length > 200) return "密码太长";
  if (username && s.toLowerCase() === String(username).toLowerCase()) return "密码不能和用户名相同";
  if (/^(12345678|password|admin123|11111111|00000000)$/i.test(s)) return "这个密码太常见，换一个";
  return "";
}

class Auth {
  constructor(dir, opts) {
    this.dir = dir;
    this.usersFile = path.join(dir, "users.json");
    this.sessionsFile = path.join(dir, "sessions.json");
    this.forcePassword = (opts && opts.adminPassword) || "";
    this.users = [];
    this.sessions = {};
    this.fails = new Map();   // "ip|user" -> {n, until}
    this._dirty = false;
    this._load();
    this._seed();
  }

  _load() {
    try {
      if (fs.existsSync(this.usersFile)) {
        const u = JSON.parse(fs.readFileSync(this.usersFile, "utf8"));
        if (Array.isArray(u)) this.users = u;
      }
    } catch (e) { console.error("[auth] users.json 读取失败：" + e.message); }
    try {
      if (fs.existsSync(this.sessionsFile)) {
        const s = JSON.parse(fs.readFileSync(this.sessionsFile, "utf8"));
        if (s && typeof s === "object") this.sessions = s;
      }
    } catch (e) { console.error("[auth] sessions.json 读取失败：" + e.message); }
    this._pruneSessions();
  }

  _saveUsers() {
    writeJSONAtomic(this.usersFile, this.users);
  }

  _saveSessions() {
    writeJSONAtomic(this.sessionsFile, this.sessions);
    this._dirty = false;
  }

  _pruneSessions() {
    const now = Date.now();
    let removed = 0;
    for (const k of Object.keys(this.sessions)) {
      if (!this.sessions[k] || this.sessions[k].exp < now) { delete this.sessions[k]; removed++; }
    }
    if (removed) this._dirty = true;
  }

  /* 第一次启动：建一个管理员，密码来自环境变量，否则随机生成并打印一次 */
  _seed() {
    if (this.users.length) return;
    const username = "admin";
    const pw = this.forcePassword || crypto.randomBytes(6).toString("base64url");
    this.users.push({
      id: newId(),
      username,
      name: "管理员",
      role: "admin",
      saltHash: hashPassword(pw),
      mustChangePassword: !this.forcePassword,
      disabled: false,
      createdAt: new Date().toISOString(),
      lastLogin: null,
      lastIp: null
    });
    this._saveUsers();
    this.seedPassword = pw;
    this.seedGenerated = !this.forcePassword;
  }

  publicUser(u) {
    if (!u) return null;
    return {
      id: u.id, username: u.username, name: u.name || u.username, role: u.role,
      disabled: !!u.disabled, mustChangePassword: !!u.mustChangePassword,
      createdAt: u.createdAt, lastLogin: u.lastLogin, lastIp: u.lastIp
    };
  }

  findByName(username) {
    const n = String(username || "").trim().toLowerCase();
    return this.users.find(u => u.username.toLowerCase() === n) || null;
  }

  findById(id) { return this.users.find(u => u.id === id) || null; }

  list() { return this.users.map(u => this.publicUser(u)); }

  adminCount() { return this.users.filter(u => u.role === "admin" && !u.disabled).length; }

  _lockKey(ip, username) { return `${ip}|${String(username || "").toLowerCase()}`; }

  checkLock(ip, username) {
    const rec = this.fails.get(this._lockKey(ip, username));
    if (!rec) return 0;
    if (rec.until && rec.until > Date.now()) return Math.ceil((rec.until - Date.now()) / 1000);
    return 0;
  }

  _noteFail(ip, username) {
    const key = this._lockKey(ip, username);
    const rec = this.fails.get(key) || { n: 0, until: 0 };
    rec.n += 1;
    if (rec.n >= MAX_FAILS) { rec.until = Date.now() + LOCK_MS; rec.n = 0; }
    this.fails.set(key, rec);
    if (this.fails.size > 5000) this.fails.clear();
  }

  _clearFail(ip, username) { this.fails.delete(this._lockKey(ip, username)); }

  login(username, password, ip) {
    const wait = this.checkLock(ip, username);
    if (wait) return { ok: false, error: `尝试次数过多，请 ${wait} 秒后再试`, code: "locked" };
    const u = this.findByName(username);
    if (!u || !verifyPassword(password, u.saltHash)) {
      this._noteFail(ip, username);
      return { ok: false, error: "用户名或密码不对", code: "bad_credentials" };
    }
    if (u.disabled) return { ok: false, error: "这个账号已被管理员停用", code: "disabled" };
    this._clearFail(ip, username);
    u.lastLogin = new Date().toISOString();
    u.lastIp = ip;
    this._saveUsers();
    return { ok: true, user: u };
  }

  createSession(user, ip) {
    const token = crypto.randomBytes(32).toString("base64url");
    const now = Date.now();
    this.sessions[sha256(token)] = { uid: user.id, exp: now + SESSION_DAYS * 86400000, ip, at: now };
    this._pruneSessions();
    this._saveSessions();
    return token;
  }

  /* 每次请求调用：返回 user 或 null；顺带续期 */
  session(token) {
    if (!token) return null;
    const key = sha256(token);
    const s = this.sessions[key];
    if (!s) return null;
    if (s.exp < Date.now()) { delete this.sessions[key]; this._dirty = true; return null; }
    const u = this.findById(s.uid);
    if (!u || u.disabled) { delete this.sessions[key]; this._dirty = true; return null; }
    // 剩余不足一半就续期，避免每个请求都写盘
    if (s.exp - Date.now() < SESSION_DAYS * 86400000 / 2) {
      s.exp = Date.now() + SESSION_DAYS * 86400000;
      this._dirty = true;
    }
    return u;
  }

  destroySession(token) {
    if (!token) return;
    const key = sha256(token);
    if (this.sessions[key]) { delete this.sessions[key]; this._saveSessions(); }
  }

  destroyUserSessions(userId) {
    let hit = false;
    for (const k of Object.keys(this.sessions)) {
      if (this.sessions[k].uid === userId) { delete this.sessions[k]; hit = true; }
    }
    if (hit) this._saveSessions();
  }

  flush() { if (this._dirty) this._saveSessions(); }

  changePassword(userId, oldPassword, newPassword, opts) {
    const u = this.findById(userId);
    if (!u) return { ok: false, error: "用户不存在" };
    const byAdmin = !!(opts && opts.byAdmin);
    if (!byAdmin && !verifyPassword(oldPassword, u.saltHash)) return { ok: false, error: "原密码不对" };
    const bad = passwordProblem(newPassword, u.username);
    if (bad) return { ok: false, error: bad };
    u.saltHash = hashPassword(newPassword);
    u.mustChangePassword = false;
    u.passwordChangedAt = new Date().toISOString();
    this._saveUsers();
    if (!byAdmin) this.destroyUserSessions(u.id); // 改密码后其他设备要重新登录
    return { ok: true };
  }

  createUser({ username, name, password, role }) {
    const un = String(username || "").trim();
    if (!/^[A-Za-z0-9_.-]{2,20}$/.test(un)) return { ok: false, error: "用户名 2-20 位，只能是字母/数字/下划线/点/短横线" };
    if (this.findByName(un)) return { ok: false, error: "用户名已存在" };
    if (ROLES.indexOf(role) < 0) return { ok: false, error: "角色不对" };
    const bad = passwordProblem(password, un);
    if (bad) return { ok: false, error: bad };
    const u = {
      id: newId(), username: un, name: String(name || "").trim() || un, role,
      saltHash: hashPassword(password), mustChangePassword: true,
      disabled: false, createdAt: new Date().toISOString(), lastLogin: null, lastIp: null
    };
    this.users.push(u);
    this._saveUsers();
    return { ok: true, user: this.publicUser(u) };
  }

  updateUser(id, patch) {
    const u = this.findById(id);
    if (!u) return { ok: false, error: "用户不存在" };
    if (patch.role !== undefined) {
      if (ROLES.indexOf(patch.role) < 0) return { ok: false, error: "角色不对" };
      if (u.role === "admin" && patch.role !== "admin" && this.adminCount() <= 1) {
        return { ok: false, error: "至少要保留一个管理员" };
      }
      u.role = patch.role;
    }
    if (patch.name !== undefined) u.name = String(patch.name).trim().slice(0, 40) || u.username;
    if (patch.disabled !== undefined) {
      const dis = !!patch.disabled;
      if (dis && u.role === "admin" && this.adminCount() <= 1) return { ok: false, error: "至少要保留一个管理员" };
      if (dis && u.id === id && !dis) { /* 自己停用自己：允许，但会被踢下线 */ }
      u.disabled = dis;
      if (dis) this.destroyUserSessions(u.id);
    }
    if (patch.password !== undefined) {
      const bad = passwordProblem(patch.password, u.username);
      if (bad) return { ok: false, error: bad };
      u.saltHash = hashPassword(patch.password);
      u.mustChangePassword = !!patch.mustChange;
      this.destroyUserSessions(u.id);
    }
    this._saveUsers();
    return { ok: true, user: this.publicUser(u) };
  }

  deleteUser(id) {
    const u = this.findById(id);
    if (!u) return { ok: false, error: "用户不存在" };
    if (u.role === "admin" && this.adminCount() <= 1) return { ok: false, error: "至少要保留一个管理员" };
    this.users = this.users.filter(x => x.id !== id);
    this._saveUsers();
    this.destroyUserSessions(id);
    return { ok: true };
  }
}

module.exports = { Auth, PERM, ROLES, ROLE_LABEL, hashPassword, verifyPassword };
