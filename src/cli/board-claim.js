/**
 * @file 板目录 owner claim
 * @description 负责 `.owner.json` 的读取、写入、认领、释放与 owner 锁。
 * @module cli/board-claim
 * @author Zhou Chenyu
 * SPDX-License-Identifier: MIT
 */

import fs from "node:fs/promises";
import path from "node:path";
import {
  OWNER_FILE,
  OWNER_LOCK_FILE,
  OWNER_TRANSPORT_KINDS,
  parseOwnerClaim,
} from "../kernel/board/owner-claim.js";
import { isDaemonAlive } from "./daemon-registry.js";
import { t } from "./i18n.js";

/** owner 锁最大抢锁次数（含 stale 锁回收重试） */
const OWNER_LOCK_MAX_ATTEMPTS = 3;

/**
 * 判定 pid 是否存活
 * @param {number} pid - 进程号
 * @returns {boolean} 是否存活（EPERM 视为存活：进程在但无权发信号）
 */
function isPidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

/**
 * 读 owner 锁文件中的持有者 pid
 * @param {string} lockPath - 锁文件路径
 * @returns {Promise<number|null>} pid；文件缺失或内容非法时为 null
 */
async function readOwnerLockPid(lockPath) {
  try {
    const text = await fs.readFile(lockPath, "utf-8");
    const pid = Number.parseInt(text.trim(), 10);
    return Number.isSafeInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

/**
 * 抢板目录 owner 锁（.owner.lock，O_EXCL 创建，内容为持有者 pid）
 * @param {string} rootPath - 板目录
 * @returns {Promise<() => Promise<void>>} 释放函数（幂等）
 * @throws {Error} 锁被活进程持有、或多次回收 stale 锁后仍被占用时
 *
 * @description
 * 锁只护「读旧 claim → 判活 → 写新 claim」与 daemon 启动窗口；
 * 锁已存在时读 pid 判活：活进程（含 EPERM）拒绝进入；死 pid（ESRCH）或内容
 * 不可读按崩溃残留的 stale 锁处理，回收后重试。
 */
async function acquireOwnerLock(rootPath) {
  const lockPath = path.join(rootPath, OWNER_LOCK_FILE);
  for (let attempt = 0; attempt < OWNER_LOCK_MAX_ATTEMPTS; attempt += 1) {
    try {
      await fs.writeFile(lockPath, String(process.pid), { flag: "wx" });
      let released = false;
      return async () => {
        if (released) return;
        released = true;
        await fs.rm(lockPath, { force: true });
      };
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      let holderPid = await readOwnerLockPid(lockPath);
      if (holderPid === null) {
        // 持有者刚创建锁尚未写入 pid 的窗口：稍候重读一次再按 stale 处理
        await new Promise((resolve) => setTimeout(resolve, 50));
        holderPid = await readOwnerLockPid(lockPath);
      }
      if (holderPid !== null && isPidAlive(holderPid)) {
        throw new Error(
          `另一进程（pid ${holderPid}）正在认领该板目录，请稍后重试。`,
        );
      }
      // stale 锁（持有进程已死或内容不可读）：回收后重试
      await fs.rm(lockPath, { force: true });
    }
  }
  throw new Error(t("err.ownerLockContention"));
}

/**
 * 读取 owner claim
 * @param {string} rootPath - 板目录
 * @returns {Promise<Object|null>} claim；不存在或非法时为 null
 */
async function readOwnerClaim(rootPath) {
  try {
    const text = await fs.readFile(path.join(rootPath, OWNER_FILE), "utf-8");
    return parseOwnerClaim(text);
  } catch {
    return null;
  }
}

/**
 * 写入 owner claim
 * @param {string} rootPath - 板目录
 * @param {Object} claim - owner claim
 * @returns {Promise<void>}
 * @throws {Error} claim 非法或写入失败时抛出
 *
 * @description
 * 调用方必须已持有 owner 锁；临时文件写完后 rename 原子就位。
 */
async function writeOwnerClaim(rootPath, claim) {
  const parsed = parseOwnerClaim(claim);
  if (parsed === null) {
    throw new Error("Invalid owner claim.");
  }
  const ownerFile = path.join(rootPath, OWNER_FILE);
  const tmp = `${ownerFile}.tmp-${process.pid}-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2)}`;
  try {
    await fs.writeFile(tmp, JSON.stringify(parsed, null, 2), "utf-8");
    await fs.rename(tmp, ownerFile);
  } catch (error) {
    await fs.rm(tmp, { force: true }).catch(() => {});
    throw error;
  }
}

/**
 * 删除 owner claim 文件
 * @param {string} rootPath - 板目录
 * @returns {Promise<void>}
 *
 * @description 调用方必须已持有 owner 锁；用于启动失败时的已写 claim 清理。
 */
async function removeOwnerClaimFile(rootPath) {
  await fs.rm(path.join(rootPath, OWNER_FILE), { force: true });
}

/**
 * 判断 owner claim 是否仍然存活
 * @param {Object|null} claim - owner claim
 * @returns {Promise<boolean>} daemon transport 探测端口，其余 transport 判 pid 存活
 */
async function isOwnerClaimAlive(claim) {
  const parsed = parseOwnerClaim(claim);
  if (parsed === null) return false;
  if (
    parsed.transport.kind === OWNER_TRANSPORT_KINDS.DAEMON ||
    typeof parsed.transport.port === "number"
  ) {
    return isDaemonAlive(parsed.transport.port);
  }
  return isPidAlive(parsed.pid);
}

/**
 * 认领板目录
 * @param {string} rootPath - 板目录
 * @param {Object} claim - owner claim
 * @returns {Promise<Object>} 写入后的 claim
 * @throws {Error} claim 非法、已有活 owner、或抢锁失败时抛出
 */
async function claimBoard(rootPath, claim) {
  const parsed = parseOwnerClaim(claim);
  if (parsed === null) {
    throw new Error("Invalid owner claim.");
  }
  const release = await acquireOwnerLock(rootPath);
  try {
    const existing = await readOwnerClaim(rootPath);
    if (existing !== null && (await isOwnerClaimAlive(existing))) {
      throw new Error(
        `板目录已被 ${existing.source}（owner ${existing.ownerId}，pid ${existing.pid}）认领。`,
      );
    }
    await writeOwnerClaim(rootPath, parsed);
    return parsed;
  } finally {
    await release();
  }
}

/**
 * 释放板目录 owner claim
 * @param {string} rootPath - 板目录
 * @param {string} ownerId - 期望的 owner id
 * @returns {Promise<boolean>} 是否删除了匹配的 claim
 * @throws {Error} 抢锁失败时抛出
 */
async function releaseOwnerClaim(rootPath, ownerId) {
  const release = await acquireOwnerLock(rootPath);
  try {
    const existing = await readOwnerClaim(rootPath);
    if (existing === null || existing.ownerId !== ownerId) return false;
    await fs.rm(path.join(rootPath, OWNER_FILE), { force: true });
    return true;
  } finally {
    await release();
  }
}

export {
  acquireOwnerLock,
  readOwnerClaim,
  writeOwnerClaim,
  removeOwnerClaimFile,
  isOwnerClaimAlive,
  claimBoard,
  releaseOwnerClaim,
};
