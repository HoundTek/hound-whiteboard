import { jest } from "@jest/globals";
import { UiRenderer } from "../ui-renderer.js";
import { BasicObject } from "../../objects/basic-obj.js";
import { RectangleRange } from "../../range/index.js";
import { createNoopCanvasContext2D } from "../../test-support/noop-canvas.js";
import { Vector } from "../../utils/math.js";

class TestOverlayObject extends BasicObject {
  constructor({ id = 1, ownerChunkId = 1, position, localRect, property } = {}) {
    super(position ?? new Vector(0, 0), id, ownerChunkId);
    this.boundingBox = RectangleRange.from(
      localRect ?? new RectangleRange(0, 0, 0, 0),
    );
    this.setProperty(property);
  }

  isDirected() {
    return false;
  }

  isErasable() {
    return true;
  }

  render() {}
}

describe("UiRenderer", () => {
  function createContext() {
    return {
      ...createNoopCanvasContext2D(),
      save: jest.fn(),
      restore: jest.fn(),
      beginPath: jest.fn(),
      rect: jest.fn(),
      clip: jest.fn(),
      clearRect: jest.fn(),
      strokeRect: jest.fn(),
      fillRect: jest.fn(),
      setLineDash: jest.fn(),
    };
  }

  function createMonitor(context, board = {}) {
    return {
      monitorId: "main",
      zoom: 1,
      board,
      getContext(layer) {
        return layer === "ui" ? context : null;
      },
      worldRectToScreenRect(rect, padding = 0) {
        return RectangleRange.from(rect)?.inflate?.(padding);
      },
      getViewportScreenRect() {
        return new RectangleRange(0, 0, 800, 600);
      },
    };
  }

  test("flush 应绘制 provider 主动声明的选择框与组合大框", () => {
    const context = createContext();
    const board = {};
    const monitor = createMonitor(context, board);
    const object1 = new TestOverlayObject({
      id: 7,
      position: new Vector(10, 20),
      localRect: new RectangleRange(0, 0, 30, 40),
    });
    const object2 = new TestOverlayObject({
      id: 8,
      position: new Vector(60, 80),
      localRect: new RectangleRange(0, 0, 20, 10),
    });
    const aom = {
      getObjectWorldRange(objectInstance) {
        if (objectInstance.id === 7) {
          return new RectangleRange(10, 20, 30, 40);
        }
        return new RectangleRange(60, 80, 20, 10);
      },
    };
    const renderer = new UiRenderer(monitor, aom);
    renderer.registerOverlayProvider(({ renderer: overlayRenderer }) =>
      overlayRenderer.createCompatSelectionEntriesForObjects(
        [object1, object2],
        "chooser",
      ),
    );

    renderer.flush([new RectangleRange(0, 0, 800, 600)]);

    expect(context.clearRect).toHaveBeenCalledWith(0, 0, 800, 600);
    expect(context.strokeRect.mock.calls).toEqual([
      [6, 16, 38, 48],
      [56, 76, 28, 18],
      [6, 16, 78, 78],
    ]);
  });

  test("对象只在 AOM 中但不在 chooser/modifier 当前上下文时，不应显示选择框", () => {
    const context = createContext();
    const board = {};
    const monitor = createMonitor(context, board);
    const object = new TestOverlayObject({
      id: 7,
      position: new Vector(10, 20),
      localRect: new RectangleRange(0, 0, 30, 40),
    });
    const aom = {
      activeObjects: new Set([object]),
      getObjectWorldRange() {
        return new RectangleRange(10, 20, 30, 40);
      },
    };
    const renderer = new UiRenderer(monitor, aom);

    renderer.flush([new RectangleRange(0, 0, 800, 600)]);

    expect(context.strokeRect).not.toHaveBeenCalled();
  });

  test("flush 应执行已注册的自定义 overlay provider", () => {
    const context = createContext();
    const board = {};
    const monitor = createMonitor(context, board);
    const renderer = new UiRenderer(monitor, undefined);
    const draw = jest.fn();
    const provider = jest.fn(() => ({
      type: "draw",
      worldRect: new RectangleRange(100, 120, 20, 30),
      draw,
    }));

    renderer.registerOverlayProvider(provider);
    renderer.flush([new RectangleRange(0, 0, 800, 600)]);

    expect(provider).toHaveBeenCalledTimes(1);
    expect(draw).toHaveBeenCalledTimes(1);
  });
});