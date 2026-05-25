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
  });
});
