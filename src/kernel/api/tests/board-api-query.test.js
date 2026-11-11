// SPDX-License-Identifier: MIT

/**
 * @file BoardApi 查询与组合方法测试
 * @description 验证 addObject（持板侧原子分配）与 queryBoardInfo/queryObjectList/queryObject 查询面。
 * @module kernel/api/tests/board-api-query.test
 * @author Zhou Chenyu
 */

import { BoardApi } from "../board-api.js";
import { BoardCore } from "../../board/board-core.js";
import { createDefaultAomRenderHooks } from "../../board/aom-render-hooks.js";
import { createDefaultPersistenceAdapter } from "../../board/persistence-adapter.js";

/**
 * 创建一个内存端
 * @param {string} source - 端标识
 * @returns {{ boardCore: BoardCore, api: BoardApi }} 端
 */
function createEnd(source = "test") {
  const boardCore = new BoardCore({
    width: 800,
    height: 600,
    source,
    aomRenderHooks: createDefaultAomRenderHooks(),
    persistenceAdapter: createDefaultPersistenceAdapter(),
  });
  return { boardCore, api: new BoardApi(boardCore) };
}

/** 示例笔画数据 */
const STROKE_DATA = {
  points: [
    { x: 10, y: 10, pressure: 0.5 },
    { x: 30, y: 20, pressure: 0.5 },
  ],
  color: "#000",
  width: 2,
};

describe("BoardApi.addObject", () => {
  test("持板侧原子完成 id 分配、创建与提交，id 随调用续号", async () => {
    const { api } = createEnd("test");
    const id1 = await api.addObject("StrokeObject", { data: { ...STROKE_DATA } });
    const id2 = await api.addObject("StrokeObject", { data: { ...STROKE_DATA } });
    expect(id1).toBe("test/1");
    expect(id2).toBe("test/2");
    expect(api.queryObjectList().objects).toHaveLength(2);
    expect(api.queryBoardInfo().records).toBe(2);
  });

  test("续号基于已上报的对象 id 计数器", async () => {
    const { api } = createEnd("test");
    api.reportObjectIdCounter("test", 41);
    const id = await api.addObject("StrokeObject", { data: { ...STROKE_DATA } });
    expect(id).toBe("test/42");
  });

  test("并发 addObject 不撞号：分配串行化，全部成功且 id 唯一", async () => {
    const { api } = createEnd("test");
    const ids = await Promise.all(
      Array.from({ length: 8 }, () =>
        api.addObject("StrokeObject", { data: { ...STROKE_DATA } }),
      ),
    );
    expect(new Set(ids).size).toBe(8);
    expect(ids.sort()).toEqual(
      Array.from({ length: 8 }, (_, i) => `test/${i + 1}`),
    );
    expect(api.queryObjectList().objects).toHaveLength(8);
    expect(api.queryBoardInfo().records).toBe(8);
  });
});

