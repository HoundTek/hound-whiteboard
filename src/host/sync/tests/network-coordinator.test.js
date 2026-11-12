/**
 * @file 网络协调器测试
 * @description 真实中继与双端内核下验证操作同步、并发收敛、迟到 INIT、乱序容忍窗、AOM 远程互斥与在途分子对账重放。
 * @module host/sync/tests/network-coordinator.test
 * @author Zhou Chenyu
 */

import { jest } from "@jest/globals";
import { BoardApi } from "../../../kernel/api/board-api.js";
import { BoardCore } from "../../../kernel/board/board-core.js";
import { createDefaultAomRenderHooks } from "../../../kernel/board/aom-render-hooks.js";
import { createDefaultPersistenceAdapter } from "../../../kernel/board/persistence-adapter.js";
import { createAddObjectOperation } from "../../../kernel/hit/operation.js";
import { createRelayServer } from "../relay-server.js";
import { createNetworkCoordinator } from "../network-coordinator.js";
import { createAmendForwarder } from "../amend-forwarder.js";

/**
 * 创建一个端（独立的 BoardCore 与 BoardApi）
 * @param {string} source - 端标识
 * @returns {{boardCore: BoardCore, api: BoardApi}} 端
 */
function createEnd(source) {
  const boardCore = new BoardCore({
    width: 800,
    height: 600,
    source,
    aomRenderHooks: createDefaultAomRenderHooks(),
    persistenceAdapter: createDefaultPersistenceAdapter(),
  });
  return { boardCore, api: new BoardApi(boardCore) };
}

/**
 * 创建并连接一个端
 * @param {string} source - 端标识
 * @param {number} port - 中继端口
 * @param {string} boardId - 板 id
 * @param {Object} [options={}] - 协调器选项覆盖
 * @returns {Promise<Object>} 已连接端
 */
async function connectEnd(source, port, boardId, options = {}) {
  const end = createEnd(source);
  const coordinator = createNetworkCoordinator({
    boardCore: end.boardCore,
    boardApi: end.api,
    url: `ws://127.0.0.1:${port}`,
    boardId,
    ...options,
  });
  await coordinator.connect();
  return { ...end, coordinator };
}

/**
 * 用既有端的内核重连中继（断线重连场景）
 * @param {{ boardCore: BoardCore, api: BoardApi }} end - 既有端
 * @param {number} port - 中继端口
 * @param {string} boardId - 板 id
 * @param {Object} [options] - 协调器选项
 * @returns {Promise<Object>} 协调器句柄
 */
async function reconnectEnd(end, port, boardId, options = {}) {
  const coordinator = createNetworkCoordinator({
    boardCore: end.boardCore,
    boardApi: end.api,
    url: `ws://127.0.0.1:${port}`,
    boardId,
    ...options,
  });
  await coordinator.connect();
  return coordinator;
}

/**
 * 创建并提交一笔静态笔画
 * @param {BoardApi} api - 内核 API
 * @param {string} id - 对象 id
 * @param {number} [x=0] - 位置 x
 * @returns {Promise<void>}
 */
async function createStroke(api, id, x = 0) {
  api.createObject("StrokeObject", {
    id,
    position: { x, y: 0 },
    property: { width: 2 },
    data: { points: [{ x, y: 0 }, { x: x + 10, y: 0 }] },
  });
  await api.commitObjects([id]);
}

/**
 * 轮询直至条件满足
 * @param {Function} predicate - 判定函数
 * @param {string} label - 条件描述
 * @param {number} [timeoutMs=4000] - 超时
 * @returns {Promise<void>}
 * @description
 * 注意：getObjectById 未命中返回 undefined，判定须用 `!= null`（宽松等）而不是 `!== null`，
 * 否则未命中会被误判为存在。
 */
