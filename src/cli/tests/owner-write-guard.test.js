/**
 * @file CLI owner 写保护测试
 * @description 验证活 GUI owner 存在时 --path 写命令拒绝直写，避免双写。
 * @module cli/tests/owner-write-guard.test
 * @author Zhou Chenyu
 */

import { once } from "node:events";
import { WebSocketServer } from "ws";
import { claimBoard, releaseOwnerClaim } from "../board-claim.js";
import {
  createTestBoard,
  runCli,
  setupCliTestEnv,
  STROKE_DATA,
  tempBoardDir,
} from "./cli-test-helper.js";

setupCliTestEnv();

describe("CLI owner 写保护", () => {
  test("活 GUI owner 存在时 --path 写命令拒绝直写", async () => {
    const { dir, cleanup } = tempBoardDir();
    const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
    await once(server, "listening");
    const port = server.address().port;
    const claim = {
      ownerId: "gui-test-owner",
      pid: process.pid,
      source: "gui-test",
      boardId: null,
      transport: {
        kind: "gui",
        host: "127.0.0.1",
        port,
        token: "test-token",
      },
      claimedAt: new Date().toISOString(),
    };

    try {
      await createTestBoard(dir);
      await claimBoard(dir, claim);

      let error = null;
      try {
        await runCli([
          "add",
          "--path",
          dir,
          "--type",
          "StrokeObject",
          "--data",
          STROKE_DATA,
        ]);
      } catch (caught) {
        error = caught;
      }
      expect(error).not.toBeNull();
      expect(error.stderr).toContain("GUI 持有");
    } finally {
      await releaseOwnerClaim(dir, claim.ownerId).catch(() => {});
      server.close();
      cleanup();
    }
  });
});
