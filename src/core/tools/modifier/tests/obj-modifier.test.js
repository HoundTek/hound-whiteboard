import { jest } from "@jest/globals";
import { ObjectModifierTool } from "../obj-modifier.js";

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
        monitor: {
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
    const monitor = {
      liveRenderer: {
        captureObjectSnapshot: jest.fn(),
        invalidateObjects: jest.fn(),
      },
      requestViewportUiRender: jest.fn(),
    };
    const modificationContext = {
      acc: { monitor, objects: new Set(objects) },
    };

    tool.beforeGeometryMutation(modificationContext);
    tool.afterGeometryMutation(modificationContext);

    expect(monitor.liveRenderer.captureObjectSnapshot).toHaveBeenCalledWith(
      objects,
    );
    expect(monitor.liveRenderer.invalidateObjects).toHaveBeenCalledWith(
      objects,
    );
    expect(monitor.requestViewportUiRender).toHaveBeenCalledTimes(1);
  });

  test("collectUiOverlayEntries 应把当前修改对象声明给 renderer", () => {
    class TestModifierTool extends ObjectModifierTool {
      modify() {
        return undefined;
      }
    }

    const tool = new TestModifierTool();
    const object = { id: 3 };
    const renderer = {
      createCompatSelectionEntriesForObjects: jest.fn(() => [
        "modifier-overlay",
      ]),
    };

    expect(
      tool.collectUiOverlayEntries({
        deviceContext: { acc: { objects: [object] } },
        renderer,
      }),
    ).toEqual(["modifier-overlay"]);
    expect(
      renderer.createCompatSelectionEntriesForObjects,
    ).toHaveBeenCalledWith([object], "modifier");
  });

  describe("生命周期钩子", () => {
    test("applyModifiedObjects 成功后触发 afterApply 通知", () => {
      class TestModifier extends ObjectModifierTool {
        modify() {}
      }

      const tool = new TestModifier();
      const afterApply = jest.fn();
      tool.on("afterApply", afterApply);

      const object = { id: 10 };
      const board = {
        activeObjectManager: {
          activeObjectIndex: new Map([[object.id, object]]),
          apply: jest.fn(),
        },
      };

      tool.applyModifiedObjects({ acc: { board }, path: "/test" }, [object]);

      expect(board.activeObjectManager.apply).toHaveBeenCalledWith(
        new Set([object]),
      );
      expect(afterApply).toHaveBeenCalledTimes(1);
      expect(afterApply.mock.calls[0][2]).toBe(true);
    });

    test("beforeApplyModifiedObjects 返回 false 时阻止 apply", () => {
      class TestModifier extends ObjectModifierTool {
        modify() {}
      }

      const tool = new TestModifier();
      const afterApply = jest.fn();
      tool.on("afterApply", afterApply);
      tool.beforeApplyModifiedObjects = () => false;

      const object = { id: 11 };
      const apply = jest.fn();
      const board = {
        activeObjectManager: {
          activeObjectIndex: new Map([[object.id, object]]),
          apply,
        },
      };

      const result = tool.applyModifiedObjects(
        { acc: { board }, path: "/test" },
        [object],
      );

      expect(result).toBe(false);
      expect(apply).not.toHaveBeenCalled();
      expect(afterApply).not.toHaveBeenCalled();
    });

    test("autoUmountOnApply 通过 context 注入 false 时阻止自卸载", () => {
      class TestModifier extends ObjectModifierTool {
        modify() {}
      }

      const tool = new TestModifier();
      const object = { id: 12 };
      const unmount = jest.fn();
      const board = {
        activeObjectManager: {
          activeObjectIndex: new Map([[object.id, object]]),
          apply: jest.fn(),
        },
      };

      tool.applyModifiedObjects(
        {
          acc: { board, autoUmountOnApply: false },
          dag: { unmount },
          path: "/test",
        },
        [object],
      );

      // apply 正常执行
      expect(board.activeObjectManager.apply).toHaveBeenCalled();
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
      const board = {
        activeObjectManager: {
          activeObjectIndex: new Map([[object.id, object]]),
          apply: jest.fn(),
        },
      };

      tool.applyModifiedObjects({ board, dag: { unmount }, path: "/test" }, [
        object,
      ]);

      expect(unmount).toHaveBeenCalledWith("/test");
    });
  });
});
