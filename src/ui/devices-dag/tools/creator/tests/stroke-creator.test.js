import { jest } from "@jest/globals";
import { StrokeCreatorTool } from "../stroke-creator.js";
import { Vector } from "../../../../../kernel/utils/math.js";
import { createMouseDevice } from "../../../devices/mouse-device.js";
import {
  createWorkerBoardContext,
  flushMicrotasks,
} from "../../../../../test-support/worker-mode-fixtures.js";

function createBoardDeviceContext(objectId, { viewport } = {}) {
  const board = {
    allocateObjectId: jest.fn(() => objectId),
    getObjectById: jest.fn(() => undefined),
  };
  const boardApi = {
    createObject: jest.fn(async () => objectId),
    appendListItem: jest.fn(),
    commitObjects: jest.fn(),
    discardActiveObjects: jest.fn(),
  };

  const _nodeState = {};
  const deviceContext = {
    path: "/test",
    getNodeState: () => ({ ..._nodeState }),
    setNodeState: (_pathOrId, state) => {
      Object.assign(_nodeState, state);
      return { ..._nodeState };
    },
    _nodeState,
    services: {
      board,
      boardApi,
      viewport,
    },
  };

  return { deviceContext };
}

/**
 * 构造具备分子能力的 boardApi 测试上下文
 * @param {string} objectId - 分配的对象 id
 * @param {{ boardApiOverrides?: Object }} [options={}] - 选项（覆盖 boardApi 方法）
 * @returns {{ board: Object, boardApi: Object, deviceContext: Object }} 测试上下文
 */
function createMolBoardDeviceContext(objectId, { boardApiOverrides = {} } = {}) {
  const board = {
    allocateObjectId: jest.fn(() => objectId),
    getObjectById: jest.fn(() => undefined),
  };
  const boardApi = {
    createObject: jest.fn(async () => objectId),
    beginMol: jest.fn(() => "demo/mol-1"),
    amendMol: jest.fn(() => true),
    endMol: jest.fn(() => true),
    abortMol: jest.fn(() => true),
    appendListItem: jest.fn(),
    replaceListItem: jest.fn(),
    modifyObject: jest.fn(),
    commitObjects: jest.fn(async () => [objectId]),
    discardActiveObjects: jest.fn(),
    ...boardApiOverrides,
  };

  const _nodeState = {};
  const deviceContext = {
    path: "/test",
    getNodeState: () => ({ ..._nodeState }),
    setNodeState: (_pathOrId, state) => {
      Object.assign(_nodeState, state);
      return { ..._nodeState };
    },
    _nodeState,
    services: {
      board,
      boardApi,
      supraKey: "S",
    },
  };

  return { board, boardApi, deviceContext };
}

