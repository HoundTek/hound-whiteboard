/**
 * @file 同步中继服务器测试
 * @description 验证房间成员管理、记录与事件广播、INIT 定向与房间隔离。
 * @module host/sync/tests/relay-server.test
 * @author Zhou Chenyu
 */

import { jest } from "@jest/globals";
import { EventEmitter } from "node:events";
import { WebSocket as WsClient } from "ws";
import { createRelayServer } from "../relay-server.js";

/**
 * 连接一个测试客户端
 * @param {number} port - 服务器端口
 * @returns {Promise<Object>} 客户端句柄
 */
async function connectClient(port) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  /** @type {Object[]} */
  const messages = [];
  ws.addEventListener("message", (event) => {
    messages.push(JSON.parse(String(event.data)));
  });
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });
  return {
    ws,
    messages,
    /**
     * 发送一条消息
     * @param {Object} message - 消息体
     * @returns {void}
     */
    send: (message) => ws.send(JSON.stringify(message)),

    /**
     * 等待满足条件的消息到达
     * @param {Function} predicate - 判定函数
     * @param {number} [timeoutMs=3000] - 超时
     * @returns {Promise<Object>} 命中的消息
     */
    waitFor: async (predicate, timeoutMs = 3000) => {
      const start = Date.now();
      for (;;) {
        const found = messages.find(predicate);
        if (found) return found;
        if (Date.now() - start > timeoutMs) {
          throw new Error(`waitFor 超时：${JSON.stringify(messages)}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    },

    /**
     * 关闭连接
     * @returns {Promise<void>}
     */
    close: () =>
      new Promise((resolve) => {
        ws.addEventListener("close", resolve, { once: true });
        ws.close();
      }),
  };
}

/**
 * 连接并加入房间
 * @param {number} port - 服务器端口
 * @param {string} boardId - 板 id
 * @param {string} source - 来源标识
 * @returns {Promise<Object>} 客户端句柄
 */
async function joinClient(port, boardId, source) {
  const client = await connectClient(port);
  client.send({ type: "join", boardId, source });
  await client.waitFor((m) => m.type === "joined");
  return client;
}

/**
 * mock relay 模块的递增加载标识
 * @type {number}
 */
let mockRelayModuleId = 0;

/**
 * 创建可手动触发连接事件的 mock 中继
 * @param {Object} [options={}] - 中继选项
 * @returns {Promise<{server: Object, wss: EventEmitter}>} 中继与 mock WebSocketServer
 */
async function createMockRelay(options = {}) {
  const wss = new EventEmitter();
  wss.clients = new Set();
  wss.address = () => ({ address: "127.0.0.1", port: 0 });
  wss.close = (callback) => callback();
  const MockWebSocketServer = function (serverOptions) {
    wss.options = serverOptions;
    return wss;
  };
  jest.unstable_mockModule("ws", () => ({
    WebSocketServer: MockWebSocketServer,
  }));
  const { createRelayServer: createMockServer } = await import(
    `../relay-server.js?mock=${mockRelayModuleId++}`
  );
  return {
    server: createMockServer({ heartbeatMs: 0, ...options }),
    wss,
  };
}

/**
 * 接入一个 mock 客户端并完成 join
 * @param {EventEmitter} wss - mock WebSocketServer
 * @param {string} source - 来源标识
 * @returns {EventEmitter} 带 WebSocket 发送桩的客户端
 */
function joinMockClient(wss, source) {
  const ws = new EventEmitter();
  ws.OPEN = 1;
  ws.CLOSED = 3;
  ws.readyState = ws.OPEN;
  ws.bufferedAmount = 0;
  ws.send = jest.fn((data, callback) => callback?.());
  ws.ping = jest.fn((callback) => callback?.());
  ws.terminate = jest.fn(() => {
    if (ws.readyState === ws.CLOSED) return;
    ws.readyState = ws.CLOSED;
    wss.clients.delete(ws);
    ws.emit("close");
  });
  wss.clients.add(ws);
  wss.emit("connection", ws);
  ws.emit(
    "message",
    JSON.stringify({ type: "join", boardId: "board-1", source }),
  );
  ws.send.mockClear();
  return ws;
}

/**
 * 向 mock 客户端注入一条入站消息
 * @param {EventEmitter} ws - mock 客户端
 * @param {Object} message - 消息体
 * @returns {void}
 */
function emitMockMessage(ws, message) {
  ws.emit("message", JSON.stringify(message));
}

/**
 * 读取 mock 客户端已发送的 JSON 消息
 * @param {EventEmitter} ws - mock 客户端
 * @returns {Object[]} 已发送消息
 */
function mockSentMessages(ws) {
  return ws.send.mock.calls.map(([payload]) => JSON.parse(payload));
}

describe("同步中继服务器", () => {
  jest.setTimeout(20000);

  /** @type {{close: () => Promise<void>, port: number}|null} */
  let server = null;

  afterEach(async () => {
    await server?.close();
    server = null;
  });

  test("加入房间收到确认与现有成员列表", async () => {
    server = createRelayServer({ port: 0 });
    await server.ready;
    const a = await joinClient(server.port, "board-1", "dev-a");
    const b = await joinClient(server.port, "board-1", "dev-b");

    const joined = b.messages.find((m) => m.type === "joined");
    expect(joined.peers).toEqual(["dev-a"]);
    expect(server.roomSize("board-1")).toBe(2);

    // 后到的成员向现有成员广播 peer-joined
    const peerJoined = a.messages.find((m) => m.type === "peer-joined");
    expect(peerJoined.source).toBe("dev-b");

    await a.close();
    await b.close();
  });

  test("records 广播给房间内其他成员并附来源", async () => {
    server = createRelayServer({ port: 0 });
    await server.ready;
    const a = await joinClient(server.port, "board-1", "dev-a");
    const b = await joinClient(server.port, "board-1", "dev-b");

    a.send({ type: "records", records: [{ id: "dev-a/op-1" }] });

    const received = await b.waitFor((m) => m.type === "records");
    expect(received.source).toBe("dev-a");
    expect(received.records).toEqual([{ id: "dev-a/op-1" }]);

    // 发送者收不到自己的广播
    await expect(
      a.waitFor((m) => m.type === "records", 300),
    ).rejects.toThrow("waitFor 超时");

    await a.close();
    await b.close();
  });

  test("aom 事件与 digest 同样按房间广播", async () => {
    server = createRelayServer({ port: 0 });
    await server.ready;
    const a = await joinClient(server.port, "board-1", "dev-a");
    const b = await joinClient(server.port, "board-1", "dev-b");

    a.send({ type: "aom", event: { kind: "pickup", ids: ["o1"] } });
    const aom = await b.waitFor((m) => m.type === "aom");
    expect(aom.event).toEqual({ kind: "pickup", ids: ["o1"] });

    a.send({ type: "digest", digest: { logSize: 5 } });
    const digest = await b.waitFor((m) => m.type === "digest");
    expect(digest.digest).toEqual({ logSize: 5 });

    await a.close();
    await b.close();
  });

  test("request-init 广播到其他成员，respond-init 定向只到请求者", async () => {
    server = createRelayServer({ port: 0 });
    await server.ready;
    const newcomer = await joinClient(server.port, "board-1", "dev-new");
    const holderA = await joinClient(server.port, "board-1", "dev-a");
    const holderB = await joinClient(server.port, "board-1", "dev-b");

    newcomer.send({ type: "request-init" });
    await holderA.waitFor(
      (m) => m.type === "request-init" && m.source === "dev-new",
    );
    await holderB.waitFor(
      (m) => m.type === "request-init" && m.source === "dev-new",
    );

    holderA.send({
      type: "respond-init",
      to: "dev-new",
      records: [{ id: "dev-a/op-1" }],
      meta: { logSize: 1 },
    });
    const response = await newcomer.waitFor((m) => m.type === "respond-init");
    expect(response.source).toBe("dev-a");
    expect(response.records).toEqual([{ id: "dev-a/op-1" }]);

    // 非目标成员收不到定向响应
    await expect(
      holderB.waitFor((m) => m.type === "respond-init", 300),
    ).rejects.toThrow("waitFor 超时");

    await newcomer.close();
    await holderA.close();
    await holderB.close();
  });

  test("不同房间互不可见", async () => {
    server = createRelayServer({ port: 0 });
    await server.ready;
    const a = await joinClient(server.port, "board-1", "dev-a");
    const b = await joinClient(server.port, "board-2", "dev-b");

    a.send({ type: "records", records: [{ id: "dev-a/op-1" }] });
    await expect(
      b.waitFor((m) => m.type === "records", 300),
    ).rejects.toThrow("waitFor 超时");

    await a.close();
    await b.close();
  });

  test("断开后广播 peer-left 并释放房间", async () => {
    server = createRelayServer({ port: 0 });
    await server.ready;
    const a = await joinClient(server.port, "board-1", "dev-a");
    const b = await joinClient(server.port, "board-1", "dev-b");

    await b.close();
    const left = await a.waitFor((m) => m.type === "peer-left");
    expect(left.source).toBe("dev-b");

    await a.close();
    await a.waitFor(() => server.roomSize("board-1") === 0).catch(() => {});
    expect(server.roomSize("board-1")).toBe(0);
  });

  test("同 source 重复加入踢旧迎新", async () => {
    server = createRelayServer({ port: 0 });
    await server.ready;
    const oldClient = await joinClient(server.port, "board-1", "dev-a");
    const bystander = await joinClient(server.port, "board-1", "dev-b");

    const oldClosed = new Promise((resolve) => {
      oldClient.ws.addEventListener("close", resolve, { once: true });
    });
    const fresh = await joinClient(server.port, "board-1", "dev-a");
    await oldClosed;

    // 新连接正常 joined，peers 不含自身 source
    const joined = fresh.messages.find((m) => m.type === "joined");
    expect(joined.peers).toEqual(["dev-b"]);
    expect(server.roomSize("board-1")).toBe(2);

    // 顶替不广播 peer-left（成员关系由 peer-joined 覆盖）
    await expect(
      bystander.waitFor((m) => m.type === "peer-left", 300),
    ).rejects.toThrow("waitFor 超时");

    // 新连接可正常收发
    fresh.send({ type: "records", records: [{ id: "dev-a/op-2" }] });
    const received = await bystander.waitFor((m) => m.type === "records");
    expect(received.records).toEqual([{ id: "dev-a/op-2" }]);

    await fresh.close();
    await bystander.close();
  });

  test("心跳踢出不应答 pong 的幽灵连接", async () => {
    server = createRelayServer({ port: 0, heartbeatMs: 100 });
    await server.ready;
    const alive = await joinClient(server.port, "board-1", "dev-alive");

    // 幽灵客户端：ws 库关闭 autoPong，收到 ping 不回 pong，模拟半开死连接
    const ghost = new WsClient(`ws://127.0.0.1:${server.port}`, {
      autoPong: false,
    });
    await new Promise((resolve, reject) => {
      ghost.once("open", resolve);
      ghost.once("error", reject);
    });
    ghost.send(JSON.stringify({ type: "join", boardId: "board-1", source: "dev-ghost" }));
    await alive.waitFor(
      (m) => m.type === "peer-joined" && m.source === "dev-ghost",
    );
    expect(server.roomSize("board-1")).toBe(2);

    // 幽灵被心跳 terminate，其他成员收到 peer-left
    const left = await alive.waitFor(
      (m) => m.type === "peer-left" && m.source === "dev-ghost",
    );
    expect(left.source).toBe("dev-ghost");
    expect(server.roomSize("board-1")).toBe(1);

    // 正常回 pong 的客户端不受心跳影响，仍可收发
    alive.send({ type: "digest", digest: { logSize: 1 } });
    expect(server.roomSize("board-1")).toBe(1);

    await alive.close();
  });

  test("默认绑定 127.0.0.1，显式 host 生效", async () => {
    server = createRelayServer({ port: 0 });
    await server.ready;
    expect(server.address().address).toBe("127.0.0.1");
    await server.close();

    server = createRelayServer({ port: 0, host: "0.0.0.0" });
    await server.ready;
    expect(server.address().address).toBe("0.0.0.0");
    // 显式绑全部接口时本机地址仍可连
    const client = await joinClient(server.port, "board-1", "dev-a");
    expect(server.roomSize("board-1")).toBe(1);
    await client.close();
  });
});
