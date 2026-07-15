import { jest } from "@jest/globals";
import { ActiveObjectManager } from "../../active-object-manager.js";
import { BasicObject } from "../../../objects/basic-obj.js";
import { RectangleRange } from "../../../range/index.js";
import { Vector } from "../../../utils/math.js";

class TestActiveObject extends BasicObject {
  constructor(id = 1) {
    super(id, new Vector(0, 0));
    this.rich.boundingBox = new RectangleRange(0, 0, 10, 10);
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
  test("requestActiveRender 应通过 renderHooks 触发刷新", () => {
    const requestActiveRender = jest.fn();
    const renderHooks = {
      requestActiveRender,
      requestStaticRender: jest.fn(),
      requestStaticRenderForObjects: jest.fn(),
      flushViewportForObjects: jest.fn(),
    };
    const aom = new ActiveObjectManager(undefined, { renderHooks });
    const object = new TestActiveObject(7);

    aom.requestActiveRender([object]);

    expect(requestActiveRender).toHaveBeenCalledWith([object]);
    expect(requestActiveRender).toHaveBeenCalledTimes(1);
  });
});
