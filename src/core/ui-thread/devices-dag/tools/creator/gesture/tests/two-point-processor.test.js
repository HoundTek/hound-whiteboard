import { jest } from "@jest/globals";
import { TwoPointGestureProcessor } from "../two-point-processor.js";
import { Vector } from "../../../../../../engine/utils/math.js";

function createMockCreator() {
  return {
    patches: [],
    overlayRefreshCount: 0,
    applyGesturePatch(patch, interaction) {
      this.patches.push(patch);
    },
    afterGeometryMutation(interaction) {
      this.overlayRefreshCount++;
    },
  };
}

function createProcessor(config = {}) {
  return new TwoPointGestureProcessor({
    interpret: (anchor, current) => ({
      data: { distance: current.sub(anchor).length() },
    }),
    collectOverlay: (anchor, current) => [
      { source: "test", type: "path", geometry: { worldPoints: [anchor, current] } },
    ],
    ...config,
  });
}

describe("TwoPointGestureProcessor", () => {
  test("begin 记录锚点并应用 interpret(anchor, anchor)", () => {
    const processor = createProcessor();
    const creator = createMockCreator();

    processor.begin(creator, { position: new Vector(3, 4), context: {} });

    expect(creator.patches).toEqual([{ data: { distance: 0 } }]);
    expect(creator.overlayRefreshCount).toBe(1);
  });

  test("update 递增计数并按当前点应用补丁", () => {
    const processor = createProcessor();
    const creator = createMockCreator();

    processor.begin(creator, { position: new Vector(0, 0), context: {} });
    processor.update(creator, { position: new Vector(3, 4), context: {} });

    expect(creator.patches[1]).toEqual({ data: { distance: 5 } });
  });

  test("complete 携带 position 时先应用终态补丁再解析兜底", () => {
    const fallbackParams = [];
    const processor = createProcessor({
      resolveFallbackPatch: (params) => {
        fallbackParams.push(params);
        return null;
      },
    });
    const creator = createMockCreator();

    processor.begin(creator, { position: new Vector(0, 0), context: {} });
    processor.update(creator, { position: new Vector(1, 0), context: {} });
    processor.complete(creator, {
      position: new Vector(2, 0),
      context: { services: { viewport: { zoom: 2 } } },
    });

    expect(creator.patches[2]).toEqual({ data: { distance: 2 } });
    expect(fallbackParams).toHaveLength(1);
    expect(fallbackParams[0].count).toBe(2);
    expect(fallbackParams[0].zoom).toBe(2);
    expect(fallbackParams[0].anchor.serialize()).toEqual({ x: 0, y: 0 });
    expect(fallbackParams[0].current.serialize()).toEqual({ x: 2, y: 0 });
  });

  test("兜底补丁被应用但不触发 overlay 刷新", () => {
    const processor = createProcessor({
      resolveFallbackPatch: () => ({ data: { distance: 99 } }),
    });
    const creator = createMockCreator();

    processor.begin(creator, { position: new Vector(0, 0), context: {} });
    const refreshBefore = creator.overlayRefreshCount;
    processor.complete(creator, { context: {} });

    expect(creator.patches[1]).toEqual({ data: { distance: 99 } });
    expect(creator.overlayRefreshCount).toBe(refreshBefore);
  });

  test("未开始手势时 complete 不解析兜底", () => {
    const resolveFallbackPatch = jest.fn();
    const processor = createProcessor({ resolveFallbackPatch });
    const creator = createMockCreator();

    processor.complete(creator, { context: {} });

    expect(resolveFallbackPatch).not.toHaveBeenCalled();
    expect(creator.patches).toHaveLength(0);
  });

  test("overlay 委托 collectOverlay，无锚点时返回空", () => {
    const processor = createProcessor();
    const creator = createMockCreator();

    expect(processor.collectUiOverlayEntries(creator)).toEqual([]);

    processor.begin(creator, { position: new Vector(1, 1), context: {} });
    const entries = processor.collectUiOverlayEntries(creator);

    expect(entries).toHaveLength(1);
    expect(entries[0].source).toBe("test");
  });

  test("reset 清空锚点与计数", () => {
    const processor = createProcessor();
    const creator = createMockCreator();

    processor.begin(creator, { position: new Vector(1, 1), context: {} });
    processor.reset();

    expect(processor.collectUiOverlayEntries(creator)).toEqual([]);
    expect(processor._anchor).toBeNull();
    expect(processor._current).toBeNull();
    expect(processor._count).toBe(0);
  });
});
