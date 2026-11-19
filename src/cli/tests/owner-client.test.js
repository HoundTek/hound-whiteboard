/**
 * @file GUI owner RPC 客户端测试
 * @description 验证 token 鉴权、请求携带 source、结果与错误响应。
 * @module cli/tests/owner-client.test
 * @author Zhou Chenyu
 */

import { once } from "node:events";
import { WebSocketServer } from "ws";
import { connectOwnerByClaim } from "../owner-client.js";

/**
 * 启动假 owner WS 服务
 * @param {{ token?: string, onRequest?: (request: Object) => * }} [options={}] - 选项
 * @returns {Promise<{server: WebSocketServer, port: number, token: string, requests: Object[]}>} 服务与调用记录
 */
async function createFakeOwnerServer({ token = "test-token", onRequest } = {}) {
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
        const result = onRequest?.(request);
        if (result instanceof Error) {
          ws.send(
            JSON.stringify({
              id: request.id,
              ok: false,
              error: result.message,
            }),
          );
          return;
        }
        ws.send(JSON.stringify({ id: request.id, ok: true, result }));
      });
    });
  });
  return { server, port: server.address().port, token, requests };
}

/**
 * 构造 GUI owner claim
 * @param {number} port - 端口
 * @param {string} token - token
 * @returns {Object} claim
 */
function makeClaim(port, token) {
  return {
    ownerId: "owner-1",
    pid: process.pid,
    source: "gui-owner",
    boardId: null,
    transport: { kind: "gui", host: "127.0.0.1", port, token },
    claimedAt: new Date().toISOString(),
  };
}

describe("GUI owner RPC 客户端", () => {
  test("token 鉴权后请求携带 source 并返回结果", async () => {
    const fake = await createFakeOwnerServer({
      onRequest: () => "cli-1/1",
    });
    try {
      const session = await connectOwnerByClaim(
        makeClaim(fake.port, fake.token),
        { rootPath: "/board", source: "cli-1" },
      );
      expect(session).not.toBeNull();
      expect(await session.api.addObject("StrokeObject", {})).toBe("cli-1/1");
      expect(fake.requests).toHaveLength(1);
      expect(fake.requests[0]).toMatchObject({
        route: "addObject",
        source: "cli-1",
      });
      session.close();
    } finally {
      fake.server.close();
    }
  });

  test("token 错误时连接失败", async () => {
    const fake = await createFakeOwnerServer({ token: "right-token" });
    try {
      const session = await connectOwnerByClaim(
        makeClaim(fake.port, "wrong-token"),
        { rootPath: "/board", source: "cli-1" },
      );
      expect(session).toBeNull();
    } finally {
      fake.server.close();
    }
  });

  test("错误响应转成 rejected Promise", async () => {
    const fake = await createFakeOwnerServer({
      onRequest: () => new Error("boom"),
    });
    try {
      const session = await connectOwnerByClaim(
        makeClaim(fake.port, fake.token),
        { rootPath: "/board", source: "cli-1" },
      );
      await expect(session.api.undo()).rejects.toThrow("boom");
      session.close();
    } finally {
      fake.server.close();
    }
  });

  test("非 GUI transport 返回 null", async () => {
    const session = await connectOwnerByClaim(
      {
        transport: {
          kind: "daemon",
          name: "d",
          host: "127.0.0.1",
          port: 1,
        },
      },
      { rootPath: "/board", source: "cli-1" },
    );
    expect(session).toBeNull();
  });
});
