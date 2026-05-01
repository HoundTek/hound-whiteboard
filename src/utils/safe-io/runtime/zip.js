import AdmZip from "adm-zip";
import fs from "fs";
import path from "path";

/**
 * runtime/zip.js
 * ----------------
 * 纯 ZIP runtime 层
 *
 * 设计原则：
 * - 不做权限判断
 * - 不接 entry / DSL
 * - 不理解 handle
 * - 只处理 resolved path
 * - 所有错误吞掉并返回安全值
 */

// ==============================
// 🧰 internal helpers
// ==============================

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

// ==============================
// 📦 ZIP API
// ==============================

export const Zip = {

  // ------------------------------
  // 📥 create zip from folder
  // ------------------------------
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

  // ------------------------------
  // 📤 extract zip to folder
  // ------------------------------
  extractTo: (zipPath, targetDir) => {
    return safe(() => {
      if (!fs.existsSync(zipPath)) return false;

      const zip = new AdmZip(zipPath);

      ensureDir(targetDir);

      zip.extractAllTo(targetDir, true);

      return true;
    }, false);
  },

  // ------------------------------
  // 📄 list zip entries
  // ------------------------------
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

  // ------------------------------
  // ➕ add file into existing zip
  // ------------------------------
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

  // ------------------------------
  // 🧪 create empty zip
  // ------------------------------
  createEmpty: (zipPath) => {
    return safe(() => {
      const zip = new AdmZip();

      ensureDir(zipPath);

      zip.writeZip(zipPath);

      return true;
    }, false);
  },
};