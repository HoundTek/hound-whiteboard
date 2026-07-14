/**
 * @file demo Viewport 视口工具
 * @module templates/demo/viewport-tool
 * @author Zhou Chenyu
 */

import { Tool } from "../../core/ui-thread/devices-dag/tools/tool.js";

/**
 * Demo 专用 Viewport 视口工具
 * @class
 * @extends Tool
 */
class ViewportTool extends Tool {
  /**
   * @param {{
   *   onViewportChange?: (viewport: any, signal: any, signalPacket: any, deviceContext: any) => void,
   *   onFlush?: (viewport: any, signal: any, signalPacket: any, deviceContext: any) => void,
   * }} [options={}]
   */
  constructor(options = {}) {
    super();
    this.onViewportChange =
      typeof options.onViewportChange === "function"
        ? options.onViewportChange
        : null;
    this.onFlush =
      typeof options.onFlush === "function" ? options.onFlush : null;
  }

  /**
   * @type {((viewport: any, signal: any, signalPacket: any, deviceContext: any) => void) | null}
   */
  onViewportChange;

  /**
   * @type {((viewport: any, signal: any, signalPacket: any, deviceContext: any) => void) | null}
   */
  onFlush;

  process(signalPacket, deviceContext = {}) {
    const viewport = deviceContext?.acc?.viewport;
    if (!viewport) return;

    for (const signal of signalPacket?.signals ?? []) {
      if (signal?.type === "position") {
        const value = signal?.context?.value;
        if (value && Number.isFinite(value.x) && Number.isFinite(value.y)) {
          viewport.setViewportPosition?.(value);
          this.onViewportChange?.(
            viewport,
            signal,
            signalPacket,
            deviceContext,
          );
        }
        continue;
      }

      if (signal?.type === "scale") {
        const scale = signal?.context?.value;
        if (Number.isFinite(scale) && scale > 0) {
          viewport.setViewportScaleAroundCenter?.(scale);
          this.onViewportChange?.(
            viewport,
            signal,
            signalPacket,
            deviceContext,
          );
        }
        continue;
      }

      if (signal?.type === "flush") {
        viewport.flushViewportRender?.();
        this.onFlush?.(viewport, signal, signalPacket, deviceContext);
      }
    }
  }

  reset() {}
}

export { ViewportTool };
