/**
 * @file 日志跟随者测试
 * @description 验证日志跟随者把操作日志增量落为段文件，并把对象文件与板元数据对齐到撤销/重做/远端记录引起的任意白板状态。
 * @module kernel/store/tests/journaler.test
 * @author Zhou Chenyu
 * SPDX-License-Identifier: MIT
 */

import { jest } from "@jest/globals";
import { createMemoryDriver } from "../../../io/driver/memory.js";
import { bindRoot } from "../../../io/driver/io-driver.js";
import { BoardCore } from "../../board/board-core.js";
import { BoardApi } from "../../api/board-api.js";
import { createDefaultAomRenderHooks } from "../../board/aom-render-hooks.js";
import { createDefaultPersistenceAdapter } from "../../board/persistence-adapter.js";
import { createAddObjectOperation, createModifyObjectOperation } from "../../hit/operation.js";
import { createSessionStore } from "../session-store.js";
import { createJournaler } from "../journaler.js";

/**
 * 装配内核、会话存储与跟随者
 * @param {Object} [options] - 装配选项
 * @param {() => number} [options.now] - 时间源（默认真实时钟；测试可注入递增时钟保证时间单调）
 * @returns {Object} 测试上下文
 */
function setup(options = {}) {
  const boardCore = new BoardCore({
    width: 800,
    height: 600,
    now: options.now,
    aomRenderHooks: createDefaultAomRenderHooks(),
    persistenceAdapter: createDefaultPersistenceAdapter(),
  });
  const api = new BoardApi(boardCore);
  const driver = createMemoryDriver({ rootId: "mem" });
  const store = createSessionStore(bindRoot(driver, "mem"));
  return { boardCore, api, store };
}

/**
 * 创建并提交一笔静态笔画
 * @param {BoardApi} api - 内核 API
 * @param {string} id - 对象 id
 * @returns {Promise<void>}
 */
async function createStaticStroke(api, id) {
  api.createObject("StrokeObject", {
    id,
    position: { x: 0, y: 0 },
    property: { width: 2 },
    data: { points: [{ x: 0, y: 0 }, { x: 10, y: 0 }] },
  });
  await api.commitObjects([id]);
}

/**
 * 读出全部日志段中的记录
 * @param {Object} store - 会话存储
 * @returns {Promise<Object[]>} 记录数组
 */
async function readRecords(store) {
  return (await store.readAllRecords()).records;
}

/**
 * 存储失败注入方式
 * @type {Array<{label: string, shouldThrow: boolean}>}
 */
const STORE_FAILURE_MODES = [
  { label: "返回 false", shouldThrow: false },
  { label: "抛错", shouldThrow: true },
];

/**
 * 验证存储失败会拒绝显式 flush，恢复后重试并落盘
 * @param {Object} params - 测试参数
 * @param {BoardCore} params.boardCore - 白板核心
 * @param {Object} params.store - 会话存储
 * @param {string} params.method - 注入失败的存储方法名
 * @param {boolean} params.shouldThrow - 是否抛错而非返回 false
 * @param {Object} [params.attachOptions={}] - 跟随者挂接选项
 * @param {(recovered: boolean) => Promise<void>} params.verifyPersisted - 按恢复前后检查实际盘态
 * @returns {Promise<void>}
 */
async function expectStoreFailureRetry({
  boardCore,
  store,
  method,
  shouldThrow,
  attachOptions = {},
  verifyPersisted,
}) {
  const journaler = createJournaler({ boardCore, store });
  journaler.attach(attachOptions);
  const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  const original = store[method].bind(store);
  let failNext = true;
  let writeCount = 0;
  store[method] = async (...args) => {
    writeCount++;
    if (failNext) {
      failNext = false;
      if (shouldThrow) throw new Error("注入写失败");
      return false;
    }
    return original(...args);
  };
  try {
    await expect(journaler.flush()).rejects.toThrow();
    await verifyPersisted(false);
    await journaler.flush();
    await verifyPersisted(true);
    expect(writeCount).toBe(2);
  } finally {
    errorSpy.mockRestore();
  }
}

