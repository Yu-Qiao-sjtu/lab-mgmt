#!/usr/bin/env node
/* ==========================================================================
 * 把 src/ 下的片段拼成单文件 index.html
 *
 *   node build.js          生成 index.html
 *   node build.js --check  只校验：index.html 是否与 src/ 一致（CI 用）
 *
 * src/head.html  = <!doctype html> ... </head>（含全部样式）
 * src/body.html  = <body> ... <script>
 * src/s1..s6.js  = 应用逻辑，按顺序拼接
 * ========================================================================== */
const fs = require("fs");
const path = require("path");

const SRC = path.join(__dirname, "src");
const OUT = path.join(__dirname, "index.html");
const PARTS = ["head.html", "body.html", "s1.js", "remote.js", "s2.js", "s3.js", "s4.js", "s5.js", "s6.js"];

const read = f => fs.readFileSync(path.join(SRC, f), "utf8").replace(/\r\n/g, "\n");

function build() {
  const missing = PARTS.filter(f => !fs.existsSync(path.join(SRC, f)));
  if (missing.length) throw new Error("缺少片段：" + missing.join(", "));
  const html = PARTS.map(read).join("\n") + "\n</script>\n</body>\n</html>\n";

  /* ---- 自检 1：内联脚本能被 JS 引擎解析 ---- */
  const m = html.match(/<script>([\s\S]*)<\/script>/);
  if (!m) throw new Error("找不到 <script>…</script> 块");
  new Function(m[1]);

  /* ---- 自检 2：标签配对 ---- */
  ["html", "head", "body", "style", "script"].forEach(t => {
    const open = (html.match(new RegExp("<" + t + "[ >]", "g")) || []).length;
    const close = (html.match(new RegExp("</" + t + ">", "g")) || []).length;
    if (open !== close) throw new Error(`<${t}> 标签不配对：${open} 开 / ${close} 闭`);
  });

  /* ---- 自检 3：不允许出现联网请求（离线承诺） ---- */
  const remote = html.match(/(src|href)\s*=\s*["']https?:\/\//g);
  if (remote) throw new Error("单文件版不能引用外部资源：" + remote.join(", "));

  return { html, lines: m[1].split("\n").length };
}

const { html, lines } = build();
const kb = (Buffer.byteLength(html, "utf8") / 1024).toFixed(1);

if (process.argv.includes("--check")) {
  const old = fs.existsSync(OUT) ? fs.readFileSync(OUT, "utf8").replace(/\r\n/g, "\n") : "";
  if (old !== html) {
    console.error("index.html 与 src/ 不一致：请运行 node build.js 后一起提交。");
    process.exit(1);
  }
  console.log(`index.html 与 src/ 一致（${kb} KB，脚本 ${lines} 行）`);
  process.exit(0);
}

fs.writeFileSync(OUT, html, "utf8");
console.log(`index.html 已生成：${kb} KB，脚本 ${lines} 行，语法/标签/离线检查通过`);
