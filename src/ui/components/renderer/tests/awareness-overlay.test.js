/**
 * @file awareness overlay 测试
 * @description 验证远程命名选择的装饰条目收集、刷新串行化与生命周期。
 * @author Zhou Chenyu
 */

import { jest } from "@jest/globals";

import { AwarenessOverlay } from "../awareness-overlay.js";
import { RectangleRange } from "../../../../kernel/range/index.js";

/**
 * 创建 mock BoardApi RPC 面
 * @param {Object} options - 选项
 * @param {{ source: string, name?: string, ids: string[] }[]} options.choices - 远程选择列表
 * @returns {Object} mock RPC 面
 */
function createMockBoardApi({ choices = [] } = {}) {
  const summaries = new Map();
  for (const choice of choices) {
    for (const id of choice.ids) {
      summaries.set(id, {
        id,
        position: { x: 10, y: 10 },
        range: new RectangleRange(0, 0, 20, 20),
      });
    }
  }
  return {
    queryRemoteChoices: jest.fn(async () => choices),
    queryObjects: jest.fn(async (ids) =>
      ids.map((id) => summaries.get(id)).filter(Boolean),
    ),
  };
}

/**
 * 创建 mock 视口
 * @returns {Object} mock 视口
 */
function createMockViewport() {
  const listeners = new Set();
  return {
    registerUiOverlayProvider: jest.fn(),
    unregisterUiOverlayProvider: jest.fn(),
    addAwarenessListener: jest.fn((l) => listeners.add(l)),
    removeAwarenessListener: jest.fn((l) => listeners.delete(l)),
    sendAwareness: jest.fn(),
    worldRectToScreenRect: (rect) => rect,
    uiRenderer: { invalidateViewport: jest.fn() },
    emitAwareness(message) {
      for (const listener of listeners) listener(message);
    },
  };
}

