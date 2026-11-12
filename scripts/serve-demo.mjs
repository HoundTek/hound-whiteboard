#!/usr/bin/env node
/**
 * demo 静态服务：零依赖把 src/ 目录作为静态站点服务，供浏览器双开验证（无 Tauri 环境时自动降级内存板）。
 * 用法：node scripts/serve-demo.mjs [端口]（默认 8000，或环境变量 HWB_DEMO_PORT；HWB_DEMO_ROOT 换服务根目录，HWB_DEMO_ENTRY 换默认入口）
 */

import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SERVE_ROOT = process.env.HWB_DEMO_ROOT ?? "src";
const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  SERVE_ROOT,
);
const ENTRY = process.env.HWB_DEMO_ENTRY ?? "/demo/whiteboard.html";
const port = Number(process.argv[2] ?? process.env.HWB_DEMO_PORT ?? 8000);

/** 扩展名到 MIME 的映射 */
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", "http://localhost");
    let urlPath = decodeURIComponent(url.pathname);
    if (urlPath === "/") urlPath = ENTRY;
    const abs = path.resolve(ROOT, "." + urlPath);
    if (abs !== ROOT && !abs.startsWith(ROOT + path.sep)) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }
    const info = await stat(abs);
    if (!info.isFile()) {
      res.writeHead(404);
      res.end("Not Found");
      return;
    }
    const ext = path.extname(abs).toLowerCase();
    res.writeHead(200, { "Content-Type": MIME[ext] ?? "application/octet-stream" });
    res.end(await readFile(abs));
  } catch {
    res.writeHead(404);
    res.end("Not Found");
  }
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(
      `端口 ${port} 已被占用，可能有一个旧的 serve-demo 进程还在跑。` +
        `先结束它再重试：lsof -tnP -iTCP:${port} -sTCP:LISTEN | xargs kill`,
    );
    process.exit(1);
  }
  throw error;
});

server.listen(port, () => {
  console.log(`静态服务根目录：${ROOT}`);
  console.log(`入口：http://127.0.0.1:${port}${ENTRY}`);
  if (ENTRY.startsWith("/demo/whiteboard.html")) {
    console.log("浏览器双开验证：开两个标签页，地址加参数，如");
    console.log(`http://127.0.0.1:${port}${ENTRY}?relay=ws://127.0.0.1:8377&source=A`);
    console.log(`http://127.0.0.1:${port}${ENTRY}?relay=ws://127.0.0.1:8377&source=B`);
  }
});
