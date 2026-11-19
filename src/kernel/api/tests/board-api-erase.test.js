// SPDX-License-Identifier: MIT

import { jest } from "@jest/globals";
import { BoardApi } from "../board-api.js";
import { BoardCore } from "../../board/board-core.js";
import { createDefaultAomRenderHooks } from "../../board/aom-render-hooks.js";
import { createDefaultPersistenceAdapter } from "../../board/persistence-adapter.js";
import { Matrix, Vector } from "../../utils/math.js";

function createBoardCore() {
  return new BoardCore({
    width: 800,
    height: 600,
    aomRenderHooks: createDefaultAomRenderHooks(),
    persistenceAdapter: createDefaultPersistenceAdapter(),
  });
}

function horizontalPoints() {
  return [
    { x: 0, y: 100 },
    { x: 10, y: 100 },
    { x: 20, y: 100 },
    { x: 30, y: 100 },
    { x: 40, y: 100 },
  ];
}

function createStaticStroke(api, id, points = horizontalPoints(), property = {}) {
  api.createObject("StrokeObject", {
    id,
    position: { x: 0, y: 0 },
    property: { width: 2, ...property },
    data: { points },
  });
  api.commitObjects([id]);
}

describe("BoardApi.eraseData", () => {
  test("擦除前按候选对象准备覆盖区块驻留并在结束后释放", async () => {
    const boardCore = createBoardCore();
    const api = new BoardApi(boardCore);
    createStaticStroke(api, "s1");

    const release = jest.fn();
    const ensureSpy = jest
      .spyOn(boardCore, "ensureObjectsResident")
      .mockResolvedValue(release);

    await api.eraseData({
      points: [new Vector(5, 95), new Vector(5, 105)],
      radius: 1,
      source: "test",
    });

    expect(ensureSpy).toHaveBeenCalledWith(["s1"], "route:eraseData");
    expect(release).toHaveBeenCalledTimes(1);
    ensureSpy.mockRestore();
  });

  test("擦短一笔时回写剩余点段且对象 id 不变", async () => {
    const boardCore = createBoardCore();
    const api = new BoardApi(boardCore);
    createStaticStroke(api, "s1");

    const result = await api.eraseData({
      points: [new Vector(5, 95), new Vector(5, 105)],
      radius: 1,
      source: "test",
    });

    expect(result.modified).toEqual(["s1"]);
    expect(result.created).toEqual([]);
    expect(result.deleted).toEqual([]);

    const obj = boardCore.getObjectById("s1");
    expect(obj.data.points).toEqual([
      { x: 10, y: 100 },
      { x: 20, y: 100 },
      { x: 30, y: 100 },
      { x: 40, y: 100 },
    ]);
  });

  test("指定会话 key：同一擦除手势的多次擦除即时物化、闭合折叠为一个节点", async () => {
    const boardCore = createBoardCore();
    const api = new BoardApi(boardCore);
    const densePoints = [];
    for (let x = 0; x <= 80; x += 10) {
      densePoints.push({ x, y: 100 });
    }
    createStaticStroke(api, "s1", densePoints);

    api.beginSupra("eraser/1");
    await api.eraseData({
      points: [new Vector(25, 95), new Vector(25, 105)],
      radius: 1,
      source: "test",
    }, { supraKey: "eraser/1" });
    // 三级容器模型：成员即时物化上链（modify + add 两个分子节点），不再缓冲
    expect(boardCore.undoTree.getActiveChain()).toHaveLength(3);
    await api.eraseData({
      points: [new Vector(65, 95), new Vector(65, 105)],
      radius: 1,
      source: "test",
    }, { supraKey: "eraser/1" });
    api.endSupra("eraser/1");

    // 两次擦除的成员同属一个超分子，闭合折叠为一个聚合节点：
    // modify(原笔回写首段) + add(中段分裂) + modify(中段二刀回写) + add(末段分裂)
    expect(boardCore.undoTree.getActiveChain()).toHaveLength(2);
    const head = boardCore.undoTree.head;
    const members = head.memberIds.map((id) => boardCore.operationLog.get(id));
    expect(members).toHaveLength(4);
    expect(new Set(members.map((r) => r.supraId)).size).toBe(1);

    // 一次撤销回退整个擦除手势：原笔恢复
    api.undo();
    expect(boardCore.getObjectById("s1").data.points).toHaveLength(9);
  });

  test("一笔擦成两笔时原对象保留首段，其余段以 Core 来源 id 分裂新建", async () => {
    const boardCore = createBoardCore();
    const api = new BoardApi(boardCore);
    createStaticStroke(api, "s1");

    const result = await api.eraseData({
      points: [new Vector(20, 95), new Vector(20, 105)],
      radius: 1,
      source: "test",
    });

    expect(result.modified).toEqual(["s1"]);
    expect(result.created).toEqual(["test/core/1"]);
    expect(result.deleted).toEqual([]);

    const original = boardCore.getObjectById("s1");
    expect(original.data.points).toEqual([
      { x: 0, y: 100 },
      { x: 10, y: 100 },
    ]);

    const split = boardCore.getObjectById("test/core/1");
    expect(split).toBeDefined();
    expect(split.data.points).toEqual([
      { x: 30, y: 100 },
      { x: 40, y: 100 },
    ]);
    expect(split.property.width).toBe(2);
    expect(boardCore.activeObjectManager.has("test/core/1")).toBe(false);
  });

  test("分裂对象继承原对象的 position 与 transform", async () => {
    const boardCore = createBoardCore();
    const api = new BoardApi(boardCore);

    api.createObject("StrokeObject", {
      id: "s1",
      position: { x: 200, y: 200 },
      transform: { a: 2, b: 0, c: 0, d: 2 },
      property: { width: 1 },
      data: { points: horizontalPoints().map((p) => ({ x: p.x, y: 0 })) },
    });
    api.commitObjects(["s1"]);

    // 世界坐标下笔画位于 (200,200)-(280,200)，轨迹在世界 x=240 处穿越
    const result = await api.eraseData({
      points: [new Vector(240, 195), new Vector(240, 205)],
      radius: 1,
      source: "test",
    });

    expect(result.created).toEqual(["test/core/1"]);

    const split = boardCore.getObjectById("test/core/1");
    expect(split.position).toEqual(new Vector(200, 200));
    expect(split.transform).toEqual(new Matrix(2, 0, 0, 2));
    expect(split.data.points).toEqual([
      { x: 30, y: 0 },
      { x: 40, y: 0 },
    ]);
  });

  test("整笔擦没时对象被删除", async () => {
    const boardCore = createBoardCore();
    const api = new BoardApi(boardCore);
    createStaticStroke(api, "s1");

    const result = await api.eraseData({
      points: [new Vector(-5, 100), new Vector(45, 100)],
      radius: 1,
      source: "test",
    });

    expect(result.deleted).toEqual(["s1"]);
    expect(boardCore.getObjectById("s1")).toBeUndefined();
  });

  test("isErasable 为 false 的对象不受影响", async () => {
    const boardCore = createBoardCore();
    const api = new BoardApi(boardCore);

    api.createObject("CircleObject", {
      id: "c1",
      position: { x: 20, y: 100 },
      property: { fill: "#f00" },
      data: { radius: 10 },
    });
    api.commitObjects(["c1"]);

    const result = await api.eraseData({
      points: [new Vector(20, 95), new Vector(20, 105)],
      radius: 2,
      source: "test",
    });

    expect(result).toEqual({ modified: [], created: [], deleted: [] });
    expect(boardCore.getObjectById("c1").data.radius).toBe(10);
  });

  test("多次增量调用逐段蚕食同一笔画", async () => {
    const boardCore = createBoardCore();
    const api = new BoardApi(boardCore);
    createStaticStroke(api, "s1");

    await api.eraseData({
      points: [new Vector(5, 95), new Vector(5, 105)],
      radius: 1,
      source: "test",
    });
    const second = await api.eraseData({
      points: [new Vector(35, 95), new Vector(35, 105)],
      radius: 1,
      source: "test",
    });

    expect(second.modified).toEqual(["s1"]);
    const obj = boardCore.getObjectById("s1");
    expect(obj.data.points).toEqual([
      { x: 10, y: 100 },
      { x: 20, y: 100 },
      { x: 30, y: 100 },
    ]);
  });

  test("空轨迹或非法半径返回空结果", async () => {
    const boardCore = createBoardCore();
    const api = new BoardApi(boardCore);
    createStaticStroke(api, "s1");

    expect(await api.eraseData({ points: [], radius: 1, source: "t" })).toEqual(
      { modified: [], created: [], deleted: [] },
    );
    expect(
      await api.eraseData({
        points: [new Vector(5, 95)],
        radius: 0,
        source: "t",
      }),
    ).toEqual({ modified: [], created: [], deleted: [] });
  });

  test("不同来源的分裂 id 使用各自独立的分配器", async () => {
    const boardCore = createBoardCore();
    const api = new BoardApi(boardCore);
    createStaticStroke(api, "s1");
    createStaticStroke(api, "s2", [
      { x: 0, y: 200 },
      { x: 10, y: 200 },
      { x: 20, y: 200 },
      { x: 30, y: 200 },
      { x: 40, y: 200 },
    ]);

    const first = await api.eraseData({
      points: [new Vector(20, 95), new Vector(20, 105)],
      radius: 1,
      source: "alice",
    });
    const second = await api.eraseData({
      points: [new Vector(20, 195), new Vector(20, 205)],
      radius: 1,
      source: "bob",
    });

    expect(first.created).toEqual(["alice/core/1"]);
    expect(second.created).toEqual(["bob/core/1"]);
  });

  test("活动对象不能被擦除", async () => {
    const boardCore = createBoardCore();
    const api = new BoardApi(boardCore);

    // 创建但不提交，对象为 AOM 中的活动对象
    api.createObject("StrokeObject", {
      id: "s1",
      position: { x: 0, y: 0 },
      property: { width: 2 },
      data: { points: horizontalPoints() },
    });
    expect(boardCore.activeObjectManager.isActive("s1")).toBe(
      true,
    );

    const result = await api.eraseData({
      points: [new Vector(5, 95), new Vector(5, 105)],
      radius: 1,
      source: "test",
    });

    expect(result).toEqual({ modified: [], created: [], deleted: [] });
    expect(boardCore.getObjectById("s1").data.points).toEqual(
      horizontalPoints(),
    );
  });

  test("非活动层成员可以被擦除", async () => {
    const boardCore = createBoardCore();
    const api = new BoardApi(boardCore);

    // A 在下（横向），B 在上（纵向穿越 A）；先提交 A 再提交 B
    createStaticStroke(api, "A");
    createStaticStroke(api, "B", [
      { x: 20, y: 90 },
      { x: 20, y: 100 },
      { x: 20, y: 110 },
    ]);

    // 选中 A：A 成为活动对象，B 被 pickup 一并纳入为非活动层成员
    await boardCore.activeObjectManager.choose(
      new Set([boardCore.getObjectById("A")]),
    );
    expect(boardCore.activeObjectManager.isActive("A")).toBe(
      true,
    );
    expect(boardCore.activeObjectManager.has("B")).toBe(true);
    expect(boardCore.activeObjectManager.isActive("B")).toBe(
      false,
    );

    // 轨迹同时覆盖 A 与 B 的交点：A 被排除，B 被整笔擦除
    const result = await api.eraseData({
      points: [new Vector(20, 100)],
      radius: 1,
      source: "test",
    });

    expect(result.deleted).toEqual(["B"]);
    expect(result.modified).toEqual([]);
    expect(boardCore.getObjectById("B")).toBeUndefined();
    expect(boardCore.getObjectById("A").data.points).toEqual(
      horizontalPoints(),
    );
  });

  test("并发调用串行化：fire-and-forget 的轨迹段不把分裂对象漏擦", async () => {
    const boardCore = createBoardCore();
    const api = new BoardApi(boardCore);

    const points = [];
    for (let x = 0; x <= 200; x += 10) {
      points.push({ x, y: 100 });
    }
    createStaticStroke(api, "s1", points);

    // 模拟工具的 fire-and-forget：不等待前一条完成就连发全部轨迹段。
    // 先发中段强制分裂，其余段从左到右覆盖整条笔画；
    // 若并发执行，后续调用的候选快照早于分裂提交，新尾巴对象会被漏擦。
    const segmentAt = (x) => ({
      points: [
        { x, y: 100 },
        { x: x + 10, y: 100 },
      ],
      radius: 4,
      source: "test",
    });
    const pending = [api.eraseData(segmentAt(100))];
    for (let x = 0; x <= 190; x += 10) {
      pending.push(api.eraseData(segmentAt(x)));
    }
    await Promise.all(pending);

    expect(boardCore.getObjectById("s1")).toBeUndefined();
    expect(boardCore.objectLoaded.size).toBe(0);
  });

  test("修改静态对象时随渲染请求携带切割前的旧世界范围", async () => {
    const requestStaticRenderForObjects = jest.fn();
    const boardCore = new BoardCore({
      width: 800,
      height: 600,
      aomRenderHooks: {
        ...createDefaultAomRenderHooks(),
        requestStaticRenderForObjects,
      },
      persistenceAdapter: createDefaultPersistenceAdapter(),
    });
    const api = new BoardApi(boardCore);

    const points = [];
    for (let x = 0; x <= 200; x += 10) {
      points.push({ x, y: 100 });
    }
    createStaticStroke(api, "s1", points);
    requestStaticRenderForObjects.mockClear();

    // 竖向一刀切成两段：被擦缺口与残端的旧像素要靠旧范围清理
    await api.eraseData({
      points: [
        { x: 100, y: 90 },
        { x: 100, y: 110 },
      ],
      radius: 4,
      source: "test",
    });

    expect(requestStaticRenderForObjects).toHaveBeenCalled();
    const [modifiedObjects, , previousWorldRects] =
      requestStaticRenderForObjects.mock.calls.at(-1);
    expect(modifiedObjects.map((obj) => obj.id)).toEqual(["s1"]);

    const previousRect = previousWorldRects.get("s1");
    expect(previousRect).toBeDefined();
    expect(previousRect.left).toBeLessThanOrEqual(0);
    expect(previousRect.top).toBeLessThanOrEqual(100);
    expect(previousRect.left + previousRect.width).toBeGreaterThanOrEqual(200);
    expect(previousRect.top + previousRect.height).toBeGreaterThanOrEqual(100);
  });
});