describe("StrokeCreatorTool", () => {
  test("StrokeCreatorTool 应消费 position/end 信号并累计点列", () => {
    const tool = new StrokeCreatorTool();
    const { deviceContext } = createBoardDeviceContext("100");

    expect(
      tool.process(
        {
          to: "/viewport/stroke",
          signals: [{ type: "position", context: { value: new Vector(1, 2) } }],
        },
        deviceContext,
      ),
    ).toBeUndefined();

    expect(
      tool.process(
        {
          to: "/viewport/stroke",
          signals: [{ type: "position", context: { value: new Vector(2, 3) } }],
        },
        deviceContext,
      ),
    ).toBeUndefined();

    expect(
      tool.process(
        {
          to: "/viewport/stroke",
          signals: [
            { type: "position", context: { value: new Vector(3, 4) } },
            { type: "end", context: {} },
          ],
        },
        deviceContext,
      ),
    ).toBeUndefined();

    expect(tool._entry.id).toBe("100");
    expect(tool._entry.position.serialize()).toEqual({ x: 1, y: 2 });
    expect(tool._entry.data.points).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 2, y: 2 },
    ]);
  });

  test("连续重复位置不应产生重复路径点", () => {
    const tool = new StrokeCreatorTool();
    const { deviceContext } = createBoardDeviceContext("200");

    tool.process(
      {
        to: "/viewport/stroke",
        signals: [{ type: "position", context: { value: new Vector(1, 2) } }],
      },
      deviceContext,
    );

    tool.process(
      {
        to: "/viewport/stroke",
        signals: [{ type: "position", context: { value: new Vector(2, 3) } }],
      },
      deviceContext,
    );

    tool.process(
      {
        to: "/viewport/stroke",
        signals: [
          { type: "position", context: { value: new Vector(2, 3) } },
          { type: "end", context: {} },
        ],
      },
      deviceContext,
    );

    expect(tool._entry.data.points).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 1 },
    ]);
  });

  test("单 end 信号应能被正确处理", () => {
    const tool = new StrokeCreatorTool();
    const { deviceContext } = createBoardDeviceContext("101");

    tool.process(
      {
        to: "/viewport/stroke",
        signals: [{ type: "position", context: { value: new Vector(5, 6) } }],
      },
      deviceContext,
    );

    tool.process(
      {
        to: "/viewport/stroke",
        signals: [{ type: "end", context: {} }],
      },
      deviceContext,
    );

    expect(tool._entry.id).toBe("101");
    expect(tool._entry.position.serialize()).toEqual({ x: 5, y: 6 });
    expect(tool._entry.data.points).toEqual([{ x: 0, y: 0 }]);
  });

  test("构造参数应允许通过 property 指定新建笔画属性", () => {
    const tool = new StrokeCreatorTool({
      property: { color: "#ff0000", width: 4 },
    });
    const { deviceContext } = createBoardDeviceContext("102");

    tool.process(
      {
        to: "/viewport/stroke",
        signals: [{ type: "position", context: { value: new Vector(5, 6) } }],
      },
      deviceContext,
    );

    expect(tool._entry.property).toMatchObject({ color: "#ff0000", width: 4 });
  });

  test("cancel 信号应重置正在创建的对象并撤销 transient 对象", () => {
    const tool = new StrokeCreatorTool();
    const { deviceContext } = createBoardDeviceContext("1");
    const board = deviceContext.services.board;
    const boardApi = deviceContext.services.boardApi;
    const discardSpy = jest.spyOn(boardApi, "discardActiveObjects");

    tool.process(
      {
        to: "/viewport/stroke",
        signals: [{ type: "position", context: { value: new Vector(1, 2) } }],
      },
      deviceContext,
    );

    tool.process(
      {
        to: "/viewport/stroke",
        signals: [{ type: "cancel", context: {} }],
      },
      { services: { board, boardApi } },
    );

    expect(discardSpy).toHaveBeenCalledWith(["1"]);
    expect(tool._entry).toBeNull();
    expect(board.getObjectById).not.toHaveBeenCalled();
  });

  test("首次创建对象时应写回本地草稿并调用 createObject", () => {
    const tool = new StrokeCreatorTool();
    const { deviceContext } = createBoardDeviceContext("9");
    const boardApi = deviceContext.services.boardApi;

    tool.process(
      {
        to: "/viewport/stroke",
        signals: [{ type: "position", context: { value: new Vector(1, 2) } }],
      },
      deviceContext,
    );

    expect(boardApi.createObject).toHaveBeenCalledWith(
      "StrokeObject",
      expect.objectContaining({
        id: "9",
        position: new Vector(1, 2),
      }),
    );
    expect(deviceContext._nodeState.objects).toEqual([tool._entry]);
  });

  test("显式提供 boardApi 时应通过 appendListItem 累计路径点并在 end 后提交", () => {
    const tool = new StrokeCreatorTool();
    const { deviceContext } = createBoardDeviceContext("20");
    const boardApi = deviceContext.services.boardApi;
    const createSpy = jest.spyOn(boardApi, "createObject");
    const appendSpy = jest.spyOn(boardApi, "appendListItem");
    const commitSpy = jest.spyOn(boardApi, "commitObjects");

    tool.process(
      {
        to: "/viewport/stroke",
        signals: [{ type: "position", context: { value: new Vector(1, 2) } }],
      },
      deviceContext,
    );

    tool.process(
      {
        to: "/viewport/stroke",
        signals: [{ type: "position", context: { value: new Vector(2, 3) } }],
      },
      deviceContext,
    );

    tool.process(
      {
        to: "/viewport/stroke",
        signals: [
          { type: "position", context: { value: new Vector(3, 4) } },
          { type: "end", context: {} },
        ],
      },
      deviceContext,
    );

    expect(createSpy).toHaveBeenCalledWith(
      "StrokeObject",
      expect.objectContaining({
        id: "20",
        position: new Vector(1, 2),
      }),
    );
    expect(appendSpy).toHaveBeenCalled();
    expect(commitSpy).toHaveBeenCalledWith(["20"]);
    expect(tool._entry.data.points).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 2, y: 2 },
    ]);
  });

  test("RPC 风格 boardApi 下应维护本地草稿路径点并提交", () => {
    const tool = new StrokeCreatorTool();
    const board = {
      allocateObjectId: jest.fn(() => "701"),
    };
    const boardApi = {
      createObject: jest.fn(),
      appendListItem: jest.fn(),
      commitObjects: jest.fn(),
      discardActiveObjects: jest.fn(),
    };
    const deviceContext = {
      services: {
        board,
        boardApi,
      },
    };

    tool.process(
      {
        signals: [{ type: "position", context: { value: new Vector(1, 2) } }],
      },
      deviceContext,
    );
    tool.process(
      {
        signals: [{ type: "position", context: { value: new Vector(2, 3) } }],
      },
      deviceContext,
    );
    tool.process(
      {
        signals: [
          { type: "position", context: { value: new Vector(3, 4) } },
          { type: "end", context: {} },
        ],
      },
      deviceContext,
    );

    expect(boardApi.createObject).toHaveBeenCalledWith(
      "StrokeObject",
      expect.objectContaining({
        id: "701",
        position: new Vector(1, 2),
      }),
    );
    expect(boardApi.appendListItem).toHaveBeenCalled();
    expect(boardApi.commitObjects).toHaveBeenCalledWith(["701"]);
    expect(tool._entry.data.points).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 2, y: 2 },
    ]);
  });

  test("创建手势更新后仅请求 UI overlay 刷新，不再直调 renderer", () => {
    const tool = new StrokeCreatorTool();
    const viewport = {
      renderer: {
        captureObjectSnapshot: jest.fn(),
        invalidateActiveObjects: jest.fn(),
      },
      requestViewportUiRender: jest.fn(),
    };
    const { deviceContext } = createBoardDeviceContext("30", { viewport });

    tool.process(
      {
        to: "/viewport/stroke",
        signals: [{ type: "position", context: { value: new Vector(1, 2) } }],
      },
      deviceContext,
    );

    viewport.renderer.captureObjectSnapshot.mockClear();
    viewport.renderer.invalidateActiveObjects.mockClear();
    viewport.requestViewportUiRender.mockClear();

    tool.process(
      {
        to: "/viewport/stroke",
        signals: [{ type: "position", context: { value: new Vector(2, 3) } }],
      },
      deviceContext,
    );

    expect(viewport.renderer.captureObjectSnapshot).not.toHaveBeenCalled();
    expect(viewport.renderer.invalidateActiveObjects).not.toHaveBeenCalled();
    expect(viewport.requestViewportUiRender).toHaveBeenCalledTimes(1);
  });

  test("创建完成后应通过 commitObjects 提交笔画对象", () => {
    const tool = new StrokeCreatorTool();
    const { deviceContext } = createBoardDeviceContext("21");
    const boardApi = deviceContext.services.boardApi;

    tool.process(
      {
        to: "/viewport/stroke",
        signals: [{ type: "position", context: { value: new Vector(1, 2) } }],
      },
      deviceContext,
    );

    tool.process(
      {
        to: "/viewport/stroke",
        signals: [{ type: "end", context: {} }],
      },
      deviceContext,
    );

    expect(boardApi.commitObjects).toHaveBeenCalledWith(["21"]);
  });

  test("取消创建后不应提交对象", () => {
    const tool = new StrokeCreatorTool();
    const { deviceContext } = createBoardDeviceContext("22");
    const boardApi = deviceContext.services.boardApi;

    tool.process(
      {
        to: "/viewport/stroke",
        signals: [{ type: "position", context: { value: new Vector(1, 2) } }],
      },
      deviceContext,
    );

    tool.process(
      {
        to: "/viewport/stroke",
        signals: [{ type: "cancel", context: {} }],
      },
      deviceContext,
    );

    expect(boardApi.commitObjects).not.toHaveBeenCalled();
    expect(boardApi.discardActiveObjects).toHaveBeenCalledWith(["22"]);
  });

  test("连续两次创建应生成两个不同笔画对象", () => {
    const tool = new StrokeCreatorTool();
    const { deviceContext } = createBoardDeviceContext("31");
    const board = deviceContext.services.board;
    const boardApi = deviceContext.services.boardApi;
    board.allocateObjectId = jest
      .fn()
      .mockReturnValueOnce("31")
      .mockReturnValueOnce("32");
    const commitSpy = jest.spyOn(boardApi, "commitObjects");

    tool.process(
      {
        to: "/viewport/stroke",
        signals: [{ type: "position", context: { value: new Vector(1, 2) } }],
      },
      { services: { board, boardApi } },
    );

    const firstObject = tool._entry;

    tool.process(
      {
        to: "/viewport/stroke",
        signals: [{ type: "end", context: {} }],
      },
      { services: { board, boardApi } },
    );

    tool.process(
      {
        to: "/viewport/stroke",
        signals: [{ type: "position", context: { value: new Vector(4, 5) } }],
      },
      { services: { board, boardApi } },
    );

    const secondObject = tool._entry;

    tool.process(
      {
        to: "/viewport/stroke",
        signals: [{ type: "end", context: {} }],
      },
      { services: { board, boardApi } },
    );

    expect(firstObject).not.toBe(secondObject);
    expect(firstObject.id).toBe("31");
    expect(secondObject.id).toBe("32");
    expect(commitSpy).toHaveBeenNthCalledWith(1, ["31"]);
    expect(commitSpy).toHaveBeenNthCalledWith(2, ["32"]);
  });

  describe("分子管线（beginMol/amendMol/endMol/abortMol）", () => {
    test("同步分子管线：beginMol(create) → amend 追点 → endMol → commitObjects 严格次序", () => {
      const calls = [];
      const { boardApi, deviceContext } = createMolBoardDeviceContext("100", {
        boardApiOverrides: {
          createObject: jest.fn(() => {
            calls.push("createObject");
            return Promise.resolve("100");
          }),
          beginMol: jest.fn(() => {
            calls.push("beginMol");
            return "demo/mol-1";
          }),
          amendMol: jest.fn(() => {
            calls.push("amendMol");
            return true;
          }),
          endMol: jest.fn(() => {
            calls.push("endMol");
            return true;
          }),
          commitObjects: jest.fn(() => {
            calls.push("commitObjects");
            return Promise.resolve(["100"]);
          }),
        },
      });
      const tool = new StrokeCreatorTool();

      tool.process(
        {
          signals: [{ type: "position", context: { value: new Vector(1, 2) } }],
        },
        deviceContext,
      );
      tool.process(
        {
          signals: [{ type: "position", context: { value: new Vector(2, 3) } }],
        },
        deviceContext,
      );
      tool.process(
        {
          signals: [
            { type: "position", context: { value: new Vector(3, 4) } },
            { type: "end", context: {} },
          ],
        },
        deviceContext,
      );

      expect(boardApi.beginMol).toHaveBeenCalledWith(["100"], {
        create: true,
        supraKey: "S",
      });
      // 逐点追点改经 amend 流（append patch），不再直调 appendListItem
      expect(boardApi.amendMol).toHaveBeenCalledTimes(3);
      expect(boardApi.amendMol).toHaveBeenNthCalledWith(1, "demo/mol-1", {
        "100": { append: { key: "points", items: [{ x: 0, y: 0 }] } },
      });
      expect(boardApi.amendMol).toHaveBeenNthCalledWith(3, "demo/mol-1", {
        "100": { append: { key: "points", items: [{ x: 2, y: 2 }] } },
      });
      expect(boardApi.appendListItem).not.toHaveBeenCalled();
      expect(boardApi.endMol).toHaveBeenCalledWith("demo/mol-1");
      expect(boardApi.commitObjects).toHaveBeenCalledWith(["100"]);
      expect(calls).toEqual([
        "createObject",
        "beginMol",
        "amendMol",
        "amendMol",
        "amendMol",
        "endMol",
        "commitObjects",
      ]);
    });

    test("手势进行中取消：abortMol 中止分子，不再 discardActiveObjects，不提交", () => {
      const { boardApi, deviceContext } = createMolBoardDeviceContext("101");
      const tool = new StrokeCreatorTool();

      tool.process(
        {
          signals: [{ type: "position", context: { value: new Vector(1, 2) } }],
        },
        deviceContext,
      );
      tool.process(
        {
          signals: [{ type: "position", context: { value: new Vector(2, 3) } }],
        },
        deviceContext,
      );
      tool.process(
        { signals: [{ type: "cancel", context: {} }] },
        deviceContext,
      );

      expect(boardApi.abortMol).toHaveBeenCalledWith("demo/mol-1");
      expect(boardApi.endMol).not.toHaveBeenCalled();
      expect(boardApi.discardActiveObjects).not.toHaveBeenCalled();
      expect(boardApi.commitObjects).not.toHaveBeenCalled();
      expect(tool._entry).toBeNull();
    });

    test("Worker 挂起：molId 确认前 append 按序缓冲，确认后合并补发再延迟 endMol/commit", async () => {
      const calls = [];
      let resolveBegin;
      const beginPromise = new Promise((resolve) => {
        resolveBegin = resolve;
      });
      const { boardApi, deviceContext } = createMolBoardDeviceContext("102", {
        boardApiOverrides: {
          beginMol: jest.fn(() => {
            calls.push("beginMol");
            return beginPromise;
          }),
          amendMol: jest.fn(() => {
            calls.push("amendMol");
            return true;
          }),
          endMol: jest.fn(() => {
            calls.push("endMol");
            return true;
          }),
          commitObjects: jest.fn(() => {
            calls.push("commitObjects");
            return Promise.resolve(["102"]);
          }),
        },
      });
      const tool = new StrokeCreatorTool();

      tool.process(
        {
          signals: [{ type: "position", context: { value: new Vector(1, 2) } }],
        },
        deviceContext,
      );
      tool.process(
        {
          signals: [{ type: "position", context: { value: new Vector(2, 3) } }],
        },
        deviceContext,
      );
      expect(boardApi.beginMol).toHaveBeenCalledTimes(1);
      expect(boardApi.amendMol).not.toHaveBeenCalled();
      expect(boardApi.appendListItem).not.toHaveBeenCalled();

      // 松手时 molId 仍未确认：endMol/commit 均延迟
      tool.process(
        {
          signals: [
            { type: "position", context: { value: new Vector(3, 4) } },
            { type: "end", context: {} },
          ],
        },
        deviceContext,
      );
      expect(boardApi.endMol).not.toHaveBeenCalled();
      expect(boardApi.commitObjects).not.toHaveBeenCalled();
      // 本地草稿即时完整（渲染不等内核）
      expect(tool._entry.data.points).toEqual([
        { x: 0, y: 0 },
        { x: 1, y: 1 },
        { x: 2, y: 2 },
      ]);

      // molId 到达：三点保序合并为一条 amend 补发，随后 endMol → commitObjects
      resolveBegin("demo/mol-1");
      await flushMicrotasks();
      expect(boardApi.amendMol).toHaveBeenCalledTimes(1);
      expect(boardApi.amendMol).toHaveBeenCalledWith("demo/mol-1", {
        "102": {
          append: {
            key: "points",
            items: [
              { x: 0, y: 0 },
              { x: 1, y: 1 },
              { x: 2, y: 2 },
            ],
          },
        },
      });
      expect(boardApi.endMol).toHaveBeenCalledWith("demo/mol-1");
      expect(boardApi.commitObjects).toHaveBeenCalledWith(["102"]);
      expect(calls).toEqual([
        "beginMol",
        "amendMol",
        "endMol",
        "commitObjects",
      ]);
    });

    test("Worker 挂起期间取消：molId 到达后执行延迟 abortMol，不补发不提交", async () => {
      let resolveBegin;
      const beginPromise = new Promise((resolve) => {
        resolveBegin = resolve;
      });
      const { boardApi, deviceContext } = createMolBoardDeviceContext("103", {
        boardApiOverrides: {
          beginMol: jest.fn(() => beginPromise),
        },
      });
      const tool = new StrokeCreatorTool();

      tool.process(
        {
          signals: [{ type: "position", context: { value: new Vector(1, 2) } }],
        },
        deviceContext,
      );
      tool.process(
        {
          signals: [{ type: "position", context: { value: new Vector(2, 3) } }],
        },
        deviceContext,
      );
      tool.process(
        { signals: [{ type: "cancel", context: {} }] },
        deviceContext,
      );
      // 确认前不直接 abort/discard（分子句柄尚未到达）
      expect(boardApi.abortMol).not.toHaveBeenCalled();
      expect(boardApi.discardActiveObjects).not.toHaveBeenCalled();

      resolveBegin("demo/mol-1");
      await flushMicrotasks();
      expect(boardApi.abortMol).toHaveBeenCalledWith("demo/mol-1");
      expect(boardApi.amendMol).not.toHaveBeenCalled();
      expect(boardApi.appendListItem).not.toHaveBeenCalled();
      expect(boardApi.endMol).not.toHaveBeenCalled();
      expect(boardApi.commitObjects).not.toHaveBeenCalled();
      expect(boardApi.discardActiveObjects).not.toHaveBeenCalled();
    });

    test("beginMol 同步抛错：回退 appendListItem 直调路径，不产分子", () => {
      const { boardApi, deviceContext } = createMolBoardDeviceContext("104", {
        boardApiOverrides: {
          beginMol: jest.fn(() => {
            throw new Error("超分子 S 未开启（分子无法指定进入）");
          }),
        },
      });
      const tool = new StrokeCreatorTool();

      tool.process(
        {
          signals: [{ type: "position", context: { value: new Vector(1, 2) } }],
        },
        deviceContext,
      );
      tool.process(
        {
          signals: [
            { type: "position", context: { value: new Vector(2, 3) } },
            { type: "end", context: {} },
          ],
        },
        deviceContext,
      );

      expect(boardApi.appendListItem).toHaveBeenCalledTimes(2);
      expect(boardApi.amendMol).not.toHaveBeenCalled();
      expect(boardApi.endMol).not.toHaveBeenCalled();
      expect(boardApi.commitObjects).toHaveBeenCalledWith(["104"]);
      expect(tool._entry.data.points).toEqual([
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ]);
    });

    test("集成：真实内核创建笔画——add-object 分子记录带 molId，commitObjects 不重复 add", async () => {
      const { BoardApi } = await import(
        "../../../../../kernel/api/board-api.js"
      );
      const { BoardCore } = await import(
        "../../../../../kernel/board/board-core.js"
      );
      const { createDefaultAomRenderHooks } = await import(
        "../../../../../kernel/board/aom-render-hooks.js"
      );
      const { createDefaultPersistenceAdapter } = await import(
        "../../../../../kernel/board/persistence-adapter.js"
      );
      const boardCore = new BoardCore({
        width: 800,
        height: 600,
        source: "demo",
        aomRenderHooks: createDefaultAomRenderHooks(),
        persistenceAdapter: createDefaultPersistenceAdapter(),
      });
      const api = new BoardApi(boardCore);

      const _nodeState = {};
      const deviceContext = {
        path: "/test",
        getNodeState: () => ({ ..._nodeState }),
        setNodeState: (_pathOrId, state) => {
          Object.assign(_nodeState, state);
          return { ..._nodeState };
        },
        services: {
          board: { allocateObjectId: jest.fn(() => "1") },
          boardApi: api,
        },
      };

      const tool = new StrokeCreatorTool();
      tool.process(
        {
          signals: [{ type: "position", context: { value: new Vector(5, 5) } }],
        },
        deviceContext,
      );
      tool.process(
        {
          signals: [{ type: "position", context: { value: new Vector(10, 8) } }],
        },
        deviceContext,
      );
      tool.process(
        {
          signals: [
            { type: "position", context: { value: new Vector(12, 13) } },
            { type: "end", context: {} },
          ],
        },
        deviceContext,
      );
      await flushMicrotasks();

      // 对象已提交到静态图，点列完整
      expect(boardCore.activeObjectManager.has("1")).toBe(false);
      const snapshot = api.queryObject("1");
      expect(snapshot.position).toEqual({ x: 5, y: 5 });
      expect(snapshot.data.points).toEqual([
        { x: 0, y: 0 },
        { x: 5, y: 3 },
        { x: 7, y: 8 },
      ]);

      // add-object 分子记录带 molId 且仅一条（commitObjects 凭物化水位跳过重复 add）
      const adds = api
        .queryOperations({ type: "add-object" })
        .filter((record) => record.payload?.objectId === "1");
      expect(adds).toHaveLength(1);
      expect(adds[0].molId).not.toBeNull();
    });
  });

  describe("端到端集成（通过 Board 输入链路）", () => {
    test("挂载后的 StrokeCreatorTool 应可经由 Board 输入链路创建对象并提交到白板", async () => {
      const { board, viewport, cleanup } = await createWorkerBoardContext({
        boardWidth: 800,
        boardHeight: 600,
        viewportId: "main",
        viewportWidth: 800,
        viewportHeight: 600,
      });

      try {
        const tool = new StrokeCreatorTool();
        viewport.origin = new Vector(100, 50);
        viewport.zoom = 2;

        viewport.inputScope.mountDevice("", createMouseDevice());
        viewport.inputScope.mountWorkflow("primary-stroke", tool);
        viewport.inputScope.addEdge({
          from: "mouse/primary",
          to: "workflows/primary-stroke",
        });

        // canvas 相对坐标：world=(105,60) → ((105-100)*2, (60-50)*2) = (10, 20)
        board.signalsEventBus.emit("input", {
          to: "/main/mouse",
          signals: [
            {
              type: "position",
              context: {
                value: new Vector(10, 20),
                buttons: 1,
                button: 0,
              },
            },
          ],
        });

        // canvas 相对坐标：world=(110,65) → ((110-100)*2, (65-50)*2) = (20, 30)
        board.signalsEventBus.emit("input", {
          to: "/main/mouse",
          signals: [
            {
              type: "position",
              context: {
                value: new Vector(20, 30),
                buttons: 1,
                button: 0,
              },
            },
          ],
        });

        board.signalsEventBus.emit("input", {
          to: "/main/mouse",
          signals: [
            {
              type: "end",
              context: {
                buttons: 0,
                button: 0,
              },
            },
          ],
        });
        await flushMicrotasks();

        await expect(
          board.getBoardApi().queryObjectDetails([tool._entry.id]),
        ).resolves.toEqual([
          expect.objectContaining({
            id: tool._entry.id,
            isActive: false,
            position: { x: 105, y: 60 },
            data: expect.objectContaining({
              points: [
                { x: 0, y: 0 },
                { x: 5, y: 5 },
              ],
            }),
          }),
        ]);
        expect(tool._entry.id).toBe("1");
        expect(tool._entry.position.serialize()).toEqual({ x: 105, y: 60 });
        expect(tool._entry.data.points).toEqual([
          { x: 0, y: 0 },
          { x: 5, y: 5 },
        ]);
      } finally {
        cleanup();
      }
    });

    test("挂载后的 StrokeCreatorTool 在绘制中应将对象保持在 Worker 的活动态", async () => {
      const { board, viewport, cleanup } = await createWorkerBoardContext({
        boardWidth: 800,
        boardHeight: 600,
        viewportId: "main",
        viewportWidth: 800,
        viewportHeight: 600,
      });

      try {
        const tool = new StrokeCreatorTool();
        viewport.origin = new Vector(100, 50);
        viewport.zoom = 2;

        viewport.inputScope.mountDevice("", createMouseDevice());

        viewport.inputScope.mountWorkflow("primary-stroke", tool);
        viewport.inputScope.addEdge({
          from: "mouse/primary",
          to: "workflows/primary-stroke",
        });

        board.signalsEventBus.emit("input", {
          to: "/main/mouse",
          signals: [
            {
              type: "position",
              context: {
                value: new Vector(105, 60),
                buttons: 1,
                button: 0,
              },
            },
          ],
        });
        await flushMicrotasks();

        await expect(
          board.getBoardApi().queryObjectDetails([tool._entry.id]),
        ).resolves.toEqual([
          expect.objectContaining({
            id: tool._entry.id,
            isActive: true,
          }),
        ]);
      } finally {
        cleanup();
      }
    });
  });
});
