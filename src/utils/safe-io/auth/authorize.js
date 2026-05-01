import path from "path";
import fs from "fs";

import { Some, None } from "../functional.js";
import { FileHandle } from "../capability/handle.js";
import { createToken } from "../capability/token.js";

/**
 * safe-io-v3 authorize layer
 * --------------------------
 * 核心职责：
 * 1. 解析 entry → resolved path
 * 2. root security boundary check
 * 3. policy check（非安全核心）
 * 4. 生成 FileHandle
 * 5. 生成 signed capability token（IPC用）
 */

// ==============================
// 🔐 Authorized roots
// ==============================

const authorizedRoots = new Set();

export const registerRoot = (rootPath) => {
  if (typeof rootPath !== "string") return None();

  const abs = path.resolve(rootPath);

  try {
    if (!fs.existsSync(abs)) return None();
  } catch {
    return None();
  }

  authorizedRoots.add(abs);
  return Some(abs);
};

export const clearRoots = () => {
  authorizedRoots.clear();
};

// ==============================
// 🔎 Path resolution
// ==============================

const resolveEntry = (base, entry) => {
  const basePath = path.resolve(...base.segments);

  if (!entry) return basePath;

  if (entry.__type === "Dir") {
    return path.join(basePath, entry.name);
  }

  if (entry.__type === "File") {
    const fileName = entry.ext
      ? `${entry.name}.${entry.ext}`
      : entry.name;

    return path.join(basePath, fileName);
  }

  return basePath;
};

// ==============================
// 🧠 Security boundary check
// ==============================

const isUnderRoot = (resolvedPath) => {
  const abs = path.resolve(resolvedPath);

  for (const root of authorizedRoots) {
    if (abs === root || abs.startsWith(root + path.sep)) {
      return true;
    }
  }

  return false;
};

// ==============================
// 👁 policy layer (NOT security layer)
// ==============================

const policyCheck = (entry) => {
  if (!entry) return true;

  const name = entry.name || entry?.path?.at?.(-1);

  // dotfiles are allowed (no security meaning)
  if (typeof name === "string" && name.startsWith(".")) {
    return true;
  }

  return true;
};

// ==============================
// ⚙️ MAIN AUTHORIZE FUNCTION
// ==============================

/**
 * authorize(base, entry)
 *
 * 返回：
 * {
 *   handle,
 *   token
 * }
 */
export const authorize = (base, entry) => {
  try {
    // 1. resolve
    const resolved = resolveEntry(base, entry);

    // 2. root check (HARD BOUNDARY)
    if (!isUnderRoot(resolved)) {
      console.warn("[safe-io] blocked root violation:", resolved);
      return None();
    }

    // 3. policy layer (soft rules)
    if (!policyCheck(entry)) {
      console.warn("[safe-io] policy reject");
      return None();
    }

    // 4. create capability handle
    const handle = FileHandle(resolved);

    // 5. create signed IPC token
    const token = createToken({
      path: resolved,
      permissions: handle.permissions || {},
    });

    // 6. return capability bundle
    return Some({
      handle,
      token,
    });

  } catch (e) {
    console.error("[safe-io] authorize error:", e);
    return None();
  }
};