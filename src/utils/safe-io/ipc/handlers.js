import { ipcMain } from "electron";

import { verify } from "./verify.js";
import { revoke } from "../auth/registry.js";

/**
 * safe-io IPC handlers (v2)
 * -------------------------
 * 改进点：
 * 1. verify 返回 context，不直接信任 handle
 * 2. permission enforcement hook（预留）
 * 3. unified execution wrapper
 * 4. safer error propagation
 * 5. structured capability context
 */

// ==============================
// 🧠 execution wrapper
// ==============================

const exec = (fn) => {
  try {
    return fn();
  } catch (e) {
    console.error("[safe-io ipc error]", e);
    throw new Error("IPC execution failed");
  }
};

// ==============================
// 🔐 permission enforcement layer (stub hook)
// ==============================

const enforce = (ctx, action) => {
  // ctx = { handle, permissions, id, root }

  // 👉 这里是你下一阶段 permission bitmask 的执行点
  if (!ctx) throw new Error("missing capability context");

  // example hook (placeholder)
  if (action === "write" && ctx.permissions?.write === false) {
    throw new Error("permission denied: write");
  }

  if (action === "delete" && ctx.permissions?.delete === false) {
    throw new Error("permission denied: delete");
  }

  return ctx.handle;
};

// ==============================
// 🔐 SAFE DISPATCH TABLE
// ==============================

const dispatch = {

  // ==========================
  // 📖 FS READ
  // ==========================
  "fs:read": (token) =>
    exec(() => {
      const ctx = verify(token);
      const handle = enforce(ctx, "read");
      return handle.read();
    }),

  // ==========================
  // ✍ WRITE
  // ==========================
  "fs:write": (token, content) =>
    exec(() => {
      const ctx = verify(token);
      const handle = enforce(ctx, "write");
      return handle.write(content);
    }),

  // ==========================
  // 📂 EXISTS
  // ==========================
  "fs:exists": (token) =>
    exec(() => {
      const ctx = verify(token);
      const handle = enforce(ctx, "read");
      return handle.exists();
    }),

  // ==========================
  // ❌ DELETE
  // ==========================
  "fs:delete": (token) =>
    exec(() => {
      const ctx = verify(token);
      const handle = enforce(ctx, "delete");
      return handle.delete();
    }),

  // ==========================
  // 📃 LIST
  // ==========================
  "fs:ls": (token, options) =>
    exec(() => {
      const ctx = verify(token);
      const handle = enforce(ctx, "read");
      return handle.ls(options);
    }),

  // ==========================
  // 📁 MKDIR
  // ==========================
  "fs:mkdir": (token) =>
    exec(() => {
      const ctx = verify(token);
      const handle = enforce(ctx, "write");
      return handle.mkdir();
    }),

  // ==========================
  // 📦 ZIP
  // ==========================
  "fs:zip": (token, outPath) =>
    exec(() => {
      const ctx = verify(token);
      const handle = enforce(ctx, "read");
      return handle.zip(outPath);
    }),

  "fs:unzip": (token, outDir) =>
    exec(() => {
      const ctx = verify(token);
      const handle = enforce(ctx, "write");
      return handle.unzip(outDir);
    }),

  // ==========================
  // 👁 HIDE
  // ==========================
  "fs:hide": (token) =>
    exec(() => {
      const ctx = verify(token);
      const handle = enforce(ctx, "write");
      return handle.hide();
    }),

  "fs:unhide": (token) =>
    exec(() => {
      const ctx = verify(token);
      const handle = enforce(ctx, "write");
      return handle.unhide();
    }),

  // ==========================
  // 🔥 CAPABILITY CONTROL
  // ==========================
  "cap:revoke": (tokenId) =>
    exec(() => {
      if (!tokenId) throw new Error("missing tokenId");
      revoke(tokenId);
      return true;
    }),
};

// ==============================
// ⚙️ REGISTER IPC HANDLERS
// ==============================

export const registerHandlers = () => {
  for (const [channel, handler] of Object.entries(dispatch)) {
    ipcMain.handle(channel, async (_event, ...args) => {
      return handler(...args);
    });
  }

  console.log("[safe-io] IPC handlers v2 registered");
};