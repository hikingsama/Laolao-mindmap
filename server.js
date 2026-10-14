#!/usr/bin/env node
/* =========================================================================
 * server.js —— 本地静态服务器（零依赖，只用 Node 内置模块）
 *
 * 启动：node server.js        （或在仓库根目录 npm start）
 * 地址：http://127.0.0.1:8788  ← README 里写死的固定端口，不随参数变化
 * 端口可以用环境变量 MM_PORT 覆盖，但 README 和验收一律用 8788。
 * ========================================================================= */
"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");
const ai = require("./js/ai-server.cjs");

const PORT = Number(process.env.MM_PORT || 8788);
const HOST = "127.0.0.1";
const ROOT = __dirname;

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
  ".map": "application/json; charset=utf-8",
};

const server = http.createServer((req, res) => {
  if (req.url.startsWith("/api/ai/")) return ai.handle(req, res, PORT);
  let rel;
  try { rel = decodeURIComponent(new URL(req.url, "http://x").pathname); } catch (e) { rel = "/"; }
  // Only public assets are served; server modules and local configuration stay private.
  if (rel.split(/[\\/]/).some(part => part.startsWith(".")) || /\.(?:cjs|local)$/i.test(rel) || rel === "/server.js" || rel.startsWith("/tools/")) {
    res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" }); return res.end("403 非公开文件");
  }
  // 禁止浏览器读取 .env、.git 等以点开头的私有文件或目录
  if (rel.split(/[\\/]/).some(part => part.startsWith("."))) {
  res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
  return res.end("403 禁止访问私有文件");
  }
  if (rel === "/" || rel.endsWith("/")) rel += "index.html";

  // 防目录穿越：解析后必须仍在本仓库目录里
  const file = path.resolve(ROOT, "." + rel);
  if (file !== ROOT && !file.startsWith(ROOT + path.sep)) {
    res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    return res.end("403 越界");
  }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end("404 没有这个文件：" + rel);
    }
    res.writeHead(200, {
      "Content-Type": TYPES[path.extname(file).toLowerCase()] || "application/octet-stream",
      "Content-Length": st.size,
      "Cache-Control": "no-store",
    });
    fs.createReadStream(file).pipe(res);
  });
});

server.listen(PORT, HOST, () => {
  console.log("捞捞思维导图（独立版）已启动 → http://" + HOST + ":" + PORT);
  console.log("按 Ctrl+C 停止");


});
