import { FS } from "../runtime/fs.js";
import { Hide } from "../runtime/hide.js";
import { Zip } from "../runtime/zip.js";

export const FileHandle = (resolvedPath, permissions = {}) => {

  let revoked = false;

  const defaultPerm = {
    read: true,
    write: false,
    rm: false,
    ls: true,
    hide: false,
    zip: true,
  };

  const perm = { ...defaultPerm, ...permissions };

  // ==========================
  // 🔒 revoke control
  // ==========================

  const revoke = () => {
    revoked = true;
  };

  const check = () => {
    if (revoked) {
      throw new Error("[safe-io] handle revoked");
    }
  };

  // ==========================
  // 📖 read
  // ==========================
  const read = () => {
    check();
    if (!perm.read) return null;
    return FS.read(resolvedPath);
  };

  // ==========================
  // ✍ write
  // ==========================
  const write = (content) => {
    check();
    if (!perm.write) return false;
    return FS.write(resolvedPath, content);
  };

  // ==========================
  // ❌ rm
  // ==========================
  const rm = () => {
    check();
    if (!perm.rm) return false;
    return FS.rm(resolvedPath);
  };

  // ==========================
  // 📂 ls
  // ==========================
  const ls = () => {
    check();
    if (!perm.ls) return [];
    return FS.ls(resolvedPath);
  };

  // ==========================
  // 👁 hide
  // ==========================
  const hide = () => {
    check();
    if (!perm.hide) return false;
    return Hide.hide(resolvedPath);
  };

  const unhide = () => {
    check();
    if (!perm.hide) return false;
    return Hide.unhide(resolvedPath);
  };

  // ==========================
  // 📦 zip
  // ==========================
  const zip = (out) => {
    check();
    if (!perm.zip) return false;
    return Zip.fromFolder(resolvedPath, out);
  };

  const unzipTo = (target) => {
    check();
    if (!perm.zip) return false;
    return Zip.extractTo(resolvedPath, target);
  };

  // ==========================
  // 📌 metadata
  // ==========================
  const exists = () => {
    check();
    return FS.exists(resolvedPath);
  };

  // ==========================
  // 🔐 public API
  // ==========================
  return Object.freeze({
    path: resolvedPath,

    read,
    write,
    rm,
    ls,

    hide,
    unhide,

    zip,
    unzipTo,

    exists,

    // 🔥 NEW
    revoke,
    isRevoked: () => revoked,
  });
};