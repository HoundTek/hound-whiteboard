import fs from "fs";
import path from "path";
import { Hide } from "./hide.js";

// ==============================
// 🧠 INTERNAL HELPERS
// ==============================

/**
 * 防止 ../ 路径穿越
 */
const safeResolve = (p) => {
  if (typeof p !== "string") return null;

  const normalized = path.normalize(p);

  // 禁止路径穿越
  if (normalized.includes("..")) return null;

  return normalized;
};

/**
 * 确保目录存在
 */
const ensureDir = (p) => {
  const dir = path.dirname(p);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
};

/**
 * safe wrapper
 */
const safe = (fn, fallback = null, label = "FS") => {
  try {
    return fn();
  } catch (e) {
    console.error(`[${label}]`, e);
    return fallback;
  }
};

// ==============================
// 📁 SAFE FS CORE LAYER
// ==============================

export const FS = {

  // ============================
  // 📖 READ
  // ============================
  read: (p, encoding = "utf8") =>
    safe(() => {
      const sp = safeResolve(p);
      if (!sp) return null;

      if (!fs.existsSync(sp)) return null;

      return fs.readFileSync(sp, encoding);
    }, null, "FS.read"),

  // ============================
  // ✍ WRITE
  // ============================
  write: (p, content, encoding = "utf8") =>
    safe(() => {
      const sp = safeResolve(p);
      if (!sp) return false;

      ensureDir(sp);

      fs.writeFileSync(sp, content, encoding);
      return true;
    }, false, "FS.write"),

  // ============================
  // ❌ REMOVE
  // ============================
  rm: (p) =>
    safe(() => {
      const sp = safeResolve(p);
      if (!sp) return false;

      if (fs.existsSync(sp)) {
        fs.rmSync(sp, { recursive: true, force: true });
      }

      return true;
    }, false, "FS.rm"),

  // ============================
  // 📂 EXISTS
  // ============================
  exists: (p) =>
    safe(() => {
      const sp = safeResolve(p);
      if (!sp) return false;

      return fs.existsSync(sp);
    }, false, "FS.exists"),

  // ============================
  // 📃 LIST DIRECTORY
  // ============================
  ls: (p) =>
    safe(() => {
      const sp = safeResolve(p);
      if (!sp) return [];

      return fs.readdirSync(sp, { withFileTypes: true })
        .map(entry => ({
          name: entry.name,
          isDir: entry.isDirectory(),
          isFile: entry.isFile(),
          hidden: entry.name.startsWith("."),
        }));
    }, [], "FS.ls"),

  // ============================
  // 📦 STAT
  // ============================
  stat: (p) =>
    safe(() => {
      const sp = safeResolve(p);
      if (!sp) return null;

      return fs.statSync(sp);
    }, null, "FS.stat"),

  // ============================
  // 🔁 COPY
  // ============================
  cp: (src, dest) =>
    safe(() => {
      const s = safeResolve(src);
      const d = safeResolve(dest);

      if (!s || !d) return false;

      fs.cpSync(s, d, { recursive: true, force: true });
      return true;
    }, false, "FS.cp"),

  // ============================
  // 🔁 MOVE
  // ============================
  mv: (src, dest) =>
    safe(() => {
      const s = safeResolve(src);
      const d = safeResolve(dest);

      if (!s || !d) return false;

      fs.cpSync(s, d, { recursive: true, force: true });
      fs.rmSync(s, { recursive: true, force: true });

      return true;
    }, false, "FS.mv"),

  // ============================
  // 👁 HIDE LAYER (external capability)
  // ============================
  hide: (p) =>
    safe(() => {
      const sp = safeResolve(p);
      if (!sp) return false;

      Hide.hide(sp);
      return true;
    }, false, "FS.hide"),

  unhide: (p) =>
    safe(() => {
      const sp = safeResolve(p);
      if (!sp) return false;

      Hide.unhide(sp);
      return true;
    }, false, "FS.unhide"),

  isHidden: (p) =>
    safe(() => {
      const sp = safeResolve(p);
      if (!sp) return false;

      return Hide.isHidden(sp);
    }, false, "FS.isHidden"),
};