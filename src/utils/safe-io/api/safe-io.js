import { registerRoot, authorize, clearRoots } from "../auth/authorize.js";
import { BaseDir, Dir, File, createBaseDir, cd, father } from "../core/safe-io-core.js";

/**
 * safe-io-v2 API layer
 * --------------------
 * 设计原则：
 * - 不暴露 runtime (fs/zip/hide)
 * - 不暴露 authorize 内部结构
 * - 只返回 capability handle
 * - renderer 只接触这一层
 */

// ==============================
// 🔐 安全入口：授权
// ==============================

const open = (base, entry, permissions) => {
  const handleOption = authorize(base, entry);

  if (!handleOption || handleOption.__tag === "None") {
    return null;
  }

  const handle = handleOption[0];

  // attach permission override if needed
  if (permissions) {
    return handle; // v2 simple: permissions already baked in handle
  }

  return handle;
};

// ==============================
// 📂 Root registration
// ==============================

const register = (path) => registerRoot(path);

// ==============================
// 🧹 reset (for dev/test only)
// ==============================

const reset = () => clearRoots();

// ==============================
// 📦 DSL exports
// ==============================

export const safeIO = {

  // -------- security --------
  register,
  reset,
  open,

  // -------- DSL --------
  BaseDir,
  Dir,
  File,
  createBaseDir,
  cd,
  father,
};

// ==============================
// 🔁 default export
// ==============================

export default safeIO;