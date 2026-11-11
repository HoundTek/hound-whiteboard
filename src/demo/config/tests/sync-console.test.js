/**
 * @file 同步控制台辅助测试
 * @description 验证 window.hwb 的设置/清除函数落 localStorage 并触发刷新，status 只读不刷新。
 * @module demo/config/tests/sync-console.test
 * @author Zhou Chenyu
 */

import { jest } from "@jest/globals";
import { installSyncConsole } from "../sync-console.js";

/**
 * 内存版 localStorage
 * @class
 */
class MemoryStorage {
  constructor() {
    this.map = new Map();
  }

  getItem(key) {
    return this.map.get(key) ?? null;
  }

  setItem(key, value) {
    this.map.set(key, String(value));
  }

  removeItem(key) {
    this.map.delete(key);
  }
}

/**
 * 装配测试环境（内存存储 + reload 间谍 + 控制台间谍）
 * @param {Object} [options={}] - 装配选项
 * @param {() => Object} [options.getBoard] - 惰性取 Board 实例（调试命令用）
 * @returns {Object} 测试环境
 */
function setupEnv({ getBoard } = {}) {
  const storage = new MemoryStorage();
  const reload = jest.fn();
  const consoleLog = jest.spyOn(console, "log").mockImplementation(() => {});
  const consoleWarn = jest.spyOn(console, "warn").mockImplementation(() => {});
  const consoleError = jest.spyOn(console, "error").mockImplementation(() => {});
  delete globalThis.hwb;
  globalThis.localStorage = storage;
  globalThis.location = { reload };
  installSyncConsole({ getBoard });
  return { storage, reload, consoleLog, consoleWarn, consoleError };
}

