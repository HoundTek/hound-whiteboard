#!/usr/bin/env node

/**
 * @file 文件头路径检查
 * @description 扫描 src/core 下所有 .js 文件，验证 @module 路径与实际文件路径一致。
 * @module scripts/check-module-paths
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const CORE_DIR = path.join(ROOT, "src", "core");

let checked = 0;
let mismatched = 0;
const errors = [];

/**
 * 递归收集所有 .js 文件（排除 node_modules）
 * @param {string} dir
 * @returns {string[]}
 */
function collectJsFiles(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== "node_modules") {
      files.push(...collectJsFiles(full));
    } else if (entry.name.endsWith(".js") && !entry.name.endsWith(".test.js")) {
      files.push(full);
    }
  }
  return files;
}

const jsFiles = collectJsFiles(CORE_DIR);

for (const file of jsFiles) {
  const content = fs.readFileSync(file, "utf-8");
  const match = content.match(/@module\s+(\S+)/);
  if (!match) continue;

  checked++;
  const modulePath = match[1];

  // 计算实际路径（相对于 src/core，去掉 .js 后缀）
  const relPath = path.relative(CORE_DIR, file);
  const actualPath = relPath.replace(/\.js$/, "");

  // 规范化：module 路径可能以 core/ 开头
  const normalizedModule = modulePath.startsWith("core/")
    ? modulePath.slice(5)
    : modulePath;

  if (normalizedModule !== actualPath) {
    mismatched++;
    errors.push(
      `${path.relative(ROOT, file)}\n    module: ${modulePath}\n    actual: core/${actualPath}`
    );
  }
}

if (mismatched > 0) {
  console.error(`\n✗ 文件头路径检查失败 — ${mismatched}/${checked} 个文件的 @module 与实际路径不符:\n`);
  for (const err of errors) {
    console.error(`  ${err}\n`);
  }
  process.exit(1);
} else {
  console.log(`✓ 文件头路径检查通过 — ${checked} 个文件的 @module 与实际路径一致`);
}
