#!/usr/bin/env node

/**
 * @file 文档链接检查
 * @description 扫描根目录、src、dev、.agent 下的 .md 文件，验证相对链接的目标文件与锚点是否存在。
 * @module scripts/ci/check-doc-links
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.HOUND_BUILD_ROOT || path.resolve(__dirname, "../..");

/**
 * 需要检查的目录；`recursive: false` 只取该目录直属的 .md（根目录的 README / AGENTS 等）。
 * @type {Array<{ dir: string, recursive: boolean }>}
 */
const SCAN_DIRS = [
  { dir: ROOT, recursive: false },
  { dir: path.join(ROOT, "src"), recursive: true },
  { dir: path.join(ROOT, "dev"), recursive: true },
  { dir: path.join(ROOT, ".agent"), recursive: true },
];

let total = 0;
let totalAnchors = 0;
let missing = 0;
let badAnchor = 0;
const errors = [];

/**
 * 递归收集 .md 文件
 * @param {string} dir - 目录
 * @param {boolean} recursive - 是否递归子目录
 * @returns {string[]} 文件的绝对路径
 */
function collectMdFiles(dir, recursive) {
  const files = [];
  if (!fs.existsSync(dir)) return files;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (recursive) files.push(...collectMdFiles(full, recursive));
    } else if (entry.name.endsWith(".md")) {
      files.push(full);
    }
  }
  return files;
}

/**
 * 把标题文本转成 GitHub 风格的锚点
 * @param {string} heading - 标题原文（不含前导 #）
 * @returns {string} 锚点
 */
function slugify(heading) {
  return heading
    .replace(/`([^`]*)`/g, "$1")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_~]/g, "")
    .replace(/<[^>]+>/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s+/g, "-");
}

/**
 * 收集文件的全部标题锚点
 * @param {string} file - 文件绝对路径
 * @returns {Set<string>} 锚点集合
 */
function collectAnchors(file) {
  const anchors = new Set();
  for (const line of fs.readFileSync(file, "utf-8").split("\n")) {
    const match = /^#{1,6}\s+(.*)$/.exec(line);
    if (match) anchors.add(slugify(match[1].replace(/\s+#+\s*$/, "")));
  }
  return anchors;
}

/**
 * 提取 markdown 链接
 * @param {string} content - 文件内容
 * @returns {Array<{ url: string, anchor: string }>} 文件部分与锚点部分
 */
function extractLinks(content) {
  const links = [];
  const regex = /\[([^\]]*)\]\(([^)]+)\)/g;
  let match;
  while ((match = regex.exec(content)) !== null) {
    const url = match[2].trim();
    if (url.startsWith("http://") || url.startsWith("https://")) continue;
    const [filePart, anchor = ""] = url.split("#");
    // 纯锚点是同文件引用；其余只检查 .md 相对链接
    if (filePart === "") {
      if (anchor) links.push({ url: "", anchor });
      continue;
    }
    if (!filePart.endsWith(".md")) continue;
    links.push({ url: filePart, anchor });
  }
  return links;
}

/**
 * 缓存已解析的锚点集合，避免重复读取
 * @type {Map<string, Set<string>>}
 */
const anchorCache = new Map();

/**
 * 取文件锚点集合（带缓存）
 * @param {string} file - 文件绝对路径
 * @returns {Set<string>} 锚点集合
 */
function getAnchors(file) {
  if (!anchorCache.has(file)) anchorCache.set(file, collectAnchors(file));
  return anchorCache.get(file);
}

const mdFiles = SCAN_DIRS.flatMap(({ dir, recursive }) =>
  collectMdFiles(dir, recursive),
);

for (const file of mdFiles) {
  const content = fs.readFileSync(file, "utf-8");
  const links = extractLinks(content);
  const dir = path.dirname(file);

  for (const { url, anchor } of links) {
    total++;
    const target = url === "" ? file : path.resolve(dir, url);
    if (!fs.existsSync(target)) {
      missing++;
      errors.push(
        `${path.relative(ROOT, file)} → ${url} (missing: ${path.relative(ROOT, target)})`,
      );
      continue;
    }
    if (!anchor) continue;
    totalAnchors++;
    if (!getAnchors(target).has(decodeURIComponent(anchor).toLowerCase())) {
      badAnchor++;
      errors.push(
        `${path.relative(ROOT, file)} → ${url}#${anchor} (missing anchor in ${path.relative(ROOT, target)})`,
      );
    }
  }
}

if (missing > 0 || badAnchor > 0) {
  console.error(
    `\n✗ 文档链接检查失败 — ${missing} 条断链、${badAnchor} 条锚点无效（共 ${total} 条链接，${totalAnchors} 条带锚点）:\n`,
  );
  for (const err of errors) {
    console.error(`  ${err}`);
  }
  console.error("");
  process.exit(1);
} else {
  console.log(
    `✓ 文档链接检查通过 — ${mdFiles.length} 个文件、${total} 条链接（含 ${totalAnchors} 条锚点）全部有效`,
  );
}
