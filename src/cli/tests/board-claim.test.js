/**
 * @file 板目录 owner claim 测试
 * @description 验证 claim 读写、活 owner 拒绝、stale/corrupt 回收、owner 锁竞争与原子写。
 * @module cli/tests/board-claim.test
 * @author Zhou Chenyu
 * SPDX-License-Identifier: MIT
 */

import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  OWNER_FILE,
  OWNER_LOCK_FILE,
  createDaemonOwnerClaim,
  ownerClaimToDaemonDescriptor,
} from "../../kernel/board/owner-claim.js";
import {
  acquireOwnerLock,
  claimBoard,
  readOwnerClaim,
  releaseOwnerClaim,
} from "../board-claim.js";

/**
 * 取一个已退出子进程的 pid（保证为死 pid）
 * @returns {Promise<number>} 死 pid
 */
async function exitedChildPid() {
  const child = spawn(process.execPath, ["-e", ""]);
  await new Promise((resolve) => child.on("exit", resolve));
  return child.pid;
}

/**
 * 创建临时板目录
 * @returns {Promise<{dir: string, cleanup: Function}>} 目录与清理函数
 */
async function tempBoardDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "hwb-claim-test-"));
  return {
    dir,
    cleanup: () => fs.rm(dir, { recursive: true, force: true }),
  };
}

describe("板目录 owner claim", () => {
  test("claim 写入、读取、按 ownerId 释放", async () => {
    const { dir, cleanup } = await tempBoardDir();
    try {
      const claim = createDaemonOwnerClaim({
        name: "claim-test",
        pid: process.pid,
        source: "daemon-claim",
        port: 54321,
      });
      await claimBoard(dir, claim);

      const stored = await readOwnerClaim(dir);
      expect(stored.ownerId).toBe(claim.ownerId);
      expect(stored.source).toBe("daemon-claim");
      expect(ownerClaimToDaemonDescriptor(stored)).toEqual({
        name: "claim-test",
        host: "127.0.0.1",
        port: 54321,
        source: "daemon-claim",
        boardId: null,
        pid: process.pid,
        ownerId: claim.ownerId,
        claimedAt: claim.claimedAt,
      });

      expect(await releaseOwnerClaim(dir, "other-owner")).toBe(false);
      expect(await readOwnerClaim(dir)).not.toBeNull();
      expect(await releaseOwnerClaim(dir, claim.ownerId)).toBe(true);
      expect(await readOwnerClaim(dir)).toBeNull();
    } finally {
      await cleanup();
    }
  });

  test("活 owner 存在时拒绝第二次 claim", async () => {
    const { dir, cleanup } = await tempBoardDir();
    try {
      await claimBoard(dir, {
        ownerId: "live-owner",
        pid: process.pid,
        source: "gui-live",
        boardId: null,
        transport: { kind: "gui" },
        claimedAt: new Date().toISOString(),
      });

      await expect(
        claimBoard(
          dir,
          createDaemonOwnerClaim({
            name: "other",
            pid: process.pid,
            source: "daemon-other",
            port: 54322,
          }),
        ),
      ).rejects.toThrow("已被");
    } finally {
      await cleanup();
    }
  });

  test("stale owner（死 pid）可被覆盖", async () => {
    const { dir, cleanup } = await tempBoardDir();
    try {
      const deadPid = await exitedChildPid();
      await claimBoard(dir, {
        ownerId: "stale-owner",
        pid: deadPid,
        source: "gui-stale",
        boardId: null,
        transport: { kind: "gui" },
        claimedAt: new Date().toISOString(),
      });

      const next = createDaemonOwnerClaim({
        name: "next",
        pid: process.pid,
        source: "daemon-next",
        port: 54323,
      });
      await claimBoard(dir, next);
      expect((await readOwnerClaim(dir)).ownerId).toBe(next.ownerId);
    } finally {
      await cleanup();
    }
  });

  test("损坏的 claim 按 stale 处理", async () => {
    const { dir, cleanup } = await tempBoardDir();
    try {
      await fs.writeFile(path.join(dir, OWNER_FILE), "{not json", "utf-8");
      expect(await readOwnerClaim(dir)).toBeNull();

      const next = createDaemonOwnerClaim({
        name: "after-corrupt",
        pid: process.pid,
        source: "daemon-next",
        port: 54324,
      });
      await claimBoard(dir, next);
      expect((await readOwnerClaim(dir)).ownerId).toBe(next.ownerId);
    } finally {
      await cleanup();
    }
  });

  test("owner 锁被活进程持有时 claim 报错", async () => {
    const { dir, cleanup } = await tempBoardDir();
    try {
      const release = await acquireOwnerLock(dir);
      await expect(
        claimBoard(
          dir,
          createDaemonOwnerClaim({
            name: "blocked",
            pid: process.pid,
            source: "daemon-blocked",
            port: 54325,
          }),
        ),
      ).rejects.toThrow("正在认领");
      await release();

      const next = createDaemonOwnerClaim({
        name: "unblocked",
        pid: process.pid,
        source: "daemon-unblocked",
        port: 54326,
      });
      await claimBoard(dir, next);
      expect((await readOwnerClaim(dir)).ownerId).toBe(next.ownerId);
    } finally {
      await cleanup();
    }
  });

  test("claim 原子写不留下临时文件", async () => {
    const { dir, cleanup } = await tempBoardDir();
    try {
      await claimBoard(
        dir,
        createDaemonOwnerClaim({
          name: "atomic",
          pid: process.pid,
          source: "daemon-atomic",
          port: 54327,
        }),
      );
      const names = await fs.readdir(dir);
      expect(names).toContain(OWNER_FILE);
      expect(names.some((name) => name.startsWith(`${OWNER_FILE}.tmp-`))).toBe(
        false,
      );
      expect(names).not.toContain(OWNER_LOCK_FILE);
    } finally {
      await cleanup();
    }
  });
});
