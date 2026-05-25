import { jest } from "@jest/globals";
import { Matrix, Vector } from "../../../utils/math.js";
import { CommonObjectModifierTool } from "../common-object-modifier.js";
import { OBJECT_MODIFIER_SIGNAL_TYPES } from "../obj-modifier.js";

describe("CommonObjectModifierTool", () => {
  test("应将绝对 position 和 transform 应用到对象并触发几何刷新", () => {
    const object = {
      position: new Vector(1, 1),
      transform: Matrix.identity(),
      setTransform(trans) {
        this.transform = trans;
      },
    };

    const monitor = {
      liveRenderer: {
        captureObjectSnapshot: jest.fn(),
        invalidateObjects: jest.fn(),
      },
    };

    const tool = new CommonObjectModifierTool();
    const signalPacket = {
      signals: [
        { type: "position", context: { value: { x: 10, y: 20 } } },
        { type: "transform", context: { value: { a: 2, b: 0, c: 0, d: 3 } } },
      ],
    };

    tool.process(signalPacket, { object, monitor });

    expect(object.position).toEqual(new Vector(10, 20));
    expect(object.transform).toEqual(new Matrix(2, 0, 0, 3));
    expect(monitor.liveRenderer.captureObjectSnapshot).toHaveBeenCalledWith([
      object,
    ]);
    expect(monitor.liveRenderer.invalidateObjects).toHaveBeenCalledWith([
      object,
    ]);
  });

  test("不传 position 或 transform 时应保持原状态且不报错", () => {
    const object = {
      position: new Vector(5, 5),
      transform: Matrix.identity(),
      setTransform(trans) {
        this.transform = trans;
      },
    };

    const tool = new CommonObjectModifierTool();
    tool.process({ signals: [] }, { object, monitor: {} });

    expect(object.position).toEqual(new Vector(5, 5));
    expect(object.transform).toEqual(Matrix.identity());
  });

  test("apply 信号应将动态图对象提交回 AOM 并卸载当前 modifier", () => {
    const object = {
      id: 7,
      position: new Vector(5, 5),
      transform: Matrix.identity(),
      setTransform(trans) {
        this.transform = trans;
      },
    };

    const board = {
      activeObjectManager: {
        activeObjectIndex: new Map([[object.id, object]]),
        apply: jest.fn(),
      },
    };
    const tree = {
      unmount: jest.fn(),
    };
    const nodeContext = { object };
    const tool = new CommonObjectModifierTool();

    tool.process(
      {
        signals: [
          { type: OBJECT_MODIFIER_SIGNAL_TYPES.APPLY, context: {} },
        ],
      },
      {
        object,
        board,
        tree,
        path: "/monitor/mouse/primary/tool/tool",
        nodeContext,
      },
    );

    expect(board.activeObjectManager.apply).toHaveBeenCalledWith(
      new Set([object]),
    );
    expect(tree.unmount).toHaveBeenCalledWith(
      "/monitor/mouse/primary/tool/tool",
    );
    expect(nodeContext.object).toBeUndefined();
  });
});