describe("AwarenessOverlay", () => {
  test("start 注册 provider 与监听，远程选择画着色框与标签", async () => {
    const boardApi = createMockBoardApi({
      choices: [{ source: "dev-b", name: "hold", ids: ["b/1"] }],
    });
    const viewport = createMockViewport();
    const overlay = new AwarenessOverlay({ boardApi, viewport });

    overlay.start();
    await overlay.refresh();

    expect(viewport.registerUiOverlayProvider).toHaveBeenCalledTimes(1);
    expect(viewport.addAwarenessListener).toHaveBeenCalledTimes(1);

    const provider = viewport.registerUiOverlayProvider.mock.calls[0][0];
    const entries = provider();

    // 一个对象框 + 一个来源标签
    expect(entries).toHaveLength(2);
    const frame = entries.find((e) => e.objectId === "b/1");
    expect(frame.style.strokeStyle).toBeTruthy();
    expect(frame.style.lineDash).toEqual([6, 3]);
    const label = entries.find((e) =>
      e.source.startsWith("awareness-label:"),
    );
    expect(label).toBeDefined();
    expect(typeof label.draw).toBe("function");
    overlay.stop();
  });

  test("remote-activity 消息触发刷新，按来源稳定取色", async () => {
    const boardApi = createMockBoardApi({
      choices: [
        { source: "dev-b", name: "x", ids: ["b/1"] },
        { source: "dev-c", name: "y", ids: ["c/1"] },
      ],
    });
    const viewport = createMockViewport();
    const overlay = new AwarenessOverlay({ boardApi, viewport });
    overlay.start();
    await overlay.refresh();

    const before = boardApi.queryRemoteChoices.mock.calls.length;
    expect(before).toBeGreaterThanOrEqual(1);

    viewport.emitAwareness({ type: "awareness", awarenessType: "remote-activity" });
    await overlay.refresh();

    expect(
      boardApi.queryRemoteChoices.mock.calls.length,
    ).toBeGreaterThan(before);

    const provider = viewport.registerUiOverlayProvider.mock.calls[0][0];
    const entries = provider();
    const colors = entries
      .filter((e) => e.objectId)
      .map((e) => e.style.strokeStyle);
    expect(new Set(colors).size).toBe(2);
    overlay.stop();
  });

  test("刷新串行化：刷新期间的通知合并为一次追加刷新", async () => {
    const boardApi = createMockBoardApi({
      choices: [{ source: "dev-b", name: "hold", ids: ["b/1"] }],
    });
    const viewport = createMockViewport();
    const overlay = new AwarenessOverlay({ boardApi, viewport });
    overlay.start();
    await overlay.refresh();

    // 并发触发两次刷新：第一次进行中时第二次只标记待办
    const first = overlay.refresh();
    const second = overlay.refresh();
    await Promise.all([first, second]);

    // start 1 次 + 首次 refresh 内联 1 次 + 并发合并 1 次 = 至多 3 次拉取
    expect(
      boardApi.queryRemoteChoices.mock.calls.length,
    ).toBeLessThanOrEqual(3);
    overlay.stop();
  });

  test("stop 注销 provider 与监听并清空条目", async () => {
    const boardApi = createMockBoardApi({
      choices: [{ source: "dev-b", name: "hold", ids: ["b/1"] }],
    });
    const viewport = createMockViewport();
    const overlay = new AwarenessOverlay({ boardApi, viewport });
    overlay.start();
    await overlay.refresh();

    overlay.stop();

    expect(viewport.unregisterUiOverlayProvider).toHaveBeenCalledTimes(1);
    expect(viewport.removeAwarenessListener).toHaveBeenCalledTimes(1);
    const provider = viewport.registerUiOverlayProvider.mock.calls[0][0];
    expect(provider()).toEqual([]);
  });

  test("远程光标：cursor 消息画点，peer-left 移除", async () => {
    const boardApi = createMockBoardApi();
    const viewport = createMockViewport();
    const overlay = new AwarenessOverlay({ boardApi, viewport });
    overlay.start();
    await overlay.refresh();

    viewport.emitAwareness({
      type: "awareness",
      awarenessType: "cursor",
      source: "dev-b",
      data: { kind: "cursor", point: { x: 30, y: 40 } },
    });

    const provider = viewport.registerUiOverlayProvider.mock.calls[0][0];
    const cursorEntries = provider().filter((e) =>
      e.source.startsWith("awareness-cursor:"),
    );
    expect(cursorEntries).toHaveLength(1);
    expect(cursorEntries[0].geometry.worldPoint).toEqual({ x: 30, y: 40 });

    viewport.emitAwareness({
      type: "awareness",
      awarenessType: "peer-left",
      source: "dev-b",
    });
    expect(
      provider().filter((e) => e.source.startsWith("awareness-cursor:")),
    ).toEqual([]);
    overlay.stop();
  });

  test("远程光标过期自动消失", async () => {
    jest.useFakeTimers();
    try {
      const boardApi = createMockBoardApi();
      const viewport = createMockViewport();
      const overlay = new AwarenessOverlay({ boardApi, viewport });
      overlay.start();
      await overlay.refresh();

      viewport.emitAwareness({
        type: "awareness",
        awarenessType: "cursor",
        source: "dev-b",
        data: { kind: "cursor", point: { x: 1, y: 2 } },
      });
      const provider = viewport.registerUiOverlayProvider.mock.calls[0][0];
      expect(
        provider().filter((e) => e.source.startsWith("awareness-cursor:")),
      ).toHaveLength(1);

      jest.advanceTimersByTime(3500);
      expect(
        provider().filter((e) => e.source.startsWith("awareness-cursor:")),
      ).toEqual([]);
      overlay.stop();
    } finally {
      jest.useRealTimers();
    }
  });

  test("手势中间帧：选择框随预览位置画，远程选择消失后预览裁剪", async () => {
    const boardApi = createMockBoardApi({
      choices: [{ source: "dev-b", name: "hold", ids: ["b/1"] }],
    });
    const viewport = createMockViewport();
    const overlay = new AwarenessOverlay({ boardApi, viewport });
    overlay.start();
    await overlay.refresh();

    const provider = viewport.registerUiOverlayProvider.mock.calls[0][0];
    const frameBefore = provider().find((e) => e.objectId === "b/1");
    expect(frameBefore.geometry.worldRect.left).toBe(10);

    // mol-begin（修改型）：以 before 快照的 position 起预览
    viewport.emitAwareness({
      type: "awareness",
      awarenessType: "mol-begin",
      source: "dev-b",
      data: {
        kind: "mol-begin",
        molId: "dev-b/mol-1",
        entries: [{ objectId: "b/1", before: { position: { x: 10, y: 10 } } }],
      },
    });
    expect(provider().find((e) => e.objectId === "b/1").geometry.worldRect.left).toBe(10);

    // mol-amend 中间帧到达：框画到预览位置（patch.position 绝对覆盖）
    viewport.emitAwareness({
      type: "awareness",
      awarenessType: "mol-amend",
      source: "dev-b",
      data: {
        kind: "mol-amend",
        mols: [
          {
            molId: "dev-b/mol-1",
            seq: 1,
            entries: [
              { objectId: "b/1", patch: { position: { x: 99, y: 10 } } },
            ],
          },
        ],
      },
    });
    const framePreview = provider().find((e) => e.objectId === "b/1");
    expect(framePreview.geometry.worldRect.left).toBe(99);

    // 预览来源不符时不接受（互斥语义）：dev-c 的中间帧不动 dev-b 的预览
    viewport.emitAwareness({
      type: "awareness",
      awarenessType: "mol-amend",
      source: "dev-c",
      data: {
        kind: "mol-amend",
        mols: [
          {
            molId: "dev-c/mol-2",
            seq: 1,
            entries: [
              { objectId: "b/1", patch: { position: { x: 1, y: 1 } } },
            ],
          },
        ],
      },
    });
    expect(provider().find((e) => e.objectId === "b/1").geometry.worldRect.left).toBe(99);

    // 远程选择消失（对端 commit/unchoose 后刷新为空）：预览被裁剪
    boardApi.queryRemoteChoices.mockResolvedValue([]);
    viewport.emitAwareness({
      type: "awareness",
      awarenessType: "remote-activity",
    });
    await overlay.refresh();
    expect(provider().find((e) => e.objectId === "b/1")).toBeUndefined();
    overlay.stop();
  });

  test("创建中预览：append 的 points 画路径，mol-end 到达后清除", async () => {
    const boardApi = createMockBoardApi();
    const viewport = createMockViewport();
    const overlay = new AwarenessOverlay({ boardApi, viewport });
    overlay.start();
    await overlay.refresh();

    const provider = viewport.registerUiOverlayProvider.mock.calls[0][0];

    // 创建开始：mol-begin 携带 create 快照，后续 append 经 mol-amend 累积
    viewport.emitAwareness({
      type: "awareness",
      awarenessType: "mol-begin",
      source: "dev-b",
      data: {
        kind: "mol-begin",
        molId: "dev-b/mol-1",
        entries: [
          {
            objectId: "b/9",
            before: null,
            create: {
              type: "StrokeObject",
              id: "b/9",
              position: { x: 100, y: 100 },
              property: { width: 3 },
              data: { points: [{ x: 0, y: 0 }] },
            },
          },
        ],
      },
    });
    viewport.emitAwareness({
      type: "awareness",
      awarenessType: "mol-amend",
      source: "dev-b",
      data: {
        kind: "mol-amend",
        mols: [
          {
            molId: "dev-b/mol-1",
            seq: 1,
            entries: [
              {
                objectId: "b/9",
                patch: {
                  append: {
                    key: "points",
                    items: [{ x: 10, y: 0 }, { x: 20, y: 5 }],
                  },
                },
              },
            ],
          },
        ],
      },
    });

    const creation = provider().find((e) => e.objectId === "b/9");
    expect(creation).toBeDefined();
    expect(creation.source).toBe("awareness-creation:dev-b");
    expect(typeof creation.draw).toBe("function");

    // 分子物化完成：mol-end 到达，预览清除
    viewport.emitAwareness({
      type: "awareness",
      awarenessType: "mol-end",
      source: "dev-b",
      data: { kind: "mol-end", molId: "dev-b/mol-1" },
    });
    expect(provider().find((e) => e.objectId === "b/9")).toBeUndefined();

    // 竞态兜底：mol-end 之后到达的尾随批次（手势最后采样点）不得复活预览
    viewport.emitAwareness({
      type: "awareness",
      awarenessType: "mol-amend",
      source: "dev-b",
      data: {
        kind: "mol-amend",
        mols: [
          {
            molId: "dev-b/mol-1",
            seq: 2,
            entries: [
              {
                objectId: "b/9",
                patch: { append: { key: "points", items: [{ x: 30, y: 8 }] } },
              },
            ],
          },
        ],
      },
    });
    expect(provider().find((e) => e.objectId === "b/9")).toBeUndefined();
    overlay.stop();
  });

  test("重复 begin、重复或乱序 seq 不重复 append，结束后旧 begin 不复活", async () => {
    const boardApi = createMockBoardApi();
    const viewport = createMockViewport();
    const overlay = new AwarenessOverlay({ boardApi, viewport });
    overlay.start();
    await overlay.refresh();
    const provider = viewport.registerUiOverlayProvider.mock.calls[0][0];
    const begin = {
      kind: "mol-begin",
      molId: "dev-b/mol-dup",
      entries: [{
        objectId: "b/dup",
        before: null,
        create: {
          type: "StrokeObject",
          id: "b/dup",
          position: { x: 0, y: 0 },
          property: { width: 2 },
          data: { points: [{ x: 0, y: 0 }] },
        },
      }],
    };
    const amend = {
      kind: "mol-amend",
      mols: [{
        molId: "dev-b/mol-dup",
        seq: 1,
        entries: [{
          objectId: "b/dup",
          patch: { append: { key: "points", items: [{ x: 10, y: 0 }, { x: 20, y: 0 }] } },
        }],
      }],
    };
    viewport.emitAwareness({ type: "awareness", awarenessType: begin.kind, source: "dev-b", data: begin });
    viewport.emitAwareness({ type: "awareness", awarenessType: amend.kind, source: "dev-b", data: amend });
    viewport.emitAwareness({ type: "awareness", awarenessType: begin.kind, source: "dev-b", data: begin });
    viewport.emitAwareness({ type: "awareness", awarenessType: amend.kind, source: "dev-b", data: amend });

    const creation = provider().find((e) => e.objectId === "b/dup");
    const context = {
      save: jest.fn(), restore: jest.fn(), beginPath: jest.fn(),
      moveTo: jest.fn(), lineTo: jest.fn(), stroke: jest.fn(),
    };
    creation.draw(context, { viewport: { origin: { x: 0, y: 0 }, zoom: 1 } });
    expect(context.lineTo).toHaveBeenCalledTimes(2);

    viewport.emitAwareness({
      type: "awareness", awarenessType: "mol-end", source: "dev-b",
      data: { kind: "mol-end", molId: "dev-b/mol-dup" },
    });
    viewport.emitAwareness({ type: "awareness", awarenessType: begin.kind, source: "dev-b", data: begin });
    expect(provider().find((e) => e.objectId === "b/dup")).toBeUndefined();
    overlay.stop();
  });

  test("创建中预览：圆按 radius 中间帧更新轮廓，mol-abort 清除", async () => {
    const boardApi = createMockBoardApi();
    const viewport = createMockViewport();
    const overlay = new AwarenessOverlay({ boardApi, viewport });
    overlay.start();
    await overlay.refresh();
    const provider = viewport.registerUiOverlayProvider.mock.calls[0][0];

    viewport.emitAwareness({
      type: "awareness",
      awarenessType: "mol-begin",
      source: "dev-b",
      data: {
        kind: "mol-begin",
        molId: "dev-b/mol-3",
        entries: [
          {
            objectId: "b/10",
            before: null,
            create: {
              type: "CircleObject",
              id: "b/10",
              position: { x: 50, y: 50 },
              property: {},
              data: { radius: 0 },
            },
          },
        ],
      },
    });
    // 半径为 0：尚无轮廓
    expect(provider().find((e) => e.objectId === "b/10")).toBeUndefined();

    viewport.emitAwareness({
      type: "awareness",
      awarenessType: "mol-amend",
      source: "dev-b",
      data: {
        kind: "mol-amend",
        mols: [
          {
            molId: "dev-b/mol-3",
            seq: 1,
            entries: [
              { objectId: "b/10", patch: { data: { radius: 30 } } },
            ],
          },
        ],
      },
    });
    const creation = provider().find((e) => e.objectId === "b/10");
    expect(creation).toBeDefined();
    expect(creation.geometry.worldRect.left).toBe(20);
    expect(creation.geometry.worldRect.width).toBe(60);

    // 分子中止：mol-abort 清除创建预览
    viewport.emitAwareness({
      type: "awareness",
      awarenessType: "mol-abort",
      source: "dev-b",
      data: { kind: "mol-abort", molId: "dev-b/mol-3" },
    });
    expect(provider().find((e) => e.objectId === "b/10")).toBeUndefined();
    overlay.stop();
  });

  test("peer-left 按来源清除分子预览与分子索引", async () => {
    const boardApi = createMockBoardApi();
    const viewport = createMockViewport();
    const overlay = new AwarenessOverlay({ boardApi, viewport });
    overlay.start();
    await overlay.refresh();
    const provider = viewport.registerUiOverlayProvider.mock.calls[0][0];

    viewport.emitAwareness({
      type: "awareness",
      awarenessType: "mol-begin",
      source: "dev-b",
      data: {
        kind: "mol-begin",
        molId: "dev-b/mol-4",
        entries: [
          {
            objectId: "b/11",
            before: null,
            create: {
              type: "CircleObject",
              id: "b/11",
              position: { x: 50, y: 50 },
              property: {},
              data: { radius: 10 },
            },
          },
        ],
      },
    });
    expect(provider().find((e) => e.objectId === "b/11")).toBeDefined();

    // peer-left 清除创建预览；其后的 mol-end 不得再触动任何条目
    viewport.emitAwareness({
      type: "awareness",
      awarenessType: "peer-left",
      source: "dev-b",
    });
    expect(provider().find((e) => e.objectId === "b/11")).toBeUndefined();
    viewport.emitAwareness({
      type: "awareness",
      awarenessType: "mol-end",
      source: "dev-b",
      data: { kind: "mol-end", molId: "dev-b/mol-4" },
    });
    expect(provider().find((e) => e.objectId === "b/11")).toBeUndefined();
    overlay.stop();
  });
});