async function until(predicate, label, timeoutMs = 4000) {
  const start = Date.now();
  for (;;) {
    if (await predicate()) return;
    if (Date.now() - start > timeoutMs) {
      throw new Error(`until 超时：${label}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
}

/**
 * 收集端上日志的全部记录 id
 * @param {BoardCore} boardCore - 白板核心
 * @returns {string[]} 记录 id 数组
 */
function logIds(boardCore) {
  return boardCore.operationLog.toJSON().map((record) => record.id);
}

/**
 * 连接一个裸客户端（绕过协调器，手工收发）
 * @param {number} port - 中继端口
 * @param {string} boardId - 板 id
 * @param {string} source - 来源标识
 * @returns {Promise<Object>} 客户端句柄
 */
async function connectRawClient(port, boardId, source) {
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
  ws.send(JSON.stringify({ type: "join", boardId, source }));
  await until(
    () => messages.some((m) => m.type === "joined"),
    "raw joined",
  );
  return {
    messages,
    send: (message) => ws.send(JSON.stringify(message)),
    close: () =>
      new Promise((resolve) => {
        ws.addEventListener("close", resolve, { once: true });
        ws.close();
      }),
  };
}

describe("网络协调器", () => {
  jest.setTimeout(30000);

  /** @type {Object|null} */
  let server = null;
  /** @type {Object[]} */
  let ends = [];

  afterEach(async () => {
    for (const end of ends) {
      await end.coordinator.close();
    }
    ends = [];
    await server?.close();
    server = null;
  });

  test("双端基本同步：增、改、撤销跨端收敛", async () => {
    server = createRelayServer({ port: 0 });
    await server.ready;
    const a = await connectEnd("a", server.port, "board-1");
    const b = await connectEnd("b", server.port, "board-1");
    ends = [a, b];

    // a 增：b 收敛
    await createStroke(a.api, "a/1");
    await until(
      () => b.boardCore.getObjectById("a/1") != null,
      "b 收到 a/1",
    );

    // b 改（先选择再修改提交）：a 收敛到同位置
    await b.api.addActiveObjects(["a/1"]);
    b.api.modifyObject("a/1", { position: { x: 50, y: 0 } });
    await b.api.commitObjects(["a/1"]);
    await until(
      () => b.boardCore.getObjectById("a/1").position.x === 50,
      "b 本地位置生效",
    );
    await until(
      () => a.boardCore.getObjectById("a/1").position.x === 50,
      "a 收到 b 的修改",
    );

    // a 撤销 b 的修改（显式目标；undo() 缺省为各撤各的，只撤本端节点）
    const bModifyNodeId = a.boardCore.undoTree.head.shareId;
    a.api.undo(bModifyNodeId);
    await until(
      () => a.boardCore.getObjectById("a/1").position.x === 0,
      "a 撤销生效",
    );
    await until(
      () => b.boardCore.getObjectById("a/1").position.x === 0,
      "b 收敛撤销",
    );

    expect(logIds(a.boardCore).sort()).toEqual(logIds(b.boardCore).sort());
  });

  test("毒记录不阻塞房间：不可反序列化载荷降级跳过，后续同步照常", async () => {
    server = createRelayServer({ port: 0 });
    await server.ready;
    const a = await connectEnd("a", server.port, "board-1");
    const b = await connectEnd("b", server.port, "board-1");
    ends = [a, b];

    const warnings = [];
    const warnSpy = jest
      .spyOn(console, "warn")
      .mockImplementation((...args) => warnings.push(args));
    try {
      // a 直接向本端日志追加未知对象类型的 add-object 记录（模拟新版本写入的载荷）：
      // 校验只看载荷结构不查对象类型表，记录合法入日志并广播
      a.boardCore.operationLog.append(
        createAddObjectOperation({
          id: "a/op-1",
          source: "a",
          time: Date.now(),
          parentId: null,
          chunkId: "1",
          objectId: "a/future-1",
          data: { type: "FutureObject", id: "a/future-1" },
        }),
      );

      // 毒记录接入 b 的日志（不可回退），但不产生对象、不抛出；降级告警留痕
      await until(() => logIds(b.boardCore).includes("a/op-1"), "b 接入毒记录");
      await until(() => warnings.length > 0, "降级告警留痕");
      expect(b.boardCore.getObjectById("a/future-1") == null).toBe(true);

      // 后续记录照常双向流动（毒记录未堵死房间）
      await createStroke(a.api, "a/2");
      await until(() => b.boardCore.getObjectById("a/2") != null, "b 收到 a/2");
      await createStroke(b.api, "b/1");
      await until(() => a.boardCore.getObjectById("b/1") != null, "a 收到 b/1");
    } finally {
      warnSpy.mockRestore();
    }
  });

  test("双协调器共享日志时交替推进同一来源，重复 INIT 后无待接入残留", async () => {
    server = createRelayServer({ port: 0 });
    await server.ready;
    const remote = createEnd("x");
    await createStroke(remote.api, "x/1");
    const op1 = remote.boardCore.operationLog.get("x/op-1");
    await createStroke(remote.api, "x/2", 100);
    const op2 = remote.boardCore.operationLog.get("x/op-2");

    const shared = createEnd("shared");
    const first = createNetworkCoordinator({
      boardCore: shared.boardCore,
      boardApi: shared.api,
      url: `ws://127.0.0.1:${server.port}`,
      boardId: "room-1",
    });
    const second = createNetworkCoordinator({
      boardCore: shared.boardCore,
      boardApi: shared.api,
      url: `ws://127.0.0.1:${server.port}`,
      boardId: "room-2",
    });
    await first.connect();
    await second.connect();
    ends.push({ coordinator: first }, { coordinator: second });
    const raw1 = await connectRawClient(server.port, "room-1", "x");
    const raw2 = await connectRawClient(server.port, "room-2", "x");

    raw1.send({ type: "records", records: [op1] });
    await until(() => shared.boardCore.operationLog.has("x/op-1"), "通道一接入 op-1");
    raw2.send({ type: "records", records: [op1, op2] });
    await until(() => shared.boardCore.operationLog.has("x/op-2"), "通道二接入 op-2");
    raw2.send({ type: "records", records: [op1, op2] });

    expect(logIds(shared.boardCore)).toEqual(["x/op-1", "x/op-2"]);
    expect(second.pendingCount).toBe(0);
    expect(shared.boardCore.getObjectById("x/1")).toBeDefined();
    expect(shared.boardCore.getObjectById("x/2")).toBeDefined();
    await raw1.close();
    await raw2.close();
  });

  test("并发创建：两端各自新增后互见对方对象", async () => {
    server = createRelayServer({ port: 0 });
    await server.ready;
    const a = await connectEnd("a", server.port, "board-1");
    const b = await connectEnd("b", server.port, "board-1");
    ends = [a, b];

    await Promise.all([
      createStroke(a.api, "a/1", 0),
      createStroke(b.api, "b/1", 100),
    ]);

    await until(
      () =>
        a.boardCore.getObjectById("b/1") != null &&
        b.boardCore.getObjectById("a/1") != null,
      "双端互见",
    );
    expect(logIds(a.boardCore).sort()).toEqual(logIds(b.boardCore).sort());
  });

  test("迟到加入经 INIT 全量收敛", async () => {
    server = createRelayServer({ port: 0 });
    await server.ready;
    const a = await connectEnd("a", server.port, "board-1");
    ends = [a];
    await createStroke(a.api, "a/1", 0);
    await createStroke(a.api, "a/2", 20);

    const c = await connectEnd("c", server.port, "board-1");
    ends.push(c);
    await until(
      () => c.boardCore.operationLog.size === 2,
      "c 经 INIT 补齐日志",
    );
    expect(c.boardCore.getObjectById("a/1")).toBeDefined();
    expect(c.boardCore.getObjectById("a/2")).toBeDefined();
  });

  test("乱序记录经容忍窗缓冲整理", async () => {
    server = createRelayServer({ port: 0 });
    await server.ready;
    const a = await connectEnd("a", server.port, "board-1", {
      windowMs: 100,
    });
    ends = [a];

    // 第三端离线造两条记录，手工乱序投递
    const x = createEnd("x");
    await createStroke(x.api, "x/1", 0);
    await createStroke(x.api, "x/2", 20);
    const [op1, op2] = x.boardCore.operationLog.toJSON();

    const raw = await connectRawClient(server.port, "board-1", "x");
    raw.send({ type: "records", records: [op2] });
    await until(() => a.coordinator.pendingCount === 1, "op-2 入缓冲");
    expect(a.boardCore.getObjectById("x/2")).toBeUndefined();

    raw.send({ type: "records", records: [op1] });
    await until(
      () =>
        a.boardCore.getObjectById("x/1") != null &&
        a.boardCore.getObjectById("x/2") != null,
      "乱序整理后两条都应用",
    );
    expect(a.coordinator.pendingCount).toBe(0);

    await raw.close();
  });

  test("持续乱序超窗后请求全量", async () => {
    server = createRelayServer({ port: 0 });
    await server.ready;
    const a = await connectEnd("a", server.port, "board-1", {
      windowMs: 50,
      maxWindows: 2,
    });
    ends = [a];

    const x = createEnd("x");
    await createStroke(x.api, "x/1", 0);
    await createStroke(x.api, "x/2", 20);
    const [, op2] = x.boardCore.operationLog.toJSON();

    const raw = await connectRawClient(server.port, "board-1", "x");
    raw.send({ type: "records", records: [op2] });
    // op-1 永远不到：超窗后 a 广播 request-init
    await until(
      () => raw.messages.some((m) => m.type === "request-init"),
      "超窗后请求全量",
      4000,
    );

    await raw.close();
  });

  test("同 source 新会话顶替时清除旧连接遗留活动锁", async () => {
    server = createRelayServer({ port: 0 });
    await server.ready;
    const a = await connectEnd("a", server.port, "board-1");
    const b = await connectEnd("b", server.port, "board-1");
    ends = [a, b];
    await createStroke(a.api, "a/1");
    await until(() => b.boardCore.getObjectById("a/1") != null, "对象同步");
    await a.api.addActiveObjects(["a/1"], { choice: "hold" });
    await until(
      () => b.boardCore.activeObjectManager.isRemoteActive("a/1"),
      "旧连接活动锁",
    );

    const replacement = await connectEnd("a", server.port, "board-1");
    ends.push(replacement);
    await until(
      () => !b.boardCore.activeObjectManager.isRemoteActive("a/1"),
      "新会话不继承旧活动锁",
    );
  });

  test("同一来源经双通道到达时，单通道离开不清除健康通道活动锁", async () => {
    server = createRelayServer({ port: 0 });
    await server.ready;
    const shared = createEnd("shared");
    const first = createNetworkCoordinator({
      boardCore: shared.boardCore,
      boardApi: shared.api,
      url: `ws://127.0.0.1:${server.port}`,
      boardId: "room-1",
    });
    const second = createNetworkCoordinator({
      boardCore: shared.boardCore,
      boardApi: shared.api,
      url: `ws://127.0.0.1:${server.port}`,
      boardId: "room-2",
    });
    await first.connect();
    await second.connect();
    ends.push({ coordinator: first }, { coordinator: second });
    const raw1 = await connectRawClient(server.port, "room-1", "x");
    const raw2 = await connectRawClient(server.port, "room-2", "x");
    const event = { kind: "choose", ids: ["x/1"] };
    raw1.send({ type: "aom", event });
    raw2.send({ type: "aom", event });
    await until(
      () => shared.boardCore.activeObjectManager.isRemoteActive("x/1"),
      "双通道活动锁",
    );

    await raw1.close();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(shared.boardCore.activeObjectManager.isRemoteActive("x/1")).toBe(true);
    await first.close();
    expect(shared.boardCore.activeObjectManager.isRemoteActive("x/1")).toBe(true);
    await second.close();
    await until(
      () => !shared.boardCore.activeObjectManager.isRemoteActive("x/1"),
      "主动关闭最后通道才清锁",
    );
    await raw2.close();
  });

  test("AOM 远程活动跨端互斥：远程 choose 锁定、unchoose 解锁", async () => {
    server = createRelayServer({ port: 0 });
    await server.ready;
    const a = await connectEnd("a", server.port, "board-1");
    const b = await connectEnd("b", server.port, "board-1");
    ends = [a, b];

    await createStroke(a.api, "a/1");
    await until(
      () => b.boardCore.getObjectById("a/1") != null,
      "b 收到 a/1",
    );

    await a.api.addActiveObjects(["a/1"]);
    await until(
      () => b.boardCore.activeObjectManager.isRemoteActive("a/1"),
      "b 登记远程活动",
    );

    // b 不可擦除远程活跃对象
    const erased = await b.api.eraseData({
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
      radius: 5,
    });
    expect(erased.deleted).toEqual([]);

    await a.api.discardActiveObjects(["a/1"]);
    await until(
      () => !b.boardCore.activeObjectManager.isRemoteActive("a/1"),
      "b 解锁",
    );
  });

  test("命名选择经中继同步：choose 事件携带 choice", async () => {
    server = createRelayServer({ port: 0 });
    await server.ready;
    const a = await connectEnd("a", server.port, "board-1");
    const b = await connectEnd("b", server.port, "board-1");
    ends = [a, b];

    await createStroke(a.api, "a/1");
    await until(
      () => b.boardCore.getObjectById("a/1") != null,
      "b 收到 a/1",
    );

    await a.api.addActiveObjects(["a/1"], { choice: "hold" });
    await until(
      () =>
        b.boardCore.activeObjectManager.remoteChoicesOf("a/1").length > 0,
      "b 登记远程命名选择",
    );
    expect(b.boardCore.activeObjectManager.remoteChoicesOf("a/1")).toEqual([
      { source: "a", name: "hold" },
    ]);

    // a 提交后 b 的命名选择注销
    await a.api.commitObjects(["a/1"]);
    await until(
      () => !b.boardCore.activeObjectManager.isRemoteActive("a/1"),
      "b 注销命名选择",
    );
  });

  test("awareness 消息经中继 volatile 转发，不进日志", async () => {
    server = createRelayServer({ port: 0 });
    await server.ready;
    /** @type {Object[]} */
    const received = [];
    const a = await connectEnd("a", server.port, "board-1");
    const b = await connectEnd("b", server.port, "board-1", {
      onAwareness: (message) => received.push(message),
    });
    ends = [a, b];

    const logSizeBefore = b.boardCore.operationLog.size;
    a.coordinator.sendAwareness({ kind: "cursor", point: { x: 3, y: 4 } });

    await until(() => received.length > 0, "b 收到 awareness");
    expect(received[0]).toEqual({
      source: "a",
      data: { kind: "cursor", point: { x: 3, y: 4 } },
    });
    // volatile：不写日志、不参与收敛
    expect(b.boardCore.operationLog.size).toBe(logSizeBefore);

    // peer-left 也以 awareness 形式通知（光标清场用）
    await a.coordinator.close();
    await until(
      () => received.some((m) => m.data?.kind === "peer-left"),
      "b 收到 peer-left 通知",
    );
  });

  test("手势 amend 流经 volatile 通道跨端到达（mol 预览）", async () => {
    server = createRelayServer({ port: 0 });
    await server.ready;
    /** @type {Object[]} */
    const received = [];
    const a = await connectEnd("a", server.port, "board-1");
    const b = await connectEnd("b", server.port, "board-1", {
      onAwareness: (message) => received.push(message),
    });
    ends = [a, b];

    // a 侧挂 amend 转发器（core-worker/daemon 同款接线）
    const forwarder = createAmendForwarder({
      boardCore: a.boardCore,
      sendAwareness: (data) => a.coordinator.sendAwareness(data),
      intervalMs: 20,
    });

    await createStroke(a.api, "a/1");
    await until(
      () => b.boardCore.getObjectById("a/1") != null,
      "b 收到 a/1",
    );

    // a 侧手势：beginMol 后连续 amend（原子流不进日志）
    await a.api.addActiveObjects(["a/1"]);
    const logSizeBefore = a.boardCore.operationLog.size;
    const molId = a.api.beginMol(["a/1"]);
    a.api.amendMol(molId, { "a/1": { position: { x: 50, y: 0 } } });
    a.api.amendMol(molId, { "a/1": { position: { x: 80, y: 0 } } });

    await until(
      () => received.some((m) => m.data?.kind === "mol-amend"),
      "b 收到 amend 流",
    );
    const beginMsg = received.find((m) => m.data?.kind === "mol-begin");
    expect(beginMsg.source).toBe("a");
    expect(beginMsg.data.molId).toBe(molId);
    expect(beginMsg.data.entries[0].objectId).toBe("a/1");
    const amendFrames = received
      .filter((m) => m.data?.kind === "mol-amend")
      .flatMap((m) => m.data.mols)
      .filter((frame) => frame.molId === molId);
    // 同步两帧合批为一段：seq 取批内最大，position 后帧盖前帧
    expect(amendFrames).toHaveLength(1);
    expect(amendFrames[0].seq).toBe(2);
    expect(amendFrames[0].entries[0].patch.position).toEqual({ x: 80, y: 0 });
    // amend 流不进日志（手势未定稿）
    expect(a.boardCore.operationLog.size).toBe(logSizeBefore);

    // endMol 物化后 b 经日志收敛到最终位置
    a.api.endMol(molId);
    await until(
      () => received.some((m) => m.data?.kind === "mol-end"),
      "b 收到 mol-end",
    );
    await until(
      () => b.boardCore.getObjectById("a/1").position.x === 80,
      "b 收敛定稿位置",
    );

    forwarder.close();
  });

  test("创建中对象的 amend 流跨端到达（创建预览）", async () => {
    server = createRelayServer({ port: 0 });
    await server.ready;
    /** @type {Object[]} */
    const received = [];
    const a = await connectEnd("a", server.port, "board-1");
    const b = await connectEnd("b", server.port, "board-1", {
      onAwareness: (message) => received.push(message),
    });
    ends = [a, b];

    const forwarder = createAmendForwarder({
      boardCore: a.boardCore,
      sendAwareness: (data) => a.coordinator.sendAwareness(data),
      intervalMs: 20,
    });

    // a 侧创建笔画并开创建型分子追点（对象尚未提交，b 端日志无此对象）
    a.api.createObject("StrokeObject", {
      id: "a/9",
      position: { x: 100, y: 100 },
      property: { width: 2 },
      data: { points: [{ x: 0, y: 0 }] },
    });
    const molId = a.api.beginMol(["a/9"], { create: true });
    a.api.amendMol(molId, {
      "a/9": { data: { points: [{ x: 0, y: 0 }, { x: 10, y: 0 }] } },
    });

    await until(
      () => received.some((m) => m.data?.kind === "mol-amend"),
      "b 收到创建 amend 流",
    );
    const beginMsg = received.find((m) => m.data?.kind === "mol-begin");
    const entry = beginMsg.data.entries.find((e) => e.objectId === "a/9");
    // 创建型分子：before 为 null，create 快照供对端画创建中形态
    expect(entry.before).toBeNull();
    expect(entry.create).toMatchObject({
      type: "StrokeObject",
      position: { x: 100, y: 100 },
    });
    const amendFrame = received
      .filter((m) => m.data?.kind === "mol-amend")
      .flatMap((m) => m.data.mols)
      .find((frame) => frame.molId === molId);
    expect(amendFrame.entries[0].patch.data.points).toHaveLength(2);
    // b 端日志无此对象（创建未提交，预览不进日志）
    expect(
      b.boardCore.operationLog
        .toJSON()
        .filter((r) => r.payload?.objectId === "a/9"),
    ).toHaveLength(0);

    // 中止：暂存对象随分子移除，b 收到 mol-abort
    a.api.abortMol(molId);
    await until(
      () => received.some((m) => m.data?.kind === "mol-abort"),
      "b 收到 mol-abort",
    );
    expect(a.boardCore.getObjectById("a/9")).toBeUndefined();

    forwarder.close();
  });

  test("摘要分歧触发全量重建请求", async () => {
    server = createRelayServer({ port: 0 });
    await server.ready;
    const a = await connectEnd("a", server.port, "board-1");
    ends = [a];

    const raw = await connectRawClient(server.port, "board-1", "watcher");
    raw.send({
      type: "digest",
      digest: { logSize: 999, head: "watcher/op-999", objects: 0 },
    });
    await until(
      () =>
        raw.messages.some(
          (m) => m.type === "request-init",
        ),
      "摘要落后触发 request-init",
    );

    await raw.close();
  });

  test("效果层分歧经 digest 校验和发现并自愈", async () => {
    server = createRelayServer({ port: 0 });
    await server.ready;
    const a = await connectEnd("a", server.port, "board-1", {
      digestIntervalMs: 50,
    });
    const b = await connectEnd("b", server.port, "board-1", {
      digestIntervalMs: 50,
    });
    ends = [a, b];

    await createStroke(a.api, "a/1", 5);
    await until(() => b.boardCore.getObjectById("a/1") != null, "b 收到 a/1");
    await until(
      () => a.api.queryStateHash() === b.api.queryStateHash(),
      "两端校验和一致",
    );

    // 注入效果层分歧（绕过记录直接改实例）：日志逐字节一致但效果未放全的形态
    b.boardCore.getObjectById("a/1").position.x = 999;
    expect(a.api.queryStateHash()).not.toBe(b.api.queryStateHash());

    // digest 往返后 b 端从日志重放自愈：校验和与对象数据重新一致
    await until(
      () => a.api.queryStateHash() === b.api.queryStateHash(),
      "b 端自愈后校验和重新一致",
    );
    expect(b.boardCore.getObjectById("a/1").position.x).toBe(5);
  });

  test("派生链校验和分歧直接本地重建，不重复请求相同日志", async () => {
    server = createRelayServer({ port: 0 });
    await server.ready;
    const a = await connectEnd("a", server.port, "board-1");
    ends = [a];
    const repair = a.api.repairChainFromLog;
    let repairCalls = 0;
    a.api.repairChainFromLog = () => {
      repairCalls += 1;
      return repair.call(a.api);
    };

    const raw = await connectRawClient(server.port, "board-1", "watcher");
    raw.messages.length = 0;
    raw.send({
      type: "digest",
      digest: {
        logSize: a.boardCore.operationLog.size,
        head: a.boardCore.undoTree.head?.shareId ?? null,
        chainHash: "bogus-chain-hash",
        fullResidency: false,
        objects: 0,
      },
    });
    await until(() => repairCalls === 1, "链校验和分歧触发本地重建");
    expect(raw.messages.some((m) => m.type === "request-init")).toBe(false);
    await raw.close();
  });

  test("部分驻留端跳过内容校验和比对：不误报、不物化、不请求全量", async () => {
    server = createRelayServer({ port: 0 });
    await server.ready;
    const a = await connectEnd("a", server.port, "board-1", {
      digestIntervalMs: 50,
    });
    const b = await connectEnd("b", server.port, "board-1", {
      digestIntervalMs: 50,
    });
    ends = [a, b];

    await createStroke(a.api, "a/1", 5);
    await until(() => b.boardCore.getObjectById("a/1") != null, "b 收到 a/1");

    // b 端模拟区块卸载 → 部分驻留：两端内容校验和必然不同（旧行为会每轮误报并全量物化）
    const chunkId = [...b.boardCore.chunkLoaded.keys()][0];
    b.boardCore.chunkLoaded.get(chunkId).fullLoadedCount = 0;
    b.boardCore.getChunkById(chunkId).isLoad = false;
    b.boardCore.unloadChunkObjectEntries(chunkId);
    expect(b.boardCore.isFullResidency()).toBe(false);
    expect(a.api.queryStateHash()).not.toBe(b.api.queryStateHash());

    // 多轮 digest 后：不触发修复（对象不回内存），两端日志仍一致（未触发全量重建）
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(b.boardCore.getObjectById("a/1") == null).toBe(true);
    expect(logIds(a.boardCore).sort()).toEqual(logIds(b.boardCore).sort());
  });

  test("断线触发 onDisconnect 且清理订阅，主动 close 不触发", async () => {
    server = createRelayServer({ port: 0 });
    await server.ready;
    let disconnects = 0;
    const a = await connectEnd("a", server.port, "board-1", {
      onDisconnect: () => {
        disconnects += 1;
      },
    });
    ends = [a];

    // 中继整体下线（对端套接字被终止 → 本端收到 close）
    await server.close();
    await until(() => disconnects === 1, "onDisconnect 触发");
    expect(a.coordinator.state).toBe("closed");

    // 断线后本地操作继续入本地日志（不报错、不广播）
    await createStroke(a.api, "a/1");
    expect(a.boardCore.operationLog.size).toBe(1);

    // 主动关闭不再触发 onDisconnect
    const b = createEnd("b");
    const coordinatorB = createNetworkCoordinator({
      boardCore: b.boardCore,
      boardApi: b.api,
      url: `ws://127.0.0.1:1`,
      boardId: "board-1",
      onDisconnect: () => {
        disconnects += 1;
      },
    });
    await coordinatorB.close();
    expect(disconnects).toBe(1);
  });

  test("离线编辑与重连合并：双端离线增删改撤销后收敛", async () => {
    server = createRelayServer({ port: 0 });
    await server.ready;
    const a = await connectEnd("a", server.port, "board-1");
    const b = await connectEnd("b", server.port, "board-1");
    ends = [a, b];

    // 在线基线：a/1 同步到双端
    await createStroke(a.api, "a/1");
    await until(
      () => b.boardCore.getObjectById("a/1") != null,
      "b 收到 a/1",
    );

    // 中继下线，双端各自离线编辑
    await server.close();

    await createStroke(a.api, "a/2", 20);
    await a.api.addActiveObjects(["a/1"]);
    a.api.modifyObject("a/1", { position: { x: 50, y: 0 } });
    await a.api.commitObjects(["a/1"]);
    // 离线撤销刚才对 a/1 的修改
    a.api.undo();

    await createStroke(b.api, "b/1", 40);
    await b.api.addActiveObjects(["a/1"]);
    b.api.modifyObject("a/1", { position: { x: 80, y: 0 } });
    await b.api.commitObjects(["a/1"]);

    // 中继恢复，双端重连（新实例）
    server = createRelayServer({ port: 0 });
    await server.ready;
    const port = server.port;
    ends = [
      { ...a, coordinator: await reconnectEnd(a, port, "board-1") },
      { ...b, coordinator: await reconnectEnd(b, port, "board-1") },
    ];

    // 双向增量补发后收敛：日志 id 集合一致、HEAD 一致、对象状态一致
    const idsOf = (end) =>
      new Set(end.boardCore.operationLog.toJSON().map((r) => r.id));
    await until(
      () => {
        const ai = idsOf(a);
        const bi = idsOf(b);
        if (ai.size !== bi.size) return false;
        for (const id of ai) if (!bi.has(id)) return false;
        return true;
      },
      "双端日志收敛",
    );

    const headOf = (end) => end.boardCore.undoTree.head?.shareId ?? null;
    expect(headOf(a)).toBe(headOf(b));
    expect(a.boardCore.getObjectById("a/1")?.position.serialize()).toEqual(
      b.boardCore.getObjectById("a/1")?.position.serialize(),
    );
    expect(a.boardCore.getObjectById("a/2")?.position.serialize()).toEqual(
      b.boardCore.getObjectById("a/2")?.position.serialize(),
    );
    expect(a.boardCore.getObjectById("b/1")?.position.serialize()).toEqual(
      b.boardCore.getObjectById("b/1")?.position.serialize(),
    );
  });

  test("重连后 AOM 远程选择经重广播重建", async () => {
    server = createRelayServer({ port: 0 });
    await server.ready;
    const a = await connectEnd("a", server.port, "board-1");
    const b = await connectEnd("b", server.port, "board-1");
    ends = [a, b];

    await createStroke(a.api, "a/1");
    await until(
      () => b.boardCore.getObjectById("a/1") != null,
      "b 收到 a/1",
    );

    // b 命名选择 a/1，a 端登记远程持有
    await b.api.addActiveObjects(["a/1"], { choice: "hold" });
    await until(
      () =>
        a.boardCore.activeObjectManager.remoteChoicesOf("a/1").length > 0,
      "a 登记 b 的远程持有",
    );

    // 中继下线：a 端远程持有被断线清理
    await server.close();
    await until(
      () =>
        a.boardCore.activeObjectManager.remoteChoicesOf("a/1").length === 0,
      "a 端远程持有被清理",
    );
    // b 端本地持有不受断线影响（AOM 是本地状态）
    expect(b.api.queryChoices()).toHaveLength(1);

    // 中继恢复重连：b 重广播持有，a 端重建（名字保留）
    server = createRelayServer({ port: 0 });
    await server.ready;
    const port = server.port;
    ends = [
      { ...a, coordinator: await reconnectEnd(a, port, "board-1") },
      { ...b, coordinator: await reconnectEnd(b, port, "board-1") },
    ];
    await until(
      () =>
        a.boardCore.activeObjectManager.remoteChoicesOf("a/1").length > 0,
      "a 端重建远程持有",
    );
    expect(a.boardCore.activeObjectManager.remoteChoicesOf("a/1")).toEqual([
      { source: "b", name: "hold" },
    ]);
  });

  test("增量 INIT：respond-init 仅携带 lastSeen 之后的缺口记录", async () => {
    server = createRelayServer({ port: 0 });
    await server.ready;
    const a = await connectEnd("a", server.port, "board-1");
    ends = [a];

    await createStroke(a.api, "a/1");
    await createStroke(a.api, "a/2", 20);
    await createStroke(a.api, "a/3", 40);

    // 裸客户端请求增量：lastSeen 覆盖前两条，只应收到第三条
    const raw = await connectRawClient(server.port, "board-1", "watcher");
    raw.send({
      type: "request-init",
      lastSeen: { a: 2 },
    });
    await until(
      () => raw.messages.some((m) => m.type === "respond-init"),
      "watcher 收到增量响应",
    );
    const respond = raw.messages.find((m) => m.type === "respond-init");
    expect(respond.records.map((r) => r.id)).toEqual(["a/op-3"]);
    await raw.close();
  });

  test("未闭合分子清单对账 + amend 重放重建进行时视图", async () => {
    server = createRelayServer({ port: 0 });
    await server.ready;
    const a = await connectEnd("a", server.port, "board-1");
    ends = [a];

    // a 在 b 缺席期间开分子并 amend 若干（无 forwarder，无实时广播）
    await createStroke(a.api, "a/1");
    await a.api.addActiveObjects(["a/1"]);
    const molId = a.api.beginMol(["a/1"]);
    a.api.amendMol(molId, { "a/1": { position: { x: 30, y: 0 } } });
    a.api.amendMol(molId, { "a/1": { position: { x: 60, y: 0 } } });

    // b 迟到加入：握手互换清单，a 对账发现 b 无此分子 → 重放 begin + 全部 amend 段
    /** @type {Object[]} */
    const received = [];
    const b = await connectEnd("b", server.port, "board-1", {
      onAwareness: (message) => received.push(message),
    });
    ends.push(b);

    await until(
      () => received.some((m) => m.data?.kind === "mol-amend"),
      "b 收到对账重放的 amend 段",
    );
    const beginMsg = received.find((m) => m.data?.kind === "mol-begin");
    expect(beginMsg.source).toBe("a");
    expect(beginMsg.data.molId).toBe(molId);
    expect(beginMsg.data.entries).toHaveLength(1);
    expect(beginMsg.data.entries[0].objectId).toBe("a/1");
    expect(beginMsg.data.entries[0].before).not.toBeNull();
    const amendFrames = received
      .filter((m) => m.data?.kind === "mol-amend")
      .flatMap((m) => m.data.mols)
      .filter((frame) => frame.molId === molId);
    expect(amendFrames.map((frame) => frame.seq)).toEqual([1, 2]);
    expect(amendFrames[1].entries[0].patch.position).toEqual({ x: 60, y: 0 });
  });

  test("真实接收端在 INIT 中上报远端分子 seq 水位", async () => {
    server = createRelayServer({ port: 0, requestInitMinIntervalMs: 0 });
    await server.ready;
    const a = await connectEnd("a", server.port, "board-1");
    const b = await connectEnd("b", server.port, "board-1");
    ends = [a, b];
    await createStroke(a.api, "a/1");
    await until(() => b.boardCore.getObjectById("a/1") != null, "基线对象同步");
    const forwarder = createAmendForwarder({
      boardCore: a.boardCore,
      sendAwareness: (data) => a.coordinator.sendAwareness(data),
    });
    try {
      await a.api.addActiveObjects(["a/1"]);
      const molId = a.api.beginMol(["a/1"]);
      a.api.amendMol(molId, { "a/1": { position: { x: 20, y: 0 } } });
      await new Promise((resolve) => setTimeout(resolve, 60));
      const watcher = await connectRawClient(server.port, "board-1", "watcher");
      await until(
        () => watcher.messages.some((message) =>
          message.type === "request-init" &&
          message.source === "b" &&
          message.openMols?.some((mol) => mol.molId === molId && mol.seq === 1)
        ),
        "接收端广告真实远端预览水位",
      );
      await watcher.close();
    } finally {
      forwarder.close();
    }
  });

  test("对账只补对端 seq 之后的 amend 段（已持 begin 不重发）", async () => {
    server = createRelayServer({ port: 0 });
    await server.ready;
    const a = await connectEnd("a", server.port, "board-1");
    ends = [a];

    await createStroke(a.api, "a/1");
    await a.api.addActiveObjects(["a/1"]);
    const molId = a.api.beginMol(["a/1"]);
    a.api.amendMol(molId, { "a/1": { position: { x: 10, y: 0 } } });
    a.api.amendMol(molId, { "a/1": { position: { x: 20, y: 0 } } });
    a.api.amendMol(molId, { "a/1": { position: { x: 30, y: 0 } } });

    // 对端清单声明已持该分子且 seq=1：只应收到 2、3 段，不重发 mol-begin
    const raw = await connectRawClient(server.port, "board-1", "watcher");
    raw.send({
      type: "request-init",
      lastSeen: { a: 1 },
      openMols: [
        {
          molId,
          supraKey: null,
          create: false,
          seq: 1,
          entries: [{ objectId: "a/1", before: null }],
        },
      ],
    });
    await until(
      () =>
        raw.messages.some(
          (m) => m.type === "awareness" && m.data?.kind === "mol-amend",
        ),
      "watcher 收到缺失 amend 段",
    );
    const amendMsg = raw.messages.find(
      (m) => m.type === "awareness" && m.data?.kind === "mol-amend",
    );
    const frames = amendMsg.data.mols.filter((frame) => frame.molId === molId);
    expect(frames.map((frame) => frame.seq)).toEqual([2, 3]);
    expect(
      raw.messages.some(
        (m) => m.type === "awareness" && m.data?.kind === "mol-begin",
      ),
    ).toBe(false);

    await raw.close();
  });
});
