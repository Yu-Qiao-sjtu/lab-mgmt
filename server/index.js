#!/usr/bin/env node
"use strict";
/* ==========================================================================
 * 实验室管理台 · 多用户服务器（零依赖）
 *
 *   node server/index.js                 启动（默认端口 8787）
 *   node server/index.js --port 9000     换端口
 *   node server/index.js --reset-admin   忘记管理员密码时重置成随机密码
 *
 * 环境变量：
 *   PORT            端口（默认 8787）
 *   HOST            监听地址（默认 0.0.0.0，同一 WiFi 都能访问）
 *   DATA_DIR        数据目录（默认 ./data）
 *   ADMIN_PASSWORD  首次启动时管理员的初始密码（不设则随机生成并打印）
 * ========================================================================== */
const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");

const { Store } = require("./store");
const { Auth } = require("./auth");
const { createApi } = require("./api");

const ROOT = path.resolve(__dirname, "..");
const INDEX_FILE = path.join(ROOT, "index.html");
const VERSION = (() => {
  try { return require(path.join(ROOT, "package.json")).version || "0.0.0"; } catch (e) { return "0.0.0"; }
})();

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const PORT = Number(process.env.PORT || arg("--port", 8787));
const HOST = process.env.HOST || "0.0.0.0";
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT, "data"));

/* ---------- 单文件前端的读取缓存（改完 index.html 不用重启） ---------- */
let cache = { mtime: 0, body: null };
function frontHTML() {
  const st = fs.statSync(INDEX_FILE);
  if (cache.mtime !== st.mtimeMs) {
    cache = { mtime: st.mtimeMs, body: fs.readFileSync(INDEX_FILE) };
  }
  return cache.body;
}

function lanAddresses() {
  const out = [];
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const a of ifaces[name] || []) {
      if (a.family === "IPv4" && !a.internal) out.push({ name, address: a.address });
    }
  }
  return out;
}

/* ---------- 启动 ---------- */
fs.mkdirSync(DATA_DIR, { recursive: true });
const store = new Store(DATA_DIR);
const auth = new Auth(DATA_DIR, { adminPassword: process.env.ADMIN_PASSWORD || "" });

/* 启动时清理超过保留期的回收站记录（软删除的墓碑） */
try {
  const pruned = store.pruneTombstones();
  if (pruned) console.log(`[store] 回收站已清理 ${pruned} 条超期记录`);
} catch (e) {
  console.error("[store] 回收站清理失败：" + e.message);
}

if (process.argv.includes("--reset-admin")) {
  const admin = auth.users.find(u => u.role === "admin");
  if (!admin) { console.error("没有管理员账号，直接删掉 data/users.json 重新启动即可。"); process.exit(1); }
  const pw = require("crypto").randomBytes(6).toString("base64url");
  auth.updateUser(admin.id, { password: pw, mustChange: true });
  console.log(`管理员 ${admin.username} 的密码已重置为：${pw}（登录后必须马上改）`);
  process.exit(0);
}

if (!fs.existsSync(INDEX_FILE)) {
  console.error("找不到 index.html：先在项目根目录运行 node build.js");
  process.exit(1);
}

const api = createApi({ store, auth, version: VERSION });

const server = http.createServer(async (req, res) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Referrer-Policy", "no-referrer");
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  if (await api(req, res, url)) return;

  try {
    if (url.pathname === "/" || url.pathname === "/index.html") {
      const body = frontHTML();
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-cache",
        "Content-Length": body.length
      });
      res.end(req.method === "HEAD" ? undefined : body);
      return;
    }
    if (url.pathname === "/health") {
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: true, rev: store.rev, users: auth.users.length }));
      return;
    }
    if (url.pathname === "/favicon.ico") {
      res.writeHead(204).end();
      return;
    }
    // 其他路径一律 404：不暴露 server/、data/ 里的任何文件
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("404 页面不存在。请访问 / 使用管理台。");
  } catch (e) {
    console.error("[http] " + e.message);
    if (!res.headersSent) { res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" }); }
    res.end("服务器内部错误");
  }
});

server.on("error", e => {
  if (e.code === "EADDRINUSE") {
    console.error(`端口 ${PORT} 已被占用：可能管理台已经在运行，或者换一个端口 --port 8788`);
  } else {
    console.error("[server] " + e.message);
  }
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  const lines = [];
  lines.push("");
  lines.push("  实验室管理台 · 多用户服务器 v" + VERSION);
  lines.push("  " + "-".repeat(52));
  lines.push(`  本机访问：   http://localhost:${PORT}`);
  lanAddresses().forEach(a => {
    lines.push(`  局域网访问： http://${a.address}:${PORT}   (${a.name})`);
  });
  lines.push(`  数据目录：   ${DATA_DIR}`);
  lines.push(`  账号数量：   ${auth.users.length}`);
  lines.push("  " + "-".repeat(52));
  if (auth.seedGenerated) {
    lines.push("  首次启动，已创建管理员账号（请立即登录并改密码）：");
    lines.push("     用户名：admin");
    lines.push("     密  码：" + auth.seedPassword);
    lines.push("  这个密码只显示这一次。忘了就运行 --reset-admin 重置。");
    lines.push("  " + "-".repeat(52));
  }
  lines.push("  停止服务：Ctrl+C        外网访问：见 docs/DEPLOY.md");
  lines.push("");
  console.log(lines.join("\n"));
});

/* 定期落盘会话 + 关闭时收尾 */
const sessionTimer = setInterval(() => {
  try { auth.flush(); } catch (e) { console.error("[auth] 会话落盘失败：" + e.message); }
}, 30000);

function shutdown(sig) {
  console.log(`\n收到 ${sig}，正在关闭…`);
  clearInterval(sessionTimer);
  try { auth.flush(); } catch (e) { /* ignore */ }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000);
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("uncaughtException", e => console.error("[fatal] " + (e.stack || e.message)));