describe("Journaler", () => {
  test("本地 commit 落为段文件，对象快照与元数据同步", async () => {
    const { boardCore, api, store } = setup();
    await store.create();
    const journaler = createJournaler({ boardCore, store });
    journaler.attach();

    await createStaticStroke(api, "demo/1");
    await journaler.flush();

    const records = await readRecords(store);
    expect(records).toHaveLength(1);
    expect(records[0].type).toBe("add-object");

    const objects = await store.readAllObjects();
    expect(objects).toHaveLength(1);
    expect(objects[0].id).toBe("demo/1");

    const metaBySource = await store.readAllSourceMeta();
    expect(metaBySource.core?.lastTime).toBe(records[0].time);
    // 段落入 per-source 流目录
    const { nextSegmentSeqBySource } = await store.readAllRecords();
    expect(nextSegmentSeqBySource).toEqual({ core: 1 });
  });

  test("modify 后对象文件内容更新", async () => {
    const { boardCore, api, store } = setup();
    await store.create();
    const journaler = createJournaler({ boardCore, store });
    journaler.attach();

    await createStaticStroke(api, "s1");
    await api.addActiveObjects(["s1"]);
    api.modifyObject("s1", { position: { x: 42, y: 0 } });
    await api.commitObjects(["s1"]);
    await journaler.flush();

    const objects = await store.readAllObjects();
    expect(objects).toHaveLength(1);
    expect(objects[0].position.x).toBe(42);
    // choose/modify/unchoose/close-supra 四条记录依次入段
    const types = (await readRecords(store)).map((r) => r.type);
    expect(types).toEqual([
      "add-object",
      "choose-object",
      "modify-object",
      "unchoose-object",
      "close-supra",
    ]);
  });

  test("删除进 trash，撤销删除移回活动目录", async () => {
    const { boardCore, api, store } = setup();
    await store.create();
    const journaler = createJournaler({ boardCore, store });
    journaler.attach();

    await createStaticStroke(api, "s1");
    await api.deleteObjects(["s1"]);
    await journaler.flush();
    expect(await store.readAllObjects()).toHaveLength(0);
    const trashEntries = await store.readAllTrash();
    expect(trashEntries.map((e) => e.data.id)).toEqual(["s1"]);
    expect(trashEntries[0].chunks[0].below).toBeDefined();

    api.undo();
    await journaler.flush();
    expect((await store.readAllObjects()).map((o) => o.id)).toEqual(["s1"]);
    expect(await store.readAllTrash()).toHaveLength(0);
  });

  test("撤销新增从盘上移除对象文件", async () => {
    const { boardCore, api, store } = setup();
    await store.create();
    const journaler = createJournaler({ boardCore, store });
    journaler.attach();

    await createStaticStroke(api, "s1");
    await journaler.flush();
    expect(await store.readAllObjects()).toHaveLength(1);

    api.undo();
    await journaler.flush();
    expect(await store.readAllObjects()).toHaveLength(0);
    expect(await store.readAllTrash()).toHaveLength(0);
  });

  test("远端记录经 applyRemoteOperations 同样落段", async () => {
    const { boardCore, api, store } = setup();
    await store.create();
    const journaler = createJournaler({ boardCore, store });
    journaler.attach();

    await createStaticStroke(api, "s1");
    await journaler.flush();
    await api.applyRemoteOperations([
      createAddObjectOperation({
        id: "b/op-1",
        source: "b",
        time: Date.now() + 1000,
        parentId: null,
        chunkId: "1",
        objectId: "remote/1",
        data: {
          id: "remote/1",
          type: "StrokeObject",
          position: { x: 0, y: 0 },
          property: { width: 2 },
          data: { points: [{ x: 0, y: 0 }] },
          transform: { a: 1, b: 0, c: 0, d: 1 },
        },
        layerStackSnapshot: ["s1", "remote/1"],
      }),
    ]);
    await journaler.flush();

    const records = await readRecords(store);
    // 归并按 source 字典序分组：b 流在 core 流之前
    expect(records.map((r) => r.id)).toEqual(["b/op-1", "core/op-1"]);
    // 远端记录落作者源流，本地记录落本端流
    const { nextSegmentSeqBySource } = await store.readAllRecords();
    expect(nextSegmentSeqBySource).toEqual({ b: 1, core: 1 });
    expect((await store.readAllObjects()).map((o) => o.id).sort()).toEqual([
      "remote/1",
      "s1",
    ]);
  });

  test("指纹种子避免打开既有板后的首 flush 重写", async () => {
    const { boardCore, api, store } = setup();
    await store.create();
    const journaler = createJournaler({ boardCore, store });
    journaler.attach();
    await createStaticStroke(api, "s1");
    await journaler.detach();

    // 模拟重新打开：以盘上内容为种子挂接新跟随者
    let writeCount = 0;
    const countingStore = Object.create(store);
    countingStore.writeObject = async (data) => {
      writeCount++;
      return store.writeObject(data);
    };
    const journaler2 = createJournaler({
      boardCore,
      store: countingStore,
    });
    journaler2.attach({
      nextSegmentSeqBySource: (await store.readAllRecords())
        .nextSegmentSeqBySource,
      lastTime: 0,
      knownObjects: await store.readAllObjects(),
      knownTrash: [],
    });
    await journaler2.flush();
    expect(writeCount).toBe(0);
  });

  test("knownSourceMeta 种子：无变化 flush 不重写元数据分片与区块元数据", async () => {
    // 递增时钟：lastTime 必须真实推进才能触发重写
    let tick = 1000;
    const { boardCore, api, store } = setup({ now: () => ++tick });
    await store.create();
    const journaler = createJournaler({ boardCore, store });
    journaler.attach();
    await createStaticStroke(api, "s1");
    await journaler.detach();

    // 模拟重新打开：以盘上 meta 分片与区块元数据为种子，无修改 flush 不应重写
    const sourceMeta = await store.readAllSourceMeta();
    const lastTime = Object.values(sourceMeta)[0]?.lastTime ?? 0;
    let writeMetaCount = 0;
    let writeChunkCount = 0;
    const countingStore = Object.create(store);
    countingStore.writeSourceMeta = async (source, m) => {
      writeMetaCount++;
      return store.writeSourceMeta(source, m);
    };
    countingStore.writeChunkMetadata = async (chunkId, metadata) => {
      writeChunkCount++;
      return store.writeChunkMetadata(chunkId, metadata);
    };
    const journaler2 = createJournaler({ boardCore, store: countingStore });
    journaler2.attach({
      nextSegmentSeqBySource: (await store.readAllRecords())
        .nextSegmentSeqBySource,
      lastTime,
      knownObjects: await store.readAllObjects(),
      knownTrash: [],
      knownSourceMeta: sourceMeta,
      knownChunkMetadata: await store.readAllChunkMetadata(),
    });
    await journaler2.flush();
    expect(writeMetaCount).toBe(0);
    expect(writeChunkCount).toBe(0);

    // 真实修改后元数据分片正常重写
    await createStaticStroke(api, "s2");
    await journaler2.flush();
    expect(writeMetaCount).toBe(1);
  });

  test("trash 种子：重开后撤销删除，trash 文件随对象复活移除", async () => {
    const { boardCore, api, store } = setup();
    await store.create();
    const journaler = createJournaler({ boardCore, store });
    journaler.attach();
    await createStaticStroke(api, "s1");
    await api.deleteObjects(["s1"]);
    await journaler.detach();

    // 模拟重新打开：对象在 trash 中；以盘上内容为种子挂接新跟随者
    const boardCore2 = new BoardCore({
      width: 800,
      height: 600,
      aomRenderHooks: createDefaultAomRenderHooks(),
      persistenceAdapter: createDefaultPersistenceAdapter(),
      hitRecords: await readRecords(store),
    });
    const session2 = {
      chunkMetadataList: await store.readAllChunkMetadata(),
      objects: await store.readAllObjects(),
      trash: await store.readAllTrash(),
    };
    boardCore2.restoreSession(session2);
    const api2 = new BoardApi(boardCore2);
    const journaler2 = createJournaler({ boardCore: boardCore2, store });
    journaler2.attach({
      nextSegmentSeqBySource: (await store.readAllRecords())
        .nextSegmentSeqBySource,
      lastTime: 0,
      knownObjects: session2.objects,
      knownTrash: session2.trash,
    });

    // 撤销删除：对象复活回活动区
    const result = api2.undo();
    expect(result.undone).toBe(true);
    expect(boardCore2.getAllObjects().map((o) => o.id)).toEqual(["s1"]);
    await journaler2.flush();

    expect((await store.readAllObjects()).map((o) => o.id)).toEqual(["s1"]);
    expect(await store.readAllTrash()).toEqual([]);
  });

  test("超分子成员即时物化逐条入段，闭合追加 close-supra 记录", async () => {
    const { boardCore, api, store } = setup();
    await store.create();
    const journaler = createJournaler({ boardCore, store });
    journaler.attach();

    api.beginSupra("s");
    api.createObject("StrokeObject", {
      id: "s1",
      position: { x: 0, y: 0 },
      property: { width: 2 },
      data: { points: [{ x: 0, y: 0 }] },
    });
    await api.commitObjects(["s1"], { supraKey: "s" });
    api.createObject("StrokeObject", {
      id: "s2",
      position: { x: 5, y: 5 },
      property: { width: 2 },
      data: { points: [{ x: 1, y: 1 }] },
    });
    await api.commitObjects(["s2"], { supraKey: "s" });
    api.endSupra("s");
    await journaler.flush();

    const records = await readRecords(store);
    expect(records).toHaveLength(3);
    // 三级容器模型：成员即时物化并携带 supraId，闭合记录收束折叠
    expect(records[0].supraId).toMatch(/^core\/supra-\d+$/);
    expect(records[1].supraId).toBe(records[0].supraId);
    expect(records[2].type).toBe("close-supra");
    expect(records[2].payload.supraId).toBe(records[0].supraId);
    expect((await store.readAllObjects()).map((o) => o.id).sort()).toEqual([
      "s1",
      "s2",
    ]);
  });

  test("双写端顺序落各自源流，重开后树完整且各撤各的", async () => {
    const driver = createMemoryDriver({ rootId: "mem" });
    const d = bindRoot(driver, "mem");
    const store = createSessionStore(d);
    await store.create();

    // 会话 A（source=a）：创建对象并落盘
    const coreA = new BoardCore({
      width: 800,
      height: 600,
      source: "a",
      aomRenderHooks: createDefaultAomRenderHooks(),
      persistenceAdapter: createDefaultPersistenceAdapter(),
    });
    const apiA = new BoardApi(coreA);
    const journalerA = createJournaler({ boardCore: coreA, store });
    journalerA.attach();
    await createStaticStroke(apiA, "a/1");
    await journalerA.detach();

    // 会话 B（source=b）：从盘上恢复后继续写自己的流
    const loaded = await store.readAllRecords();
    const coreB = new BoardCore({
      width: 800,
      height: 600,
      source: "b",
      hitRecords: loaded.records,
      aomRenderHooks: createDefaultAomRenderHooks(),
      persistenceAdapter: createDefaultPersistenceAdapter(),
    });
    coreB.restoreSession({
      chunkMetadataList: await store.readAllChunkMetadata(),
      objects: await store.readAllObjects(),
      trash: await store.readAllTrash(),
    });
    const apiB = new BoardApi(coreB);
    const journalerB = createJournaler({ boardCore: coreB, store });
    journalerB.attach({
      nextSegmentSeqBySource: loaded.nextSegmentSeqBySource,
      knownObjects: await store.readAllObjects(),
    });
    await createStaticStroke(apiB, "b/1");
    await journalerB.detach();

    // 双流各自落盘、序号各自推进
    const after = await store.readAllRecords();
    expect(after.nextSegmentSeqBySource).toEqual({ a: 1, b: 1 });
    expect(after.records.map((r) => r.id)).toEqual(["a/op-1", "b/op-1"]);

    // 重开：树完整；各撤各的命中本端最近节点
    const coreC = new BoardCore({
      width: 800,
      height: 600,
      source: "b",
      hitRecords: after.records,
      aomRenderHooks: createDefaultAomRenderHooks(),
      persistenceAdapter: createDefaultPersistenceAdapter(),
    });
    coreC.restoreSession({
      chunkMetadataList: await store.readAllChunkMetadata(),
      objects: await store.readAllObjects(),
      trash: await store.readAllTrash(),
    });
    const apiC = new BoardApi(coreC);
    expect(coreC.getAllObjects().map((o) => o.id).sort()).toEqual([
      "a/1",
      "b/1",
    ]);
    // source=b 视角：撤销命中 b 的创建，a 的对象保留
    expect(apiC.undo().undone).toBe(true);
    expect(coreC.getAllObjects().map((o) => o.id)).toEqual(["a/1"]);
  });

  test("persistStream 过滤：只允许本端 source 的流落盘", async () => {
    const { boardCore, api, store } = setup();
    await store.create();
    const journaler = createJournaler({
      boardCore,
      store,
      persistStream: (s) => s === "core",
    });
    journaler.attach();

    await createStaticStroke(api, "s1");
    await api.applyRemoteOperations([
      createAddObjectOperation({
        id: "b/op-1",
        source: "b",
        time: Date.now() + 1000,
        parentId: null,
        chunkId: "1",
        objectId: "remote/1",
        data: {
          id: "remote/1",
          type: "StrokeObject",
          position: { x: 0, y: 0 },
          property: { width: 2 },
          data: { points: [{ x: 0, y: 0 }] },
          transform: { a: 1, b: 0, c: 0, d: 1 },
        },
        layerStackSnapshot: ["s1", "remote/1"],
      }),
    ]);
    await journaler.flush();

    // b 的流被过滤不落盘（作者自写）；本端 core 流正常
    const { records, nextSegmentSeqBySource } = await store.readAllRecords();
    expect(records.map((r) => r.id)).toEqual(["core/op-1"]);
    expect(nextSegmentSeqBySource).toEqual({ core: 1 });
  });

  test("远程活动对象不写不移除（写权属活动方），解除后恢复调和", async () => {
    const { boardCore, api, store } = setup();
    await store.create();
    const journaler = createJournaler({ boardCore, store });
    journaler.attach();

    await createStaticStroke(api, "s1");
    await journaler.flush();
    expect(
      (await store.readAllObjects())[0].position,
    ).toEqual({ x: 0, y: 0 });

    // 远程端 b 持有 s1（活动）并修改它
    boardCore.activeObjectManager.applyRemoteChoose(["s1"], "b");
    await api.applyRemoteOperations([
      createModifyObjectOperation({
        id: "b/op-1",
        source: "b",
        time: Date.now() + 1000,
        parentId: null,
        chunkId: "1",
        objectId: "s1",
        before: { position: { x: 0, y: 0 } },
        after: { position: { x: 99, y: 0 } },
        layerStackSnapshot: ["s1"],
      }),
    ]);
    await journaler.flush();
    // 远程活动期间：本端不写对象文件（b 端自写），盘上仍是旧内容
    expect(
      (await store.readAllObjects())[0].position,
    ).toEqual({ x: 0, y: 0 });

    // 远程释放后恢复调和：下一次 flush 把收敛后的内容落盘
    boardCore.activeObjectManager.revokeRemoteActive("s1");
    await journaler.flush();
    expect(
      (await store.readAllObjects())[0].position,
    ).toEqual({ x: 99, y: 0 });
  });

  test("removeMissing:false 时既非活动亦非 trash 的对象文件不移除", async () => {
    const { boardCore, store } = setup();
    await store.create();
    // 盘上预置对象文件（模拟已被 chunk 卸载逐出内存的对象）
    const data = {
      id: "s1",
      type: "StrokeObject",
      position: { x: 0, y: 0 },
      property: { width: 2 },
      data: { points: [{ x: 0, y: 0 }] },
      transform: { a: 1, b: 0, c: 0, d: 1 },
    };
    await store.writeObject(data);

    // 默认行为（removeMissing:true）：空板上调和会移除缺失对象文件
    const journaler1 = createJournaler({ boardCore, store });
    journaler1.attach({ knownObjects: [data] });
    await journaler1.flush();
    expect(await store.readAllObjects()).toHaveLength(0);

    // 部分驻留写端（removeMissing:false）：不移除，防误删未加载对象
    await store.writeObject(data);
    const journaler2 = createJournaler({
      boardCore,
      store,
      removeMissing: false,
    });
    journaler2.attach({ knownObjects: [data] });
    await journaler2.flush();
    expect((await store.readAllObjects()).map((o) => o.id)).toEqual(["s1"]);
  });

  test("writeMeta:false 时 flush 不重写 board.json", async () => {
    const { boardCore, api, store } = setup();
    await store.create();
    const before = await store.readMeta();
    const journaler = createJournaler({ boardCore, store, writeMeta: false });
    journaler.attach();

    await createStaticStroke(api, "s1");
    await journaler.flush();

    expect(await store.readMeta()).toEqual(before);
    // meta 分片同样零写盘
    expect(await store.readAllSourceMeta()).toEqual({});
    // 流与对象照常落盘
    expect((await store.readAllRecords()).records).toHaveLength(1);
    expect((await store.readAllObjects()).map((o) => o.id)).toEqual(["s1"]);
  });

  test("flush 写本端与代写来源的 meta 分片（含各自计数切片）", async () => {
    const { boardCore, api, store } = setup();
    await store.create();
    const journaler = createJournaler({
      boardCore,
      store,
      collectMeta: () => boardCore.collectSessionMeta(),
    });
    journaler.attach();

    await createStaticStroke(api, "s1");
    await api.applyRemoteOperations([
      createAddObjectOperation({
        id: "b/op-1",
        source: "b",
        time: Date.now() + 1000,
        parentId: null,
        chunkId: "1",
        objectId: "b/1",
        data: {
          id: "b/1",
          type: "StrokeObject",
          position: { x: 0, y: 0 },
          property: { width: 2 },
          data: { points: [{ x: 0, y: 0 }] },
          transform: { a: 1, b: 0, c: 0, d: 1 },
        },
        layerStackSnapshot: ["s1", "b/1"],
      }),
    ]);
    await journaler.flush();

    const sourceMeta = await store.readAllSourceMeta();
    // 本端 core 与代写的 b 各有分片；计数切片按 source 归属
    expect(Object.keys(sourceMeta).sort()).toEqual(["b", "core"]);
    expect(sourceMeta.core.lastTime).toBeGreaterThan(0);
    expect(sourceMeta.b.objectIdCounters).toEqual({ b: 1 });
    // 合并视图：两源计数并入
    const session = await store.loadAll();
    expect(session.meta.objectIdCounters).toEqual({ b: 1 });
  });

  test.each(STORE_FAILURE_MODES)(
    "writeObject $label：flush 拒绝，恢复后对象实际落盘",
    async ({ shouldThrow }) => {
      const { boardCore, api, store } = setup();
      await store.create();
      await createStaticStroke(api, "s1");

      await expectStoreFailureRetry({
        boardCore,
        store,
        method: "writeObject",
        shouldThrow,
        verifyPersisted: async (recovered) => {
          expect((await store.readAllObjects()).map((o) => o.id)).toEqual(
            recovered ? ["s1"] : [],
          );
        },
      });
    },
  );

  test.each(STORE_FAILURE_MODES)(
    "writeTrashEntry $label：flush 拒绝，恢复后 trash 条目实际落盘",
    async ({ shouldThrow }) => {
      const { boardCore, api, store } = setup();
      await store.create();
      await createStaticStroke(api, "s1");
      await api.deleteObjects(["s1"]);

      await expectStoreFailureRetry({
        boardCore,
        store,
        method: "writeTrashEntry",
        shouldThrow,
        verifyPersisted: async (recovered) => {
          expect((await store.readAllTrash()).map((e) => e.data.id)).toEqual(
            recovered ? ["s1"] : [],
          );
        },
      });
    },
  );

  test.each(STORE_FAILURE_MODES)(
    "removeObject $label：flush 拒绝，恢复后移除活动对象旧文件",
    async ({ shouldThrow }) => {
      const { boardCore, api, store } = setup();
      await store.create();
      await createStaticStroke(api, "s1");
      const data = boardCore.getAllObjects()[0].serialize();
      await store.writeObject(data);
      await api.deleteObjects(["s1"]);

      await expectStoreFailureRetry({
        boardCore,
        store,
        method: "removeObject",
        shouldThrow,
        attachOptions: { knownObjects: [data] },
        verifyPersisted: async (recovered) => {
          expect((await store.readAllObjects()).map((o) => o.id)).toEqual(
            recovered ? [] : ["s1"],
          );
          expect((await store.readAllTrash()).map((e) => e.data.id)).toEqual(["s1"]);
        },
      });
    },
  );

  test.each(STORE_FAILURE_MODES)(
    "removeTrashObject $label：flush 拒绝，恢复后移除 trash 旧文件",
    async ({ shouldThrow }) => {
      const { boardCore, api, store } = setup();
      await store.create();
      await createStaticStroke(api, "s1");
      await api.deleteObjects(["s1"]);
      const entry = boardCore.trash.get("s1");
      const knownTrash = {
        data: entry.data,
        chunks: entry.chunks.map((chunk) => ({
          chunkId: chunk.chunkId,
          below: [...chunk.below],
          above: [...chunk.above],
        })),
      };
      await store.writeTrashEntry(knownTrash);
      api.undo();

      await expectStoreFailureRetry({
        boardCore,
        store,
        method: "removeTrashObject",
        shouldThrow,
        attachOptions: { knownTrash: [knownTrash] },
        verifyPersisted: async (recovered) => {
          expect((await store.readAllObjects()).map((o) => o.id)).toEqual(["s1"]);
          expect((await store.readAllTrash()).map((e) => e.data.id)).toEqual(
            recovered ? [] : ["s1"],
          );
        },
      });
    },
  );

  test.each(STORE_FAILURE_MODES)(
    "writeChunkMetadata $label：flush 拒绝，恢复后区块元数据实际落盘",
    async ({ shouldThrow }) => {
      const { boardCore, api, store } = setup();
      await store.create();
      await createStaticStroke(api, "s1");

      await expectStoreFailureRetry({
        boardCore,
        store,
        method: "writeChunkMetadata",
        shouldThrow,
        verifyPersisted: async (recovered) => {
          expect(await store.readAllChunkMetadata()).toHaveLength(recovered ? 1 : 0);
        },
      });
    },
  );

  test.each(STORE_FAILURE_MODES)(
    "writeSourceMeta $label：flush 拒绝，恢复后元数据分片实际落盘",
    async ({ shouldThrow }) => {
      const { boardCore, store } = setup();
      await store.create();

      await expectStoreFailureRetry({
        boardCore,
        store,
        method: "writeSourceMeta",
        shouldThrow,
        verifyPersisted: async (recovered) => {
          expect(Object.keys(await store.readAllSourceMeta())).toEqual(
            recovered ? ["core"] : [],
          );
        },
      });
    },
  );

  test("写段失败：记录保留队首重试，恢复后无序号空洞，flush 链不毒化", async () => {
    const { boardCore, api, store } = setup();
    await store.create();
    const journaler = createJournaler({ boardCore, store });
    journaler.attach();

    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    const originalAppend = store.appendSegment.bind(store);
    let failNext = true;
    store.appendSegment = async (source, seq, records) => {
      if (failNext) return false;
      return originalAppend(source, seq, records);
    };
    try {
      // 第一轮写段失败（驱动层 false）：记录不出队，flush 上抛，告警留痕
      await createStaticStroke(api, "demo/1");
      await expect(journaler.flush()).rejects.toThrow("写段失败");
      expect(errorSpy).toHaveBeenCalled();
      expect(await readRecords(store)).toHaveLength(0);

      // 恢复后继续操作：失败记录带新记录一起落盘，per-source 序号连续无空洞，
      // 且串行链未被上一轮的拒绝毒化
      failNext = false;
      await createStaticStroke(api, "demo/2");
      await journaler.flush();
      const records = await readRecords(store);
      expect(records.map((r) => r.id)).toEqual(["core/op-1", "core/op-2"]);
      expect((await store.readAllObjects()).map((o) => o.id).sort()).toEqual([
        "demo/1",
        "demo/2",
      ]);
    } finally {
      errorSpy.mockRestore();
    }
  });

  test("写段抛错：同款保留重试，失败与恢复各告警一次", async () => {
    const { boardCore, api, store } = setup();
    await store.create();
    const journaler = createJournaler({ boardCore, store });
    journaler.attach();

    const messages = [];
    const errorSpy = jest
      .spyOn(console, "error")
      .mockImplementation((...args) => messages.push(args.join(" ")));
    const originalAppend = store.appendSegment.bind(store);
    // 自动合批 flush 也会消耗失败次数：三次失败 = 自动一轮 + 显式两轮
    let failCount = 3;
    store.appendSegment = async (source, seq, records) => {
      if (failCount > 0) {
        failCount -= 1;
        throw new Error("disk full");
      }
      return originalAppend(source, seq, records);
    };
    try {
      await createStaticStroke(api, "demo/1");
      await expect(journaler.flush()).rejects.toThrow("disk full");
      await expect(journaler.flush()).rejects.toThrow("disk full");
      // 进入失败状态只告警一次（连续失败不刷屏）
      expect(messages.filter((m) => m.includes("写段失败"))).toHaveLength(1);

      await journaler.flush();
      expect((await readRecords(store)).map((r) => r.id)).toEqual(["core/op-1"]);
      // 恢复上报告警
      expect(messages.some((m) => m.includes("落盘恢复"))).toBe(true);
    } finally {
      errorSpy.mockRestore();
    }
  });
});
