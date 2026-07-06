import { jest } from "@jest/globals";
import { ObjectModifierTool } from "../object-modifier.js";
import { RectangleRange } from "../../../range/index.js";

describe("ObjectModifierTool", () => {
  test("withGeometryMutation 应按快照再失效的顺序包装一次几何修改", () => {
    class TestModifierTool extends ObjectModifierTool {
      modify(modificationContext) {
        return this.withGeometryMutation(modificationContext, () => {
          modificationContext.object.changed = true;
          return "done";
        });
      }
    }

    const tool = new TestModifierTool();
    const object = { id: 1, changed: false };
    const calls = [];
    const modificationContext = {
      acc: {
        viewport: {
          liveRenderer: {
            captureObjectSnapshot(objects) {
              calls.push(["capture", objects]);
            },
            invalidateObjects(objects) {
              calls.push(["invalidate", objects]);
            },
          },
          requestViewportUiRender() {
            calls.push(["ui", undefined]);
          },
        },
        object,
        objects: [object],
      },
      object,
    };

    const result = tool.modify(modificationContext);

    expect(result).toBe("done");
    expect(object.changed).toBe(true);
    expect(calls).toEqual([
      ["capture", [object]],
      ["invalidate", [object]],
      ["ui", undefined],
    ]);
  });

  test("beforeGeometryMutation 和 afterGeometryMutation 应支持 objects 集合上下文", () => {
    class TestModifierTool extends ObjectModifierTool {
      modify() {
        return undefined;
      }
    }

    const tool = new TestModifierTool();
    const objects = [{ id: 1 }, { id: 2 }];
    const viewport = {
      liveRenderer: {
        captureObjectSnapshot: jest.fn(),
        invalidateObjects: jest.fn(),
      },
      requestViewportUiRender: jest.fn(),
    };
    const modificationContext = {
      acc: { viewport, objects: new Set(objects) },
    };

    tool.beforeGeometryMutation(modificationContext);
    tool.afterGeometryMutation(modificationContext);

    expect(viewport.liveRenderer.captureObjectSnapshot).toHaveBeenCalledWith(
      objects,
    );
    expect(viewport.liveRenderer.invalidateObjects).toHaveBeenCalledWith(
      objects,
    );
    expect(viewport.requestViewportUiRender).toHaveBeenCalledTimes(1);
  });

  test("显式提供 boardApi 时 withGeometryMutation 应跳过 liveRenderer 并仅刷新 overlay", () => {
    class TestModifierTool extends ObjectModifierTool {
      modify(modificationContext) {
        return this.withGeometryMutation(modificationContext, () => {
          modificationContext.object.changed = true;
          return "done";
        }, [modificationContext.object]);
      }
    }

    const tool = new TestModifierTool();
    const object = { id: 21, changed: false };
    const viewport = {
      liveRenderer: {
        captureObjectSnapshot: jest.fn(),
        invalidateObjects: jest.fn(),
      },
      requestViewportUiRender: jest.fn(),
    };
    const modificationContext = {
      acc: {
        boardApi: {},
        viewport,
        objects: [object],
      },
      object,
    };

    const result = tool.modify(modificationContext);

    expect(result).toBe("done");
    expect(object.changed).toBe(true);
    expect(viewport.liveRenderer.captureObjectSnapshot).not.toHaveBeenCalled();
    expect(viewport.liveRenderer.invalidateObjects).not.toHaveBeenCalled();
    expect(viewport.requestViewportUiRender).toHaveBeenCalledTimes(1);
  });

  test("collectUiOverlayEntries 应读取 _overlayModifiedObjects 并委托 renderer", () => {
    class TestModifierTool extends ObjectModifierTool {
      modify() {
        return undefined;
      }
    }

    const tool = new TestModifierTool();
    const object = {
      id: 3,
      position: { x: 10, y: 20 },
      range: new RectangleRange(0, 0, 30, 40),
      property: {},
    };
    const viewport = {
      zoom: 1,
      worldRectToScreenRect(rect, padding = 0) {
        return RectangleRange.from(rect)?.inflate?.(padding);
      },
    };
    const drawRectEntry = jest.fn();

    tool._overlayModifiedObjects = [object];
    const entries = tool.collectUiOverlayEntries({
      viewport,
      renderer: { drawRectEntry },
    });

    expect(entries).toHaveLength(1);
    expect(entries[0].objectId).toBe(3);
    expect(entries[0].type).toBe("rect");
  });

  describe("生命周期钩子", () => {
    test("applyModifiedObjects 成功后同时触发 action:complete 与 afterApply 通知", () => {
      class TestModifier extends ObjectModifierTool {
        modify() {}
      }

      const tool = new TestModifier();
      const afterApply = jest.fn();
      const actionComplete = jest.fn();
      tool.on("afterApply", afterApply);
      tool.on("action:complete", actionComplete);

      const object = { id: 10 };
      const boardApi = {
        commitObjects: jest.fn(),
        discardActiveObjects: jest.fn(),
      };

      tool.applyModifiedObjects(
        { acc: { boardApi, objects: [object] }, path: "/test" },
        [object],
      );

      expect(boardApi.commitObjects).toHaveBeenCalledWith([10]);
      expect(actionComplete).toHaveBeenCalledTimes(1);
      expect(actionComplete).toHaveBeenCalledWith(
        expect.objectContaining({ path: "/test" }),
        true,
      );
      expect(afterApply).toHaveBeenCalledTimes(1);
      expect(afterApply.mock.calls[0][1]).toEqual([object]);
      expect(afterApply.mock.calls[0][2]).toBe(true);
    });

    test("beforeApplyModifiedObjects 返回 false 时阻止 apply", () => {
      class TestModifier extends ObjectModifierTool {
        modify() {}
      }

      const tool = new TestModifier();
      const afterApply = jest.fn();
      const actionComplete = jest.fn();
      tool.on("afterApply", afterApply);
      tool.on("action:complete", actionComplete);
      tool.beforeApplyModifiedObjects = () => false;

      const object = { id: 11 };
      const commitObjects = jest.fn();
      const boardApi = {
        commitObjects,
        discardActiveObjects: jest.fn(),
      };

      const result = tool.applyModifiedObjects(
        { acc: { boardApi, objects: [object] }, path: "/test" },
        [object],
      );

      expect(result).toBe(false);
      expect(commitObjects).not.toHaveBeenCalled();
      expect(actionComplete).not.toHaveBeenCalled();
      expect(afterApply).not.toHaveBeenCalled();
    });

    test("autoUmountOnApply 通过 context 注入 false 时阻止自卸载", () => {
      class TestModifier extends ObjectModifierTool {
        modify() {}
      }

      const tool = new TestModifier();
      const object = { id: 12 };
      const unmount = jest.fn();
      const boardApi = {
        commitObjects: jest.fn(),
        discardActiveObjects: jest.fn(),
      };

      tool.applyModifiedObjects(
        {
          acc: { boardApi, objects: [object], autoUmountOnApply: false },
          dag: { unmount },
          path: "/test",
        },
        [object],
      );

      // apply 正常执行
      expect(boardApi.commitObjects).toHaveBeenCalledWith([12]);
      // 但 unmount 不应被调用
      expect(unmount).not.toHaveBeenCalled();
    });

    test("autoUmountOnApply 默认行为 → 提交后自卸载", () => {
      class TestModifier extends ObjectModifierTool {
        modify() {}
      }

      const tool = new TestModifier();
      const object = { id: 13 };
      const unmount = jest.fn();
      const boardApi = {
        commitObjects: jest.fn(),
        discardActiveObjects: jest.fn(),
      };

      tool.applyModifiedObjects(
        {
          acc: { boardApi, objects: [object] },
          dag: { unmount },
          path: "/test",
        },
        [object],
      );

      expect(boardApi.commitObjects).toHaveBeenCalledWith([13]);
      expect(unmount).toHaveBeenCalledWith("/test");
    });

    test("显式提供 boardApi 时 applyModifiedObjects 和 umount 应走 BoardApi 生命周期", () => {
      class TestModifier extends ObjectModifierTool {
        modify() {}
      }

      const tool = new TestModifier();
      const object = { id: 14 };
      const commitObjects = jest.fn();
      const discardActiveObjects = jest.fn();
      const boardApi = {
        commitObjects,
        discardActiveObjects,
      };
      const unmount = jest.fn();
      const context = {
        acc: { boardApi, objects: [object] },
        dag: { unmount },
        path: "/test",
      };

      expect(tool.applyModifiedObjects(context, [object])).toBe(true);
      expect(commitObjects).toHaveBeenCalledWith([object.id]);
      expect(unmount).toHaveBeenCalledWith("/test");

      tool.setContextObjects(context, [object]);
      tool.umount(context);
      expect(discardActiveObjects).toHaveBeenCalledWith([object.id]);
    });
  });
});
