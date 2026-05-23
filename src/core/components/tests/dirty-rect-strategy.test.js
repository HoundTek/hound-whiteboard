import {
  createBaseDirtyRectCanonicalRectsResolver,
  createBaseDirtyRectPolicyResolver,
  createBaseDirtyRectThresholdStrategy,
  collectLoadedChunksForWorldRect,
  createDirtyRectPolicyResolver,
  createLiveDirtyRectPolicyResolver,
  createLiveDirtyRectThresholdStrategy,
  createZoomScaledThresholdStrategy,
  screenRectToWorldRect,
} from "../dirty-rect-strategy.js";
import { Chunk } from "../chunk.js";
import { RectangleRange } from "../../range/rectangle.js";

describe("dirty rect strategy", () => {
  test("base 预设策略应返回 zoom-aware 阈值", () => {
    const resolveBaseThresholds = createBaseDirtyRectThresholdStrategy();
    const zoom1Thresholds = resolveBaseThresholds(1);
    const zoom2Thresholds = resolveBaseThresholds(2);

    expect(zoom1Thresholds.axisNearGap).toBe(6);
    expect(zoom1Thresholds.diagonalNearGap).toBe(3);
    expect(zoom1Thresholds.maxExtraArea).toBe(160);
    expect(zoom1Thresholds.maxGrowthRatio).toBe(1.2);
    expect(zoom1Thresholds.viewportCoverageRatio).toBeCloseTo(0.92);
    expect(zoom1Thresholds.canonicalRectCoverageRatio).toBeCloseTo(0.55);

    expect(zoom2Thresholds.axisNearGap).toBe(12);
    expect(zoom2Thresholds.diagonalNearGap).toBe(6);
    expect(zoom2Thresholds.maxExtraArea).toBe(640);
    expect(zoom2Thresholds.maxGrowthRatio).toBe(1.2);
    expect(zoom2Thresholds.viewportCoverageRatio).toBeCloseTo(0.95);
    expect(zoom2Thresholds.canonicalRectCoverageRatio).toBeCloseTo(0.65);
  });

  test("live 预设策略应返回 zoom-aware 阈值", () => {
    const resolveLiveThresholds = createLiveDirtyRectThresholdStrategy();
    const zoom1Thresholds = resolveLiveThresholds(1);
    const zoom2Thresholds = resolveLiveThresholds(2);

    expect(zoom1Thresholds.axisNearGap).toBe(12);
    expect(zoom1Thresholds.diagonalNearGap).toBe(6);
    expect(zoom1Thresholds.maxExtraArea).toBe(384);
    expect(zoom1Thresholds.maxGrowthRatio).toBe(1.5);
    expect(zoom1Thresholds.viewportCoverageRatio).toBeCloseTo(0.72);
    expect(zoom1Thresholds.canonicalRectCoverageRatio).toBeUndefined();

    expect(zoom2Thresholds.axisNearGap).toBe(24);
    expect(zoom2Thresholds.diagonalNearGap).toBe(12);
    expect(zoom2Thresholds.maxExtraArea).toBe(1536);
    expect(zoom2Thresholds.maxGrowthRatio).toBe(1.5);
    expect(zoom2Thresholds.viewportCoverageRatio).toBeCloseTo(0.8);
    expect(zoom2Thresholds.canonicalRectCoverageRatio).toBeUndefined();
  });

  test("策略工厂应支持覆盖单个阈值策略", () => {
    const resolveBaseThresholds = createBaseDirtyRectThresholdStrategy({
      axisNearGap: createZoomScaledThresholdStrategy({
        baseValue: 10,
        max: 18,
      }),
    });

    expect(resolveBaseThresholds(1).axisNearGap).toBe(10);
    expect(resolveBaseThresholds(2).axisNearGap).toBe(18);
  });

  test("policy resolver 应把阈值与宿主回调收敛成整组 policy", () => {
    const resolvePolicy = createDirtyRectPolicyResolver({
      getThresholds: () => ({ axisNearGap: 9 }),
      getViewportRect: () => ({ type: "viewport" }),
      getCanonicalRectsForRect: (dirtyRect) => [dirtyRect],
    });
    const dirtyRect = { left: 0, top: 0, width: 10, height: 10 };
    const policy = resolvePolicy();

    expect(policy.getThresholds()).toEqual({ axisNearGap: 9 });
    expect(policy.getViewportRect()).toEqual({ type: "viewport" });
    expect(policy.getCanonicalRectsForRect(dirtyRect)).toEqual([dirtyRect]);
  });

  test("base/live policy resolver 应保留各自的默认阈值策略", () => {
    const basePolicy = createBaseDirtyRectPolicyResolver()();
    const livePolicy = createLiveDirtyRectPolicyResolver()();

    expect(basePolicy.getThresholds().axisNearGap).toBe(6);
    expect(basePolicy.getThresholds().canonicalRectCoverageRatio).toBeCloseTo(
      0.55,
    );
    expect(livePolicy.getThresholds().axisNearGap).toBe(12);
    expect(livePolicy.getThresholds().canonicalRectCoverageRatio).toBeUndefined();
  });

  test("screenRectToWorldRect 应按 origin 与 zoom 换算世界矩形", () => {
    expect(
      screenRectToWorldRect(
        new RectangleRange(200, 100, 80, 40),
        { x: 50, y: 25 },
        2,
      ),
    ).toEqual(new RectangleRange(150, 75, 40, 20));
  });

  test("collectLoadedChunksForWorldRect 应只返回真正命中的 loaded chunk", () => {
    const chunk1 = Chunk.fromId(1);
    const chunk2 = Chunk.fromId(2);

    expect(
      collectLoadedChunksForWorldRect(new RectangleRange(810, 10, 100, 100), {
        loadedChunks: [chunk1, chunk2],
        getChunkById: (chunkId) => Chunk.fromId(chunkId),
        chunkWidth: 800,
        chunkHeight: 600,
      }),
    ).toEqual([chunk2]);
  });

  test("base canonical rect resolver 应收窄到 dirty rect 真正命中的 loaded chunk 子集", () => {
    const chunk1 = Chunk.fromId(1);
    const chunk2 = Chunk.fromId(2);
    const resolveCanonicalRectsForDirtyRect =
      createBaseDirtyRectCanonicalRectsResolver({
        getOrigin: () => ({ x: 0, y: 0 }),
        getZoom: () => 1,
        getLoadedChunks: () => [chunk1, chunk2],
        getChunkById: (chunkId) => Chunk.fromId(chunkId),
        getChunkWidth: () => 800,
        getChunkHeight: () => 600,
        getChunkScreenRect: (chunk) => {
          const rectMap = new Map([
            [1, new RectangleRange(0, 0, 800, 600)],
            [2, new RectangleRange(800, 0, 800, 600)],
          ]);
          return rectMap.get(chunk.id);
        },
      });

    expect(
      resolveCanonicalRectsForDirtyRect(new RectangleRange(10, 10, 100, 100)),
    ).toEqual([new RectangleRange(0, 0, 800, 600)]);
    expect(
      resolveCanonicalRectsForDirtyRect(
        new RectangleRange(810, 10, 100, 100),
      ),
    ).toEqual([new RectangleRange(800, 0, 800, 600)]);
  });
});