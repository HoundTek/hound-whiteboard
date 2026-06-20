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
    test("add 与 discard 应触发 monitor.liveRenderer.invalidateObjects", () => {
      const monitor = {
        liveRenderer: {
          collectActiveDrawables: jest.fn(() => []),
          invalidateObjects: jest.fn(),
        },
        renderScheduler: { invalidate: jest.fn() },
      };
      const board = { monitors: new Map([["main", monitor]]) };
      aom = new ActiveObjectManager(board);

      const stroke = new StrokeObject(new Vector(0, 0), 100, 1);
      stroke.setPathPoints([new Vector(1, 1), new Vector(4, 4)]);

      aom.add(new Set([stroke]));
      aom.discard(new Set([stroke]));

      expect(monitor.liveRenderer.invalidateObjects).toHaveBeenCalledTimes(2);
      expect(monitor.liveRenderer.invalidateObjects).toHaveBeenNthCalledWith(
        1,
        [stroke],
      );
      expect(monitor.liveRenderer.invalidateObjects).toHaveBeenNthCalledWith(
        2,
        [stroke],
      );
    });

    test("add 应将白板外新对象注册到动态图顶层", () => {
      const aom = new ActiveObjectManager();
      const lower = new StrokeObject(new Vector(0, 0), 30, 1);
      lower.setPathPoints([new Vector(1, 1), new Vector(5, 5)]);
      const upper = new StrokeObject(new Vector(0, 0), 31, 1);
      upper.setPathPoints([new Vector(2, 2), new Vector(6, 6)]);

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
