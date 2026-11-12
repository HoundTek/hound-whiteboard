#!/usr/bin/env node

/**
 * @file 文件头路径检查
 * @description 扫描各包根目录下所有 .js 文件，验证 @module 路径与实际文件路径一致。
 * @module scripts/ci/check-module-paths
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.HOUND_BUILD_ROOT || path.resolve(__dirname, "../..");

let checked = 0;
let mismatched = 0;
const errors = [];

/**
 * 校验根目录：目录名即 @module 路径的基准。
 * @type {Array<{ dir: string, prefix: string }>}
 */
const ROOTS = [
  { dir: path.join(ROOT, "src", "kernel"), prefix: "kernel/" },
  { dir: path.join(ROOT, "src", "renderers"), prefix: "" },
  { dir: path.join(ROOT, "src", "host"), prefix: "host/" },
  { dir: path.join(ROOT, "src", "io"), prefix: "io/" },
  { dir: path.join(ROOT, "src", "cli"), prefix: "cli/" },
  { dir: path.join(ROOT, "src", "ui"), prefix: "ui/" },
  { dir: path.join(ROOT, "src", "demo"), prefix: "demo/" },
  { dir: path.join(ROOT, "src", "utils"), prefix: "utils/" },
  { dir: path.join(ROOT, "src", "test-support"), prefix: "test-support/" },
];

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

for (const { dir, prefix } of ROOTS) {
  if (!fs.existsSync(dir)) continue;
  const jsFiles = collectJsFiles(dir);

  for (const file of jsFiles) {
    const content = fs.readFileSync(file, "utf-8");
    const match = content.match(/@module\s+(\S+)/);
    if (!match) continue;

    checked++;
    const modulePath = match[1];

    // 计算实际路径（相对于根目录，去掉 .js 后缀）
    const relPath = path.relative(dir, file);
    const actualPath = relPath.replace(/\\/g, "/").replace(/\.js$/, "");

    // 规范化：module 路径可能以根前缀开头
    const normalizedModule =
      prefix && modulePath.startsWith(prefix)
        ? modulePath.slice(prefix.length)
        : modulePath;

    if (normalizedModule !== actualPath) {
      mismatched++;
      errors.push(
        `${path.relative(ROOT, file)}\n    module: ${modulePath}\n    actual: ${prefix}${actualPath}`,
      );
    }
  }
}

if (mismatched > 0) {
  console.error(
    `\n✗ 文件头路径检查失败 — ${mismatched}/${checked} 个文件的 @module 与实际路径不符:\n`,
  );
  for (const err of errors) {
    console.error(`  ${err}\n`);
  }
  process.exit(1);
} else {
  console.log(
    `✓ 文件头路径检查通过 — ${checked} 个文件的 @module 与实际路径一致`,
  );
}
