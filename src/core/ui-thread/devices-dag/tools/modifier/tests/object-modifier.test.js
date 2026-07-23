import { jest } from "@jest/globals";
import { ObjectModifierTool } from "../object-modifier.js";
import { RectangleRange } from "../../../../../engine/range/index.js";
import { Vector } from "../../../../../engine/utils/math.js";

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
    const _nodeState = { objects: [object] };
    const calls = [];
    const modificationContext = {
      path: "/test",
      getNodeState: () => ({ ..._nodeState }),
      setNodeState: (_pathOrId, state) => {
        Object.assign(_nodeState, state);
        return { ..._nodeState };
      },
      services: {
        viewport: {
          renderer: {
            captureObjectSnapshot(objects) {
              calls.push(["capture", objects]);
            },
            invalidateActiveObjects(objects) {
              calls.push(["invalidate", objects]);
            },
          },
          requestViewportUiRender() {
            calls.push(["ui", undefined]);
          },
        },
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
      renderer: {
        captureObjectSnapshot: jest.fn(),
        invalidateActiveObjects: jest.fn(),
      },
      requestViewportUiRender: jest.fn(),
    };
    const _nodeState2 = { objects: [...objects] };
    const modificationContext = {
      path: "/test",
      getNodeState: () => ({ ..._nodeState2 }),
      setNodeState: (_pathOrId, state) => {
        Object.assign(_nodeState2, state);
        return { ..._nodeState2 };
      },
      services: { viewport },
    };

    tool.beforeGeometryMutation(modificationContext);
    tool.afterGeometryMutation(modificationContext);

    expect(viewport.renderer.captureObjectSnapshot).toHaveBeenCalledWith(
      objects,
    );
    expect(viewport.renderer.invalidateActiveObjects).toHaveBeenCalledWith(
      objects,
    );
    expect(viewport.requestViewportUiRender).toHaveBeenCalledTimes(1);
  });

  test("显式提供 boardApi 时 withGeometryMutation 应跳过 renderer 直刷并仅刷新 overlay", () => {
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
      renderer: {
        captureObjectSnapshot: jest.fn(),
        invalidateActiveObjects: jest.fn(),
      },
      requestViewportUiRender: jest.fn(),
    };
    const modificationContext = {
      services: {
        boardApi: {},
        viewport,
      },
      object,
    };

    const result = tool.modify(modificationContext);

    expect(result).toBe("done");
    expect(object.changed).toBe(true);
    expect(viewport.renderer.captureObjectSnapshot).not.toHaveBeenCalled();
    expect(viewport.renderer.invalidateActiveObjects).not.toHaveBeenCalled();
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
    test("applyModifiedObjects 成功后触发 action:complete 通知", () => {
      class TestModifier extends ObjectModifierTool {
        modify() { }
      }

      const tool = new TestModifier();
      const actionComplete = jest.fn();
      tool.on("action:complete", actionComplete);

      const object = { id: 10 };
      const boardApi = {
        commitObjects: jest.fn(),
        discardActiveObjects: jest.fn(),
      };

      tool.applyModifiedObjects(
        { services: { boardApi }, path: "/test" },
        [object],
      );

      expect(boardApi.commitObjects).toHaveBeenCalledWith([10]);
      expect(actionComplete).toHaveBeenCalledTimes(1);
      expect(actionComplete).toHaveBeenCalledWith(
        expect.objectContaining({ path: "/test" }),
        true,
      );
    });

    test("beforeApplyModifiedObjects 返回 false 时阻止 apply", () => {
      class TestModifier extends ObjectModifierTool {
        modify() { }
      }

      const tool = new TestModifier();
      const actionComplete = jest.fn();
      tool.on("action:complete", actionComplete);
      tool.beforeApplyModifiedObjects = () => false;

      const object = { id: 11 };
      const commitObjects = jest.fn();
      const boardApi = {
        commitObjects,
        discardActiveObjects: jest.fn(),
      };

      const result = tool.applyModifiedObjects(
        { services: { boardApi }, path: "/test" },
        [object],
      );

      expect(result).toBe(false);
      expect(commitObjects).not.toHaveBeenCalled();
      expect(actionComplete).not.toHaveBeenCalled();
    });

    test("autoUmountOnApply 置为 false 时阻止自卸载", () => {
      class TestModifier extends ObjectModifierTool {
        modify() { }
      }

      const tool = new TestModifier();
      tool.autoUmountOnApply = false;
      const object = { id: 12 };
      const unmount = jest.fn();
      const boardApi = {
        commitObjects: jest.fn(),
        discardActiveObjects: jest.fn(),
      };

      tool.applyModifiedObjects(
        {
          services: { boardApi },
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
        modify() { }
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
          services: { boardApi },
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
        modify() { }
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
      const _nodeState3 = { objects: [object] };
      const context = {
        path: "/test",
        getNodeState: () => ({ ..._nodeState3 }),
        setNodeState: (_pathOrId, state) => {
          Object.assign(_nodeState3, state);
          return { ..._nodeState3 };
        },
        services: { boardApi },
        dag: { unmount },
      };

      expect(tool.applyModifiedObjects(context, [object])).toBe(true);
      expect(commitObjects).toHaveBeenCalledWith([object.id]);
      expect(unmount).toHaveBeenCalledWith("/test");

      tool.setContextObjects(context, [object]);
      tool.umount(context);
      expect(discardActiveObjects).toHaveBeenCalledWith([object.id]);
    });
  });

  describe("applyGesturePatch", () => {
    test("应规整 position、一次性提交补丁并同步更新本地条目", () => {
      class TestModifier extends ObjectModifierTool {
        modify() { }
      }

      const tool = new TestModifier();
      const object = {
        id: 42,
        position: { x: 1, y: 2 },
        data: { radius: 5 },
        transform: { a: 1, b: 0, c: 0, d: 1 },
      };
      const boardApi = { modifyObject: jest.fn() };
      const patch = {
        position: { x: 10, y: 20 },
        data: { radius: 8 },
        transform: { a: 2, b: 0, c: 0, d: 0.5 },
      };

      tool.applyGesturePatch(object, patch, {
        context: { services: { boardApi } },
      });

      expect(boardApi.modifyObject).toHaveBeenCalledTimes(1);
      expect(boardApi.modifyObject).toHaveBeenCalledWith(42, patch);
      expect(object.position).toEqual(new Vector(10, 20));
      expect(object.data).toEqual({ radius: 8 });
      expect(object.transform).toEqual({ a: 2, b: 0, c: 0, d: 0.5 });
    });

    test("data 补丁应与本地已有数据合并而非整体替换", () => {
      class TestModifier extends ObjectModifierTool {
        modify() { }
      }

      const tool = new TestModifier();
      const object = { id: 43, position: { x: 0, y: 0 }, data: { a: 1, b: 2 } };

      tool.applyGesturePatch(object, { data: { b: 3 } }, { context: {} });

      expect(object.data).toEqual({ a: 1, b: 3 });
    });

    test("objectId 无效或缺少 boardApi 时仅更新本地条目，不发起 RPC", () => {
      class TestModifier extends ObjectModifierTool {
        modify() { }
      }

      const tool = new TestModifier();
      const noIdObject = { position: { x: 0, y: 0 } };
      const boardApi = { modifyObject: jest.fn() };

      tool.applyGesturePatch(noIdObject, { position: { x: 5, y: 6 } }, {
        context: { services: { boardApi } },
      });
      expect(boardApi.modifyObject).not.toHaveBeenCalled();
      expect(noIdObject.position).toEqual(new Vector(5, 6));

      const plainObject = { id: 44, position: { x: 0, y: 0 } };
      tool.applyGesturePatch(plainObject, { position: { x: 7, y: 8 } }, {
        context: {},
      });
      expect(plainObject.position).toEqual(new Vector(7, 8));
    });

    test("setModifiedObjectPosition 应委托 applyGesturePatch 写入位置", () => {
      class TestModifier extends ObjectModifierTool {
        modify() { }
      }

      const tool = new TestModifier();
      const object = { id: 45, position: { x: 1, y: 1 } };
      const boardApi = { modifyObject: jest.fn() };

      tool.setModifiedObjectPosition(
        { services: { boardApi } },
        object,
        { x: 13, y: 24 },
      );

      expect(object.position).toEqual(new Vector(13, 24));
      expect(boardApi.modifyObject).toHaveBeenCalledWith(45, {
        position: { x: 13, y: 24 },
      });
    });
  });
});
