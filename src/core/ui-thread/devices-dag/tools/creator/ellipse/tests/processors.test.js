import { jest } from "@jest/globals";
import {
  interpretEllipseBounding,
  createEllipseBoundingProcessor,
} from "../bounding-processor.js";
import { Vector } from "../../../../../../engine/utils/math.js";

describe("interpretEllipseBounding 纯函数", () => {
  test("位置为矩形中心，双轴半径为宽高一半", () => {
    const patch = interpretEllipseBounding(new Vector(0, 0), new Vector(24, 16));

    expect(patch.position.serialize()).toEqual({ x: 12, y: 8 });
    expect(patch.data).toEqual({ radiusX: 12, radiusY: 8 });
    expect(patch.transform).toBeUndefined();
  });

  test("反向拖拽（当前点在锚点左上）应取绝对值", () => {
    const patch = interpretEllipseBounding(new Vector(24, 16), new Vector(0, 0));

    expect(patch.position.serialize()).toEqual({ x: 12, y: 8 });
    expect(patch.data).toEqual({ radiusX: 12, radiusY: 8 });
  });

  test("零点尺寸应返回零半径", () => {
    const patch = interpretEllipseBounding(new Vector(3, 3), new Vector(3, 3));

    expect(patch.position.serialize()).toEqual({ x: 3, y: 3 });
    expect(patch.data).toEqual({ radiusX: 0, radiusY: 0 });
  });
});

describe("外接矩形 processor", () => {
  function createMockCreator() {
    return {
      patches: [],
      applyGesturePatch(patch, interaction) {
        this.patches.push(patch);
      },
      afterGeometryMutation() {},
    };
  }

  test("begin/update/complete 应按序应用补丁", () => {
    const processor = createEllipseBoundingProcessor();
    const creator = createMockCreator();

    processor.begin(creator, { position: new Vector(0, 0), context: {} });
    processor.update(creator, { position: new Vector(10, 6), context: {} });
    processor.complete(creator, {
      position: new Vector(20, 12),
      context: {},
    });

    expect(creator.patches).toHaveLength(3);
    expect(creator.patches[2].position.serialize()).toEqual({ x: 10, y: 6 });
    expect(creator.patches[2].data).toEqual({ radiusX: 10, radiusY: 6 });
  });

  test("点击未拖动时 fallback 生成固定半径", () => {
    const processor = createEllipseBoundingProcessor();
    const creator = createMockCreator();

    processor.begin(creator, { position: new Vector(5, 5), context: {} });
    processor.complete(creator, { context: {} });

    const fallback = creator.patches[creator.patches.length - 1];
    expect(fallback.data).toEqual({ radiusX: 16, radiusY: 16 });
    expect(fallback.position.serialize()).toEqual({ x: 5, y: 5 });
  });

  test("拖拽距离足够时不触发 fallback", () => {
    const processor = createEllipseBoundingProcessor();
    const creator = createMockCreator();

    processor.begin(creator, { position: new Vector(0, 0), context: {} });
    processor.update(creator, { position: new Vector(20, 20), context: {} });
    processor.complete(creator, {
      position: new Vector(20, 20),
      context: {},
    });

    const last = creator.patches[creator.patches.length - 1];
    expect(last.data).toEqual({ radiusX: 10, radiusY: 10 });
  });

  test("overlay 为外接矩形虚线框，零点时为空", () => {
    const processor = createEllipseBoundingProcessor();
    const creator = createMockCreator();

    expect(processor.collectUiOverlayEntries(creator)).toEqual([]);

    processor.begin(creator, { position: new Vector(0, 0), context: {} });
    expect(processor.collectUiOverlayEntries(creator)).toEqual([]);

    processor.update(creator, { position: new Vector(10, 6), context: {} });
    const entries = processor.collectUiOverlayEntries(creator);

    expect(entries).toHaveLength(1);
    expect(entries[0].source).toBe("ellipse-bounding");
    expect(entries[0].geometry.closePath).toBe(true);
  });
});
