/**
 * @file demo Monitor 视口工具
 * @module templates/demo/monitor-viewport-tool
 * @author Zhou Chenyu
 */

import { Tool } from "../../core/tools/tool.js";

/**
 * Demo 专用 Monitor 视口工具
 * @class
 * @extends Tool
 */
class MonitorViewportTool extends Tool {
  /**
   * @param {{
   *   onViewportChange?: (monitor: any, signal: any, signalPacket: any, deviceContext: any) => void,
   *   onFlush?: (monitor: any, signal: any, signalPacket: any, deviceContext: any) => void,
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
   * @type {((monitor: any, signal: any, signalPacket: any, deviceContext: any) => void) | null}
   */
  onViewportChange;

  /**
   * @type {((monitor: any, signal: any, signalPacket: any, deviceContext: any) => void) | null}
   */
  onFlush;

  process(signalPacket, deviceContext = {}) {
    const monitor = deviceContext?.context?.monitor;
    if (!monitor) return;

    for (const signal of signalPacket?.signals ?? []) {
      if (signal?.type === "position") {
        const value = signal?.context?.value;
        if (value && Number.isFinite(value.x) && Number.isFinite(value.y)) {
          monitor.setViewportPosition?.(value);
          this.onViewportChange?.(monitor, signal, signalPacket, deviceContext);
        }
        continue;
      }

      if (signal?.type === "scale") {
        const scale = signal?.context?.value;
        if (Number.isFinite(scale) && scale > 0) {
          monitor.setViewportScaleAroundCenter?.(scale);
          this.onViewportChange?.(monitor, signal, signalPacket, deviceContext);
        }
        continue;
      }

      if (signal?.type === "flush") {
        monitor.flushViewportRender?.();
        this.onFlush?.(monitor, signal, signalPacket, deviceContext);
      }
    }
  }

  reset() {}
}

export { MonitorViewportTool };
