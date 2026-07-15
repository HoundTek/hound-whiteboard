import { jest } from "@jest/globals";
import { RandomNumberPool } from "../../../utils/random.js";
import { ActiveObjectManager } from "../../active-object-manager.js";
import { Vector } from "../../../utils/math.js";
import { StrokeObject } from "../../../objects/stroke/stroke.js";

describe("ActiveObjectManager/basic", () => {
  let aom = new ActiveObjectManager();

  beforeEach(() => {
    aom = new ActiveObjectManager();
  });

  describe("构造", () => {
    test("应正确构造 ActiveObjectManager 实例", () => {
      expect(aom).toBeInstanceOf(ActiveObjectManager);
      expect(aom.layerOrder).toEqual([]);
      expect(aom.layerIndex).toBeInstanceOf(Map);
      expect(aom.activeObjectIndex).toBeInstanceOf(Map);
      expect(aom.layerPool).toBeInstanceOf(RandomNumberPool);
      expect(aom.onLayer).toBeInstanceOf(Map);
    });
  });

  describe("活动层刷新", () => {
    test("add 与 discard 应通过 renderHooks 触发刷新", () => {
      const requestActiveRender = jest.fn();
      const requestStaticRenderForObjects = jest.fn();
      const renderHooks = {
        requestActiveRender,
        requestStaticRender: jest.fn(),
        requestStaticRenderForObjects,
        flushViewportForObjects: jest.fn(),
      };
      aom = new ActiveObjectManager(undefined, { renderHooks });

      const stroke = new StrokeObject(100, new Vector(0, 0));
      stroke.setData({ points: [new Vector(1, 1), new Vector(4, 4)].map(p => ({ x: p.x, y: p.y })) });

      aom.add(new Set([stroke]));
      expect(requestActiveRender).toHaveBeenCalledTimes(1);
      expect(requestActiveRender).toHaveBeenNthCalledWith(1, [stroke]);
      expect(requestStaticRenderForObjects).toHaveBeenCalledTimes(1);

      // discard again: 第二次 flush 和 live render
      requestActiveRender.mockClear();
      requestStaticRenderForObjects.mockClear();

      aom.discard(new Set([stroke]));
      expect(requestActiveRender).toHaveBeenCalledTimes(1);
      expect(requestStaticRenderForObjects).toHaveBeenCalledTimes(1);
    });

    test("add 应将白板外新对象注册到动态图顶层", () => {
      const aom = new ActiveObjectManager();
      const lower = new StrokeObject(30, new Vector(0, 0));
      lower.setData({ points: [new Vector(1, 1), new Vector(5, 5)].map(p => ({ x: p.x, y: p.y })) });
      const upper = new StrokeObject(31, new Vector(0, 0));
      upper.setData({ points: [new Vector(2, 2), new Vector(6, 6)].map(p => ({ x: p.x, y: p.y })) });

      const firstLayer = aom.add(new Set([lower]));
      const secondLayer = aom.add(new Set([upper]));

      expect(firstLayer.activeObjects).toEqual(new Set([30]));
      expect(secondLayer.activeObjects).toEqual(new Set([31]));
      expect(new Set(aom.activeObjectIndex.values())).toEqual(new Set([lower, upper]));
      expect(aom.layerOrder).toEqual([firstLayer, secondLayer]);
      expect(aom.onLayer.get(30)).toBe(firstLayer);
      expect(aom.onLayer.get(31)).toBe(secondLayer);
    });
  });
});
