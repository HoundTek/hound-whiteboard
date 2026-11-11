/**
 * @file tile 缓存在不同设备倍率下的内存占用
 * @description 打印 tile 边长、位图边长、分配块数与总字节数，用于核算每档缩放缓存的内存预算。
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

console.log("视口(CSS) | DPR | tile 边长 | 位图边长 | 块数 | tile 总内存");
for (const dpr of [1, 2, 3]) {
  for (const [w, h] of [[900, 700], [1440, 900], [1920, 1080]]) {
    const boardCore = new BoardCore({ width: 1024, height: 1024 });
    const viewport = new ViewportCore({
      boardCore, viewportId: `tm-${w}-${dpr}`, width: w, height: h,
      postRenderFrame() {}, tiles: true, devicePixelRatio: dpr,
    });
    viewport.onViewportChange({ origin: { x: 0, y: 0 }, zoom: 1, viewportSize: { width: w, height: h }, force: true });
    viewport.flushRenderFrame();
    await new Promise((r) => setTimeout(r, 100));
    viewport.flushRenderFrame();
    const info = viewport.renderer.getTileDebugInfo?.() ?? {};
    const tileSize = info.tileSize ?? 0;
    const bitmap = viewport.renderer.getTileBitmapSize?.() ?? 0;
    const bytes = info.tileCount * bitmap * bitmap * 4;
    console.log(
      `${`${w}x${h}`.padEnd(9)} | ${String(dpr).padStart(3)} | ${String(tileSize).padStart(9)} | ${String(bitmap).padStart(8)} | ${String(info.tileCount).padStart(4)} | ${(bytes / 1024 / 1024).toFixed(1)}MB`,
    );
    viewport.destroy?.();
  }
}
process.exit(0);
