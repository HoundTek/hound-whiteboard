/**
 * @file 视口实际覆盖的 tile 数量
 * @description 打印不同视口尺寸下的 tile 边长、覆盖块数与缓存块数，用于说明平移帧的合成规模。
 * @author Zhou Chenyu
 */
import { createCanvas } from "@napi-rs/canvas";

globalThis.OffscreenCanvas = class {
  constructor(w, h) {
    const c = createCanvas(w, h);
    c.transferToImageBitmap = () => {
      const s = createCanvas(w, h);
      s.getContext("2d").drawImage(c, 0, 0);
      return s;
    };
    return c;
  }
};
globalThis.requestAnimationFrame = () => 0;
globalThis.cancelAnimationFrame = () => {};

const { BoardCore } = await import("../../src/kernel/board/board-core.js");
const { ViewportCore } = await import("../../src/renderers/canvas/viewport-core.js");

const CACHE_MARGIN = 0.25;
const EVICT_MARGIN = 0.5;

console.log("视口 | tile 边长 | 缓存区块数 | 视口内块数 | 逐出保留块数");
for (const [w, h] of [[800, 600], [900, 700], [1280, 800], [1440, 900], [1920, 1080], [2560, 1440], [3840, 2160]]) {
  const boardCore = new BoardCore({ width: 1024, height: 1024 });
  const viewport = new ViewportCore({
    boardCore, viewportId: `tc-${w}x${h}`, width: w, height: h, postRenderFrame() {}, tiles: true,
  });
  viewport.onViewportChange({ origin: { x: 0, y: 0 }, zoom: 1, viewportSize: { width: w, height: h }, force: true });
  viewport.flushRenderFrame();
  const info = viewport.renderer.getTileDebugInfo?.() ?? {};
  const tileSize = info.tileSize ?? 0;
  const storeSize = info.tileCount ?? 0;
  const covered = (extent, size) => Math.ceil((extent * (1 + 2 * CACHE_MARGIN)) / size);
  console.log(
    `${w}x${h}`.padEnd(10) + "| " +
    String(tileSize).padStart(9) + " | " +
    String(storeSize).padStart(10) + " | " +
    String(covered(w, tileSize) * covered(h, tileSize)).padStart(10) + " | " +
    String(Math.ceil((w * (1 + 2 * EVICT_MARGIN)) / tileSize) * Math.ceil((h * (1 + 2 * EVICT_MARGIN)) / tileSize)).padStart(12),
  );
  viewport.destroy?.();
}
process.exit(0);
