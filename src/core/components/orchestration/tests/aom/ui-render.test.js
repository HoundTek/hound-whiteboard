import { jest } from "@jest/globals";
import { ActiveObjectManager } from "../../active-object-manager.js";
import { BasicObject } from "../../../../objects/basic-obj.js";
import { RectangleRange } from "../../../../range/index.js";
import { Vector } from "../../../../utils/math.js";

class TestActiveObject extends BasicObject {
  constructor(id = 1) {
    super(new Vector(0, 0), id, 1);
    this.boundingBox = new RectangleRange(0, 0, 10, 10);
  }

  isDirected() {
    return false;
  }

  isErasable() {
    return true;
  }

  render() {}
}

describe("ActiveObjectManager/ui render", () => {
  test("requestLiveRender 应同时推动 live 层与 ui 层刷新", () => {
    const liveRenderer = {
      collectActiveDrawables: jest.fn(() => []),
      invalidateObjects: jest.fn(),
    };
    const monitor = {
      liveRenderer,
      requestViewportUiRender: jest.fn(),
    };
    const board = {
      monitors: new Map([["main", monitor]]),
    };
    const aom = new ActiveObjectManager(board);
    const object = new TestActiveObject(7);

    aom.requestLiveRender([object]);

    expect(liveRenderer.invalidateObjects).toHaveBeenCalledWith([object]);
    expect(monitor.requestViewportUiRender).toHaveBeenCalledTimes(1);
  });
});