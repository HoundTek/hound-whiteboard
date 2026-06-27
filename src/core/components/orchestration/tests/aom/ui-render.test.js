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
  test("requestLiveRender 应通过 renderHooks 触发刷新", () => {
    const requestLiveRender = jest.fn();
    const renderHooks = {
      requestLiveRender,
      requestBaseRender: jest.fn(),
      requestBaseRenderForObjects: jest.fn(),
      flushViewportForObjects: jest.fn(),
    };
    const aom = new ActiveObjectManager(undefined, { renderHooks });
    const object = new TestActiveObject(7);

    aom.requestLiveRender([object]);

    expect(requestLiveRender).toHaveBeenCalledWith([object]);
    expect(requestLiveRender).toHaveBeenCalledTimes(1);
  });
});