describe("分裂段的层级关系重建", () => {
  const staticGraphsOf = (boardCore) =>
    [...boardCore.chunkLoaded.values()]
      .map(({ chunk }) => chunk?.objectManager?.staticGraph)
      .filter(Boolean);

  /**
   * 任一已加载区块的静态状态图上存在该边
   * @param {BoardCore} boardCore - 白板核心
   * @param {string} from - 边的起点（在下者）
   * @param {string} to - 边的终点（在上者）
   * @returns {boolean} 是否存在
   */
  const hasStaticEdge = (boardCore, from, to) =>
    staticGraphsOf(boardCore).some((graph) => graph.hasEdge(from, to));

  /**
   * 创建并提交静态笔画
   * @param {BoardApi} api - BoardApi 实例
   * @param {string} id - 对象 id
   * @param {Array<{x: number, y: number}>} points - 采样点
   * @returns {Promise<void>}
   */
  const createStatic = async (api, id, points) => {
    api.createObject("StrokeObject", {
      id,
      position: { x: 0, y: 0 },
      property: { width: 2 },
      data: { points },
    });
    await api.commitObjects([id]);
  };

  test("分裂段继承原对象层位，原对象失交删边", async () => {
    const boardCore = createBoardCore();
    const api = new BoardApi(boardCore);
    // s1 在下（y=100 横向），s2 在上（x=35 纵向，与 s1 相交）
    await createStatic(api, "s1", [0, 10, 20, 30, 40].map((x) => ({ x, y: 100 })));
    await createStatic(api, "s2", [{ x: 35, y: 90 }, { x: 35, y: 110 }]);
    expect(hasStaticEdge(boardCore, "s1", "s2")).toBe(true);

    const result = await api.eraseData({
      points: [
        { x: 15, y: 95 },
        { x: 15, y: 105 },
        { x: 25, y: 105 },
        { x: 25, y: 95 },
      ],
      radius: 1,
      source: "test",
    });
    expect(result.created).toHaveLength(1);
    const split = result.created[0];

    // 分裂段继承 s1 的层位：在 s2 之下
    expect(hasStaticEdge(boardCore, split, "s2")).toBe(true);
    expect(hasStaticEdge(boardCore, "s2", split)).toBe(false);
    // s1 残段（x≤10 一带）与 s2（x=35）失交，陈旧边被清理
    expect(hasStaticEdge(boardCore, "s1", "s2")).toBe(false);
  });

  test("无分裂的擦短同样清理失交边", async () => {
    const boardCore = createBoardCore();
    const api = new BoardApi(boardCore);
    await createStatic(api, "s1", [0, 10, 20, 30, 40].map((x) => ({ x, y: 100 })));
    await createStatic(api, "s2", [{ x: 35, y: 90 }, { x: 35, y: 110 }]);
    expect(hasStaticEdge(boardCore, "s1", "s2")).toBe(true);

    // 只擦掉右端（x≥28 一段），s1 缩短但不分裂
    const result = await api.eraseData({
      points: [
        { x: 28, y: 95 },
        { x: 28, y: 105 },
        { x: 42, y: 105 },
        { x: 42, y: 95 },
      ],
      radius: 1,
      source: "test",
    });
    expect(result.created).toHaveLength(0);
    expect(result.modified).toEqual(["s1"]);
    expect(hasStaticEdge(boardCore, "s1", "s2")).toBe(false);
  });

  test("非活动层成员被分裂时，分裂段继承层静态图归属", async () => {
    const boardCore = createBoardCore();
    const api = new BoardApi(boardCore);
    // s1 在下，s2 在上；选择 s1 会把 s2 一并纳入其层的 inactiveGraph
    await createStatic(api, "s1", [0, 10, 20, 30, 40].map((x) => ({ x, y: 100 })));
    await createStatic(api, "s2", [
      { x: 20, y: 90 },
      { x: 20, y: 95 },
      { x: 20, y: 100 },
      { x: 20, y: 105 },
      { x: 20, y: 110 },
    ]);
    await api.addActiveObjects(["s1"]);
    const aom = boardCore.activeObjectManager;
    const layer = aom.onLayer.get("s2");
    expect(layer).toBeDefined();
    expect(layer.inactiveGraph.hasNode("s2")).toBe(true);

    // s2 是非活动层成员（不是活动对象），可擦除
    const result = await api.eraseData({
      points: [
        { x: 15, y: 98 },
        { x: 25, y: 98 },
        { x: 25, y: 102 },
        { x: 15, y: 102 },
      ],
      radius: 1,
      source: "test",
    });
    expect(result.created).toHaveLength(1);
    const split = result.created[0];

    // 分裂段继承 s2 的层归属：进入同一层的 inactiveGraph，不占活动索引
    expect(layer.inactiveGraph.hasNode(split)).toBe(true);
    expect(aom.isActive(split)).toBe(false);
    expect(aom.onLayer.get(split)).toBe(layer);
  });
});
