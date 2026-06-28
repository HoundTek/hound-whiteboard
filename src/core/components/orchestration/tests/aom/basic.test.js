import { jest } from "@jest/globals";
import { RandomNumberPool } from "../../../../utils/random.js";
import { ActiveObjectManager } from "../../active-object-manager.js";
import { Vector } from "../../../../utils/math.js";
import { StrokeObject } from "../../../../objects/stroke/stroke.js";

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
      expect(aom.activeObjects).toBeInstanceOf(Set);
      expect(aom.layerPool).toBeInstanceOf(RandomNumberPool);
      expect(aom.onLayer).toBeInstanceOf(Map);
    });
  });

  describe("活动层刷新", () => {
    test("add 与 discard 应通过 renderHooks 触发刷新", () => {
      const requestLiveRender = jest.fn();
      const requestBaseRenderForObjects = jest.fn();
      const flushViewportForObjects = jest.fn();
      const renderHooks = {
        requestLiveRender,
        requestBaseRender: jest.fn(),
        requestBaseRenderForObjects,
        flushViewportForObjects,
      };
      aom = new ActiveObjectManager(undefined, { renderHooks });

      const stroke = new StrokeObject(100, new Vector(0, 0));
      stroke.setData({ points: [new Vector(1, 1), new Vector(4, 4)].map(p => ({ x: p.x, y: p.y })) });

      aom.add(new Set([stroke]));
      expect(requestLiveRender).toHaveBeenCalledTimes(1);
      expect(requestLiveRender).toHaveBeenNthCalledWith(1, [stroke]);
      expect(requestBaseRenderForObjects).toHaveBeenCalledTimes(1);

      // discard again: 第二次 flush 和 live render
      requestLiveRender.mockClear();
      requestBaseRenderForObjects.mockClear();
      flushViewportForObjects.mockClear();

      aom.discard(new Set([stroke]));
      expect(requestLiveRender).toHaveBeenCalledTimes(1);
      expect(flushViewportForObjects).toHaveBeenCalledTimes(1);
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
      expect(aom.activeObjects).toEqual(new Set([lower, upper]));
      expect(aom.layerOrder).toEqual([firstLayer, secondLayer]);
      expect(aom.onLayer.get(30)).toBe(firstLayer);
      expect(aom.onLayer.get(31)).toBe(secondLayer);
    });
  });
});
