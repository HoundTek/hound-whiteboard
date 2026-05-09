/**
 * @fileoverview ZIP Runtime - ZIP压缩文件操作封装
 * @module safe-io/runtime/zip
 *
 * @description
 * 提供ZIP压缩/解压能力，纯runtime层无安全逻辑。
 * 所有错误都会被捕获并返回安全值。
 *
 * @author safe-io Team
 * @version 3.0
 */

import AdmZip from "adm-zip";
import fs from "fs";
import path from "path";

/**
 * @fileoverview Pure ZIP runtime layer
 *
 * @description
 * 设计原则：
 * - 不做权限判断
 * - 不接 entry / DSL
 * - 不理解 handle
 * - 只处理 resolved path
 * - 所有错误吞掉并返回安全值
 */

const safe = (fn, fallback) => {
  try {
    return fn();
  } catch (e) {
    console.error("[zip runtime error]", e);
    return fallback;
  }
};

const ensureDir = (p) => {
  const dir = path.dirname(p);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
};

/**
 * @namespace Zip
 * @description ZIP压缩操作命名空间
 */
export const Zip = {

  /**
   * 从文件夹创建ZIP压缩包
   * @param {string} sourcePath - 源文件夹路径
   * @param {string} outputZipPath - 输出ZIP文件路径
   * @returns {boolean} 是否成功
   */
  fromFolder: (sourcePath, outputZipPath) => {
    return safe(() => {
      const zip = new AdmZip();

      const stat = fs.statSync(sourcePath);

      if (stat.isDirectory()) {
        zip.addLocalFolder(sourcePath);
      } else {
        zip.addLocalFile(sourcePath);
      }

      ensureDir(outputZipPath);
      zip.writeZip(outputZipPath);

      return true;
    }, false);
  },

  /**
   * 解压ZIP到目标文件夹
   * @param {string} zipPath - ZIP文件路径
   * @param {string} targetDir - 目标目录路径
   * @returns {boolean} 是否成功
   */
  extractTo: (zipPath, targetDir) => {
    return safe(() => {
      if (!fs.existsSync(zipPath)) return false;

      const zip = new AdmZip(zipPath);

      ensureDir(targetDir);

      zip.extractAllTo(targetDir, true);

      return true;
    }, false);
  },

  /**
   * 列出ZIP包内的条目
   * @param {string} zipPath - ZIP文件路径
   * @returns {Array<{name: string, size: number, compressedSize: number, isDirectory: boolean}>} 条目列表
   */
  list: (zipPath) => {
    return safe(() => {
      if (!fs.existsSync(zipPath)) return [];

      const zip = new AdmZip(zipPath);

      return zip.getEntries().map(e => ({
        name: e.entryName,
        size: e.header.size,
        compressedSize: e.header.compressedSize,
        isDirectory: e.isDirectory,
      }));
    }, []);
  },

  /**
   * 向现有ZIP包添加文件
   * @param {string} zipPath - ZIP文件路径
   * @param {string} filePath - 要添加的文件路径
   * @param {string} [entryName] - 条目名称（默认为文件名）
   * @returns {boolean} 是否成功
   */
  addFile: (zipPath, filePath, entryName = null) => {
    return safe(() => {
      if (!fs.existsSync(zipPath)) return false;
      if (!fs.existsSync(filePath)) return false;

      const zip = new AdmZip(zipPath);

      const name = entryName || path.basename(filePath);

      zip.addLocalFile(filePath, "", name);

      zip.writeZip(zipPath);

      return true;
    }, false);
  },

  /**
   * 创建空ZIP包
   * @param {string} zipPath - 要创建的ZIP文件路径
   * @returns {boolean} 是否成功
   */
  createEmpty: (zipPath) => {
    return safe(() => {
      const zip = new AdmZip();

      ensureDir(zipPath);

      zip.writeZip(zipPath);

      return true;
    }, false);
  },
};