describe("同步控制台辅助", () => {
  afterEach(() => {
    delete globalThis.hwb;
    delete globalThis.localStorage;
    delete globalThis.location;
    jest.restoreAllMocks();
  });

  test("setRelay 写入存储并刷新，非法参数警告不刷新", () => {
    const { storage, reload, consoleWarn } = setupEnv();
    globalThis.hwb.setRelay("ws://192.168.1.5:8377");
    expect(storage.getItem("hwb-relay")).toBe("ws://192.168.1.5:8377");
    expect(reload).toHaveBeenCalledTimes(1);

    globalThis.hwb.setRelay("");
    expect(consoleWarn).toHaveBeenCalled();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  test("setSource 与 setBoard 各自落键并刷新", () => {
    const { storage, reload } = setupEnv();
    globalThis.hwb.setSource("B");
    globalThis.hwb.setBoard("~/hound-whiteboard/demo-board-2");
    expect(storage.getItem("hwb-source")).toBe("B");
    expect(storage.getItem("hwb-board")).toBe("~/hound-whiteboard/demo-board-2");
    expect(reload).toHaveBeenCalledTimes(2);
  });

  test("status 只读打印不刷新", () => {
    const { storage, reload, consoleLog } = setupEnv();
    storage.setItem("hwb-relay", "ws://127.0.0.1:8377");
    globalThis.hwb.status();
    expect(reload).not.toHaveBeenCalled();
    expect(consoleLog).toHaveBeenCalled();
  });

  test("off 清除全部同步配置并刷新", () => {
    const { storage, reload } = setupEnv();
    storage.setItem("hwb-relay", "ws://x");
    storage.setItem("hwb-source", "B");
    storage.setItem("hwb-board", "~/b");
    globalThis.hwb.off();
    expect(storage.getItem("hwb-relay")).toBeNull();
    expect(storage.getItem("hwb-source")).toBeNull();
    expect(storage.getItem("hwb-board")).toBeNull();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  test("重复安装不覆盖已有 hwb", () => {
    const { storage } = setupEnv();
    globalThis.hwb.custom = "keep";
    installSyncConsole();
    expect(globalThis.hwb.custom).toBe("keep");
    expect(storage.getItem("hwb-relay")).toBeNull();
  });
});

/**
 * 构造假 Board 与假 BoardApi（调试命令的观测面）
 * @returns {{ board: Object, api: Object }} 假 board/api
 */
function makeFakeBoard() {
  const api = {
    undo: jest.fn(async () => ({ undone: true, forcedEndMolIds: ["core/mol-1"] })),
    redo: jest.fn(async () => ({ redone: true, targetNodeId: "core/op-2" })),
    queryStateHash: jest.fn(async () => "hash-content"),
    queryChainHash: jest.fn(async () => "hash-chain"),
    queryOpenMols: jest.fn(async () => []),
    queryUndoTree: jest.fn(async () => ({ head: "core/op-2" })),
    repairStateFromLog: jest.fn(async () => ({ repaired: true, fixedIds: ["a/1"] })),
    requestDebug: jest.fn(),
  };
  const board = {
    getBoardApi: () => api,
    signalsEventBus: { emit: jest.fn() },
    viewports: new Map([
      [
        "viewport",
        {
          viewportId: "viewport",
          origin: { x: 0, y: 0 },
          zoom: 1,
          width: 800,
          height: 600,
        },
      ],
    ]),
    devicesDAG: { toString: () => "DAG-TEXT" },
  };
  return { board, api };
}

/**
 * 等待微任务与定时器排空（invoke 的 promise 链落定）
 * @returns {Promise<void>}
 */
async function settle() {
  for (let i = 0; i < 10; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

describe("hwb 调试与操作命令", () => {
  afterEach(() => {
    delete globalThis.hwb;
    delete globalThis.localStorage;
    delete globalThis.location;
    jest.restoreAllMocks();
  });

  test("help 打印全部命令不刷新", () => {
    const { reload, consoleLog } = setupEnv();
    globalThis.hwb.help();
    expect(reload).not.toHaveBeenCalled();
    const text = consoleLog.mock.calls.map((args) => String(args[0])).join("\n");
    for (const cmd of ["hwb.undo()", "hwb.digest()", "hwb.reconnect()", "hwb.devices(mode?)"]) {
      expect(text).toContain(cmd);
    }
  });

  test("undo/redo 经 BoardApi 调用并广播 hit 变更", async () => {
    const { board, api } = makeFakeBoard();
    setupEnv({ getBoard: () => board });
    globalThis.hwb.undo();
    await settle();
    expect(api.undo).toHaveBeenCalledTimes(1);
    const hitChanged = board.signalsEventBus.emit.mock.calls.filter(
      ([, packet]) => packet.signals?.[0]?.type === "hit:changed",
    );
    expect(hitChanged.length).toBeGreaterThan(0);
    expect(hitChanged[0][1].signals[0].context.forcedEndMolIds).toEqual(["core/mol-1"]);

    globalThis.hwb.redo();
    await settle();
    expect(api.redo).toHaveBeenCalledTimes(1);
  });

  test("digest 聚合三个查询打印摘要", async () => {
    const { board, api } = makeFakeBoard();
    const { consoleLog } = setupEnv({ getBoard: () => board });
    globalThis.hwb.digest();
    await settle();
    expect(api.queryStateHash).toHaveBeenCalledTimes(1);
    expect(api.queryChainHash).toHaveBeenCalledTimes(1);
    expect(api.queryOpenMols).toHaveBeenCalledTimes(1);
    const printed = JSON.stringify(consoleLog.mock.calls);
    expect(printed).toContain("hash-content");
    expect(printed).toContain("hash-chain");
  });

  test("tree 与 repair 调用对应 BoardApi 方法", async () => {
    const { board, api } = makeFakeBoard();
    setupEnv({ getBoard: () => board });
    globalThis.hwb.tree();
    globalThis.hwb.repair();
    await settle();
    expect(api.queryUndoTree).toHaveBeenCalledTimes(1);
    expect(api.repairStateFromLog).toHaveBeenCalledTimes(1);
  });

  test("inspect 经 queryObjectDetails 取回数据而不发调试请求", async () => {
    const { board, api } = makeFakeBoard();
    api.queryObjectDetails = jest.fn().mockResolvedValue([{ id: "a/1" }]);
    setupEnv({ getBoard: () => board });

    const result = await globalThis.hwb.inspect(["a/1"]);

    expect(api.queryObjectDetails).toHaveBeenCalledWith(["a/1"]);
    expect(result).toEqual([{ id: "a/1" }]);
    // 与 objects 的分工：inspect 取回数据，不走 Worker 侧打印
    expect(api.requestDebug).not.toHaveBeenCalled();
  });

  test("reconnect 与调试查询经 requestDebug 发送，id 参数归一化", () => {
    const { board, api } = makeFakeBoard();
    setupEnv({ getBoard: () => board });
    globalThis.hwb.reconnect();
    globalThis.hwb.chunkLoad();
    globalThis.hwb.chunks(3);
    globalThis.hwb.objects(["a/1"], [2, 3]);
    globalThis.hwb.aom();
    globalThis.hwb.hit();
    globalThis.hwb.board();
    globalThis.hwb.objectLoad();
    const calls = api.requestDebug.mock.calls.map(([query, extra]) => [query, extra]);
    expect(calls).toEqual([
      ["reconnect", {}],
      ["chunkLoadState", {}],
      ["chunksDetail", { chunkIds: [3] }],
      ["objectsDetail", { objectIds: ["a/1"], chunkIds: [2, 3] }],
      ["aomState", {}],
      ["hitState", {}],
      ["boardState", {}],
      ["objectLoadState", {}],
    ]);
  });

  test("viewport 与 devices 直接打印 UI 侧状态", () => {
    const { board } = makeFakeBoard();
    const { consoleLog } = setupEnv({ getBoard: () => board });
    globalThis.hwb.viewport();
    globalThis.hwb.devices();
    const text = JSON.stringify(consoleLog.mock.calls);
    expect(text).toContain("viewportId");
    expect(text).toContain("DAG-TEXT");
  });

  test("board 未就绪时警告而不抛错", async () => {
    const { consoleWarn } = setupEnv({ getBoard: () => null });
    globalThis.hwb.undo();
    globalThis.hwb.digest();
    globalThis.hwb.reconnect();
    globalThis.hwb.viewport();
    globalThis.hwb.devices();
    await settle();
    expect(consoleWarn).toHaveBeenCalled();
  });
});
