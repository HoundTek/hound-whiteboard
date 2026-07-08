#!/usr/bin/env node

/**
 * @file 文档链接检查
 * @description 扫描 src/core 下所有 .md 文件，验证相对链接目标是否存在。
 * @module scripts/check-doc-links
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const CORE_DIR = path.join(ROOT, "src", "core");

let total = 0;
let missing = 0;
const errors = [];

/**
 * 递归收集所有 .md 文件
 * @param {string} dir
 * @returns {string[]}
 */
function collectMdFiles(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectMdFiles(full));
    } else if (entry.name.endsWith(".md")) {
      files.push(full);
    }
  }
  return files;
}

/**
 * 提取 markdown 链接中的相对路径
 * @param {string} content
 * @returns {string[]}
 */
function extractLinks(content) {
  const links = [];
  const regex = /\[([^\]]*)\]\(([^)]+)\)/g;
  let match;
  while ((match = regex.exec(content)) !== null) {
    const url = match[2].trim();
    // 只检查 .md 相对链接
    if (url.endsWith(".md") && !url.startsWith("http://") && !url.startsWith("https://")) {
      links.push(url);
    }
  }
  return links;
}

const mdFiles = collectMdFiles(CORE_DIR);

for (const file of mdFiles) {
  const content = fs.readFileSync(file, "utf-8");
  const links = extractLinks(content);
  const dir = path.dirname(file);

  for (const link of links) {
    total++;
    const resolved = path.resolve(dir, link);
    if (!fs.existsSync(resolved)) {
      missing++;
      errors.push(`${path.relative(ROOT, file)} → ${link} (missing: ${path.relative(ROOT, resolved)})`);
    }
  }
}

if (missing > 0) {
  console.error(`\n✗ 文档链接断链检查失败 — ${missing}/${total} 条链接目标不存在:\n`);
  for (const err of errors) {
    console.error(`  ${err}`);
  }
  console.error("");
  process.exit(1);
} else {
  console.log(`✓ 文档链接检查通过 — ${total} 条链接全部有效`);
}
