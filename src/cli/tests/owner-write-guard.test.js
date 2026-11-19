/**
 * @file CLI owner 写路径测试
 * @description 验证活 GUI owner 存在时 --path 写命令经 owner RPC 执行，而不是直接写目录。
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

/**
 * 启动假 GUI owner 服务
 * @param {string} token - token
 * @returns {Promise<{server: WebSocketServer, port: number, requests: Object[]}>} 服务与请求记录
 */
async function createFakeOwnerServer(token) {
  const requests = [];
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await once(server, "listening");
  server.on("connection", (ws) => {
    ws.once("message", (data) => {
      let auth;
      try {
        auth = JSON.parse(String(data));
      } catch {
        ws.close();
        return;
      }
      if (auth?.token !== token) {
        ws.send(JSON.stringify({ ok: false }));
        ws.close();
        return;
      }
      ws.send(JSON.stringify({ ok: true }));
      ws.on("message", (requestData) => {
        const request = JSON.parse(String(requestData));
        requests.push(request);
        ws.send(
          JSON.stringify({ id: request.id, ok: true, result: "cli-test/1" }),
        );
      });
    });
  });
  return { server, port: server.address().port, requests };
}

describe("CLI owner 写路径", () => {
  test("活 GUI owner 存在时 --path 写命令经 owner RPC 执行", async () => {
    const { dir, cleanup } = tempBoardDir();
    const token = "owner-test-token";
    const fake = await createFakeOwnerServer(token);
    const claim = {
      ownerId: "gui-test-owner",
      pid: process.pid,
      source: "gui-test",
      boardId: null,
      transport: {
        kind: "gui",
        host: "127.0.0.1",
        port: fake.port,
        token,
      },
      claimedAt: new Date().toISOString(),
    };

    try {
      await createTestBoard(dir);
      await claimBoard(dir, claim);

      const { stdout } = await runCli([
        "add",
        "--path",
        dir,
        "--type",
        "StrokeObject",
        "--data",
        STROKE_DATA,
        "--source",
        "cli-test",
      ]);
      expect(stdout).toContain("cli-test/1");
      expect(fake.requests).toHaveLength(1);
      expect(fake.requests[0]).toMatchObject({
        route: "addObject",
        source: "cli-test",
      });
    } finally {
      await releaseOwnerClaim(dir, claim.ownerId).catch(() => {});
      fake.server.close();
      cleanup();
    }
  });
});
