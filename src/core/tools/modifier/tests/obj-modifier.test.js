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
      object,
      monitor: {
        liveRenderer: {
          captureObjectSnapshot(objects) {
            calls.push(["capture", objects]);
          },
          invalidateObjects(objects) {
            calls.push(["invalidate", objects]);
          },
        },
      },
    };

    const result = tool.modify(modificationContext);

    expect(result).toBe("done");
    expect(object.changed).toBe(true);
    expect(calls).toEqual([
      ["capture", [object]],
      ["invalidate", [object]],
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
    };
    const modificationContext = {
      objects: new Set(objects),
      monitor,
    };

    tool.beforeGeometryMutation(modificationContext);
    tool.afterGeometryMutation(modificationContext);

    expect(monitor.liveRenderer.captureObjectSnapshot).toHaveBeenCalledWith(
      objects,
    );
    expect(monitor.liveRenderer.invalidateObjects).toHaveBeenCalledWith(objects);
  });
});