describe("BoardApi 查询面", () => {
  test("queryBoardInfo 汇总 meta、日志规模、HEAD 与计数", async () => {
    const { api } = createEnd("test");
    const id = await api.addObject("StrokeObject", { data: { ...STROKE_DATA } });
    const info = api.queryBoardInfo();
    expect(info.records).toBe(1);
    expect(info.objects).toBe(1);
    expect(info.trash).toBe(0);
    expect(info.head).toBe("test/op-1");
    expect(info.objectIdCounters.test).toBe(1);
  });

  test("queryObjectList 区分活动与 trash；撤销创建不进回收站，删除进回收站", async () => {
    const { api } = createEnd("test");
    const id = await api.addObject("StrokeObject", { data: { ...STROKE_DATA } });
    let list = api.queryObjectList();
    expect(list.objects.map((o) => o.id)).toEqual([id]);
    expect(list.trash).toEqual([]);

    // 撤销创建：对象从未来过，不进回收站
    await api.undo();
    list = api.queryObjectList();
    expect(list.objects).toEqual([]);
    expect(list.trash).toEqual([]);

    // 删除进回收站；撤销删除恢复出册
    await api.redo();
    api.deleteObjects([id]);
    list = api.queryObjectList();
    expect(list.objects).toEqual([]);
    expect(list.trash).toEqual([id]);
    await api.undo();
    list = api.queryObjectList();
    expect(list.objects.map((o) => o.id)).toEqual([id]);
    expect(list.trash).toEqual([]);
  });

  test("queryObject 返回序列化数据；不存在时为 null", async () => {
    const { api } = createEnd("test");
    const id = await api.addObject("StrokeObject", {
      position: { x: 5, y: 6 },
      data: { ...STROKE_DATA },
    });
    const data = api.queryObject(id);
    expect(data.id).toBe(id);
    expect(data.position).toEqual({ x: 5, y: 6 });
    expect(api.queryObject("test/999")).toBeNull();
  });

  test("queryObjects 只返回纯数据瘦摘要，不夹带几何快照", async () => {
    const { api } = createEnd("test");
    const id = await api.addObject("StrokeObject", {
      position: { x: 5, y: 6 },
      data: { ...STROKE_DATA },
    });

    const [summary] = api.queryObjects([id]);
    expect(Object.keys(summary).sort()).toEqual([
      "boundingBox",
      "choice",
      "id",
      "isActive",
      "position",
      "transform",
      "type",
    ]);
    // 摘要会在框选与手势高频路径上跨 worker 边界，带点数组就会放大成几十 KB
    expect(summary.data).toBeUndefined();
    expect(summary.property).toBeUndefined();
    // range 是类实例，克隆后方法丢失，跨端消费方只能退回 boundingBox
    expect(summary.range).toBeUndefined();
  });

  test("queryObjects 的消息体积不随笔迹点数增长", async () => {
    const { api } = createEnd("test");
    const points = Array.from({ length: 500 }, (_, i) => ({ x: i, y: i % 7 }));
    const id = await api.addObject("StrokeObject", {
      position: { x: 0, y: 0 },
      data: { ...STROKE_DATA, points },
    });

    const summaryBytes = JSON.stringify(api.queryObjects([id])).length;
    const detailBytes = JSON.stringify(api.queryObjectDetails([id])).length;

    expect(summaryBytes).toBeLessThan(512);
    // 详情带完整点数组，体积必须显著更大：证明两者口径确实不同
    expect(detailBytes).toBeGreaterThan(summaryBytes * 10);
  });

  test("queryObjectDetails 在摘要之外带回属性、几何、引用计数与覆盖区块", async () => {
    const { api } = createEnd("test");
    const id = await api.addObject("StrokeObject", {
      position: { x: 5, y: 6 },
      data: { ...STROKE_DATA },
    });

    const [detail] = api.queryObjectDetails([id]);
    expect(detail.id).toBe(id);
    expect(detail.isActive).toBe(false);
    expect(detail.position).toEqual({ x: 5, y: 6 });
    expect(detail.data.points).toEqual(STROKE_DATA.points);
    expect(detail.property).toEqual(expect.objectContaining({ color: "#000000" }));
    expect(detail.loadedCount).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(detail.coveredChunkIds)).toBe(true);
  });

  test("queryObjectDetails 跳过不存在的 id", async () => {
    const { api } = createEnd("test");
    const id = await api.addObject("StrokeObject", {
      position: { x: 0, y: 0 },
      data: { ...STROKE_DATA },
    });
    expect(api.queryObjectDetails([id, "test/999"]).map((d) => d.id)).toEqual([
      id,
    ]);
  });

  test("queryOperations 支持来源/类型过滤与 limit 取末尾", async () => {
    const { api } = createEnd("test");
    const id = await api.addObject("StrokeObject", { data: { ...STROKE_DATA } });
    api.deleteObjects([id]);

    const all = api.queryOperations();
    expect(all.map((r) => r.id)).toEqual(["test/op-1", "test/op-2"]);
    expect(all[0].type).toBe("add-object");
    expect(all[1].type).toBe("delete-object");
    expect(all[0].parentId).toBeNull();
    expect(all[1].parentId).toBe("test/op-1");

    expect(api.queryOperations({ source: "nobody" })).toEqual([]);
    expect(api.queryOperations({ type: "delete-object" })).toHaveLength(1);
    expect(api.queryOperations({ limit: 1 })[0].id).toBe("test/op-2");
    // 过滤先于 limit：先筛类型再取末尾
    expect(api.queryOperations({ type: "add-object", limit: 1 })[0].id).toBe(
      "test/op-1",
    );
  });

  test("queryUndoTree 暴露活动链、HEAD、重做栈与已撤销分支", async () => {
    const { api } = createEnd("test");
    const empty = api.queryUndoTree();
    expect(empty.head).toBeNull();
    expect(empty.nodes).toEqual([]);

    const id1 = await api.addObject("StrokeObject", { data: { ...STROKE_DATA } });
    const id2 = await api.addObject("StrokeObject", { data: { ...STROKE_DATA } });
    api.undo("test/op-2");

    const tree = api.queryUndoTree();
    expect(tree.head).toBe("test/op-1");
    expect(tree.activeChain).toEqual(["test/op-1"]);
    expect(tree.redoStack).toHaveLength(1);
    expect(tree.redoStack[0].targetId).toBe("test/op-2");

    // 被撤销的 op-2 成为活动链外的分支节点
    expect(tree.nodes).toHaveLength(2);
    const node1 = tree.nodes.find((n) => n.id === "test/op-1");
    const node2 = tree.nodes.find((n) => n.id === "test/op-2");
    expect(node1).toMatchObject({ parentId: null, depth: 1, active: true, isHead: true });
    expect(node2).toMatchObject({ parentId: "test/op-1", depth: 2, active: false, isHead: false });
  });
});
