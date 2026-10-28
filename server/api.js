"use strict";
/* ==========================================================================
 * HTTP API（零依赖）
 *
 * 约定：
 *   - 所有写操作要求 Content-Type: application/json（挡住跨站表单提交）
 *   - 权限在服务端强制校验，前端隐藏按钮只是顺手
 *   - 首次登录（mustChangePassword）只允许 /api/me、/api/password、/api/logout
 * ========================================================================== */
const { PERM, ROLES, ROLE_LABEL } = require("./auth");

const COOKIE = "sm_sid";
const MAX_BODY = 2 * 1024 * 1024;
const MAX_IMPORT = 16 * 1024 * 1024;

function json(res, code, obj, extraHeaders) {
  const body = JSON.stringify(obj);
  res.writeHead(code, Object.assign({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  }, extraHeaders || {}));
  res.end(body);
}

function parseCookies(req) {
  const raw = req.headers.cookie || "";
  const out = {};
  raw.split(";").forEach(p => {
    const i = p.indexOf("=");
    if (i < 0) return;
    out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", c => {
      size += c.length;
      if (size > limit) {
        reject(Object.assign(new Error("请求体过大"), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      const s = Buffer.concat(chunks).toString("utf8");
      if (!s) return resolve({});
      try { resolve(JSON.parse(s)); } catch (e) { reject(Object.assign(new Error("JSON 格式错误"), { status: 400 })); }
    });
    req.on("error", reject);
  });
}

function createApi(ctx) {
  const { store, auth, version } = ctx;

  const can = (user, perm) => !!user && (PERM[perm] || []).indexOf(user.role) >= 0;
  const permsOf = user => ({
    readData: can(user, "readData"),
    writeData: can(user, "writeData"),
    writeSettings: can(user, "writeSettings"),
    manageUsers: can(user, "manageUsers"),
    viewAudit: can(user, "viewAudit"),
    backup: can(user, "backup")
  });

  function clientIp(req) {
    const xff = req.headers["x-forwarded-for"];
    const peer = req.socket.remoteAddress || "";
    const loop = peer === "::1" || peer === "127.0.0.1" || peer.startsWith("::ffff:127.");
    if (xff && loop) return String(xff).split(",")[0].trim();
    return peer.replace(/^::ffff:/, "");
  }

  function isHttps(req) {
    if (req.socket.encrypted) return true;
    const p = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim();
    return p === "https";
  }

  function sessionCookie(req, token, maxAgeSec) {
    const bits = [`${COOKIE}=${token}`, "Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${maxAgeSec}`];
    if (isHttps(req)) bits.push("Secure");
    return bits.join("; ");
  }

  function userOf(req) {
    const token = parseCookies(req)[COOKIE];
    if (!token) return null;
    return auth.session(token) || null;
  }

  const SAFE_GET = ["/api/me", "/api/password", "/api/logout", "/api/health"];

  return async function handle(req, res, url, opts) {
    const pathname = url.pathname;
    if (!pathname.startsWith("/api/")) return false;
    const ip = clientIp(req);
    const method = req.method.toUpperCase();

    try {
      if (pathname === "/api/health") {
        json(res, 200, { ok: true, server: true, version, rev: store.rev, time: Date.now() });
        return true;
      }

      if (pathname === "/api/me" && method === "GET") {
        const user = userOf(req);
        if (!user) { json(res, 401, { server: true, login: true, error: "未登录" }); return true; }
        json(res, 200, {
          server: true, version, rev: store.rev,
          user: auth.publicUser(user), perms: permsOf(user)
        });
        return true;
      }

      if (pathname === "/api/login" && method === "POST") {
        const body = await readBody(req, MAX_BODY);
        const r = auth.login(body.username, body.password, ip);
        if (!r.ok) {
          store.audit({ user: String(body.username || "").slice(0, 40), ip, action: "login-failed", detail: r.error });
          json(res, r.code === "locked" ? 429 : 401, { error: r.error, code: r.code });
          return true;
        }
        const token = auth.createSession(r.user, ip);
        store.audit({ user: r.user.username, ip, action: "login", detail: ROLE_LABEL[r.user.role] });
        res.setHeader("Set-Cookie", sessionCookie(req, token, 7 * 86400));
        json(res, 200, {
          server: true, version, rev: store.rev,
          user: auth.publicUser(r.user), perms: permsOf(r.user)
        });
        return true;
      }

      if (pathname === "/api/logout" && method === "POST") {
        const user = userOf(req);
        const token = parseCookies(req)[COOKIE];
        auth.destroySession(token);
        if (user) store.audit({ user: user.username, ip, action: "logout" });
        json(res, 200, { ok: true }, { "Set-Cookie": sessionCookie(req, "", 0) });
        return true;
      }

      /* ---------- 以下都要登录 ---------- */
      const user = userOf(req);
      if (!user) { json(res, 401, { error: "未登录或登录已过期", login: true }); return true; }

      if (user.mustChangePassword && SAFE_GET.indexOf(pathname) < 0) {
        json(res, 403, { error: "首次登录请先修改密码", mustChangePassword: true });
        return true;
      }

      if (pathname === "/api/password" && method === "POST") {
        const body = await readBody(req, MAX_BODY);
        const r = auth.changePassword(user.id, body.old, body.new);
        if (!r.ok) { json(res, 400, { error: r.error }); return true; }
        store.audit({ user: user.username, ip, action: "password" });
        // 自己改密码会清掉所有会话，这里重新发一个，避免刚改完就被踢
        const token = auth.createSession(user, ip);
        res.setHeader("Set-Cookie", sessionCookie(req, token, 7 * 86400));
        json(res, 200, { ok: true });
        return true;
      }

      if (["POST", "PATCH", "PUT"].indexOf(method) >= 0 &&
        !String(req.headers["content-type"] || "").includes("application/json")) {
        json(res, 415, { error: "请求格式必须是 application/json" });
        return true;
      }

      if (pathname === "/api/bootstrap" && method === "GET") {
        if (!can(user, "readData")) { json(res, 403, { error: "没有读取权限" }); return true; }
        const snap = store.snapshot();
        json(res, 200, {
          rev: snap.rev, data: snap.data,
          user: auth.publicUser(user), perms: permsOf(user), version
        });
        return true;
      }

      if (pathname === "/api/changes" && method === "GET") {
        if (!can(user, "readData")) { json(res, 403, { error: "没有读取权限" }); return true; }
        json(res, 200, store.changesSince(url.searchParams.get("since")));
        return true;
      }

      if (pathname === "/api/sync" && method === "POST") {
        if (!can(user, "writeData")) { json(res, 403, { error: "当前账号是只读，不能修改数据" }); return true; }
        const body = await readBody(req, MAX_BODY);
        const patch = (body && body.patch && typeof body.patch === "object") ? body.patch : {};
        const summary = {};
        ["mice", "breeding", "reagents", "consumables", "logs"].forEach(c => {
          const p = patch[c];
          if (!p) return;
          const n = (Array.isArray(p.up) ? p.up.length : 0) + (Array.isArray(p.del) ? p.del.length : 0);
          if (n) summary[c] = n;
        });
        if (patch.settings) summary.settings = 1;
        const r = store.applyPatch(user, patch, { allowSettings: can(user, "writeSettings") });
        if (r.touched) {
          store.audit({ user: user.username, ip, action: "sync", detail: summary, rev: r.rev });
        }
        json(res, 200, { rev: r.rev, applied: r.touched, changes: r.changes });
        return true;
      }

      /* ---------- 用户管理（仅管理员） ---------- */
      if (pathname === "/api/users") {
        if (!can(user, "manageUsers")) { json(res, 403, { error: "只有管理员能管理账号" }); return true; }
        if (method === "GET") {
          json(res, 200, { users: auth.list(), me: user.id, stats: store.stats() });
          return true;
        }
        if (method === "POST") {
          const body = await readBody(req, MAX_BODY);
          const r = auth.createUser(body);
          if (!r.ok) { json(res, 400, { error: r.error }); return true; }
          store.audit({ user: user.username, ip, action: "user-create", detail: `${r.user.username}（${ROLE_LABEL[r.user.role]}）` });
          json(res, 200, { user: r.user });
          return true;
        }
      }

      const um = pathname.match(/^\/api\/users\/([a-zA-Z0-9]+)$/);
      if (um) {
        if (!can(user, "manageUsers")) { json(res, 403, { error: "只有管理员能管理账号" }); return true; }
        const id = um[1];
        const target = auth.findById(id);
        if (!target) { json(res, 404, { error: "用户不存在" }); return true; }
        if (method === "PATCH") {
          const body = await readBody(req, MAX_BODY);
          if (id === user.id && body.role && body.role !== "admin") {
            json(res, 400, { error: "不能把自己的角色改成非管理员" });
            return true;
          }
          const r = auth.updateUser(id, body);
          if (!r.ok) { json(res, 400, { error: r.error }); return true; }
          store.audit({
            user: user.username, ip, action: "user-update",
            detail: `${r.user.username} role=${r.user.role} disabled=${r.user.disabled}`
          });
          json(res, 200, { user: r.user });
          return true;
        }
        if (method === "DELETE") {
          if (id === user.id) { json(res, 400, { error: "不能删除自己" }); return true; }
          const r = auth.deleteUser(id);
          if (!r.ok) { json(res, 400, { error: r.error }); return true; }
          store.audit({ user: user.username, ip, action: "user-delete", detail: target.username });
          json(res, 200, { ok: true });
          return true;
        }
      }

      if (pathname === "/api/audit" && method === "GET") {
        if (!can(user, "viewAudit")) { json(res, 403, { error: "只有管理员能看操作日志" }); return true; }
        const limit = Math.min(1000, Math.max(1, Number(url.searchParams.get("limit")) || 200));
        json(res, 200, { entries: store.readAudit(limit, url.searchParams.get("user") || "") });
        return true;
      }

      if (pathname === "/api/export" && method === "GET") {
        if (!can(user, "backup")) { json(res, 403, { error: "只有管理员能导出全库备份" }); return true; }
        const snap = store.snapshot();
        store.audit({ user: user.username, ip, action: "export", rev: snap.rev });
        const stamp = new Date().toLocaleDateString("sv-SE").replace(/-/g, "");
        json(res, 200, snap.data, {
          "Content-Disposition": `attachment; filename="labmgmt-backup-${stamp}.json"`
        });
        return true;
      }

      if (pathname === "/api/import" && method === "POST") {
        if (!can(user, "backup")) { json(res, 403, { error: "只有管理员能恢复全库" }); return true; }
        const body = await readBody(req, MAX_IMPORT);
        const data = body && body.data ? body.data : body;
        const looksOk = data && typeof data === "object" &&
          (Array.isArray(data.mice) || Array.isArray(data.reagents) || Array.isArray(data.consumables) || Array.isArray(data.breeding));
        if (!looksOk) { json(res, 400, { error: "不是本工具的备份文件" }); return true; }
        const rev = store.replaceAll(data, user);
        store.audit({
          user: user.username, ip, action: "import", rev,
          detail: `小鼠 ${(data.mice || []).length} / 试剂 ${(data.reagents || []).length} / 耗材 ${(data.consumables || []).length}`
        });
        json(res, 200, { ok: true, rev });
        return true;
      }

      json(res, 404, { error: "没有这个接口：" + pathname });
      return true;
    } catch (e) {
      const code = e.status || 500;
      if (code >= 500) console.error("[api] " + pathname + " → " + (e.stack || e.message));
      if (!res.headersSent) json(res, code, { error: e.message || "服务器内部错误" });
      return true;
    }
  };
}

module.exports = { createApi, COOKIE };
