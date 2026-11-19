/**
 * @file 板目录 owner 锁测试
 * @description 验证 owner 锁互斥（活 pid 持锁拒绝认领）、stale 锁（死 pid）回收与锁释放后可再抢。
 * @module cli/tests/daemon-start-lock.test
 * @author Zhou Chenyu
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { acquireOwnerLock } from "../board-claim.js";
import { OWNER_LOCK_FILE } from "../../kernel/board/owner-claim.js";
import {
  createTestBoard,
  setupCliTestEnv,
  startTestDaemon,
  tempBoardDir,
} from "./cli-test-helper.js";

setupCliTestEnv();

/**
 * 取一个已退出子进程的 pid（保证为死 pid）
 * @returns {Promise<number>} 死 pid
 */
async function exitedChildPid() {
  const child = spawn(process.execPath, ["-e", ""]);
  await new Promise((resolve) => child.on("exit", resolve));
  return child.pid;
}

describe("板目录 owner 锁", () => {
  test("活进程持锁时第二次抢锁报错；释放后可再抢", async () => {
    const { dir, cleanup } = tempBoardDir();
    fs.mkdirSync(dir, { recursive: true });
    try {
      // 本进程持锁（pid 存活）：第二次抢锁拒绝
      const release = await acquireOwnerLock(dir);
      await expect(acquireOwnerLock(dir)).rejects.toThrow("正在认领");
      // 释放后锁文件删除，可再抢
      await release();
      expect(fs.existsSync(path.join(dir, OWNER_LOCK_FILE))).toBe(false);
      const releaseAgain = await acquireOwnerLock(dir);
      await releaseAgain();
    } finally {
      cleanup();
    }
  });

  test("stale 锁（死 pid）被回收后抢锁成功", async () => {
    const { dir, cleanup } = tempBoardDir();
    fs.mkdirSync(dir, { recursive: true });
    try {
      const deadPid = await exitedChildPid();
      fs.writeFileSync(path.join(dir, OWNER_LOCK_FILE), String(deadPid));
      const release = await acquireOwnerLock(dir);
      // 锁被本进程接管（内容换成本进程 pid）
      const holder = fs.readFileSync(path.join(dir, OWNER_LOCK_FILE), "utf-8");
      expect(Number.parseInt(holder, 10)).toBe(process.pid);
      await release();
    } finally {
      cleanup();
    }
  });

  test("start 前置：活锁拒绝 startBoardDaemon；stale 锁被回收后正常启动", async () => {
    const { dir, cleanup } = tempBoardDir();
    await createTestBoard(dir);
    try {
      const lockPath = path.join(dir, OWNER_LOCK_FILE);
      // 活锁（本进程 pid）：start 拒绝，且锁文件不被误删
      fs.writeFileSync(lockPath, String(process.pid));
      await expect(
        startTestDaemon("lock-test", dir, { source: "lock" }),
      ).rejects.toThrow("正在认领");
      expect(fs.existsSync(lockPath)).toBe(true);

      // stale 锁（死 pid）：回收后正常启动，启动完成锁即释放
      const deadPid = await exitedChildPid();
      fs.writeFileSync(lockPath, String(deadPid));
      const daemon = await startTestDaemon("lock-test", dir, { source: "lock" });
      expect(daemon.port).toBeGreaterThan(0);
      expect(fs.existsSync(lockPath)).toBe(false);
      await daemon.close();
    } finally {
      cleanup();
    }
  });
});
