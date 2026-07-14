/**
 * @file 调试工具
 * @description 提供基于键盘信号的白板调试查询能力。
 * @module core/tools/debugger-tool
 * @author Zhou Chenyu
 */

import { Tool } from "../../core/ui-thread/devices-dag/tools/tool.js";
import { dagToMermaid } from "../../core/ui-thread/devices-dag/index.js";
import { Logger } from "../../utils/log/logger.js";
import { logBus } from "../../utils/log/log-bus.js";

class DebuggerTool extends Tool {
  /**
   * debugger tool logger
   * @private
   * @type {Logger}
   */
  #log = new Logger("Debugger", "DEBUG", logBus);

  process(signalPacket, deviceContext = {}) {
    const board = deviceContext?.acc?.board;
    if (!board) {
      this.#log.warn("missing board context", signalPacket);
      return;
    }

    for (const signal of signalPacket.signals) {
      switch (signal.type) {
        case "debug:chunkload":
          board.getBoardApi()?.requestDebug("chunkLoadState");
          break;
        case "debug:chunkdetails":
          board.getBoardApi()?.requestDebug("chunksDetail", {
            chunkIds: signal.context?.ids,
          });
          break;
        case "debug:objectload":
          board.getBoardApi()?.requestDebug("objectLoadState");
          break;
        case "debug:objectdetails":
          board.getBoardApi()?.requestDebug("objectsDetail", {
            objectIds: signal.context?.ids,
            chunkIds: signal.context?.chunks,
          });
          break;
        case "debug:devices": {
          const mode = signal.context?.mode;
          switch (mode) {
            case "mermaid":
              this.logMermaidDevicesDAG(board);
              break;
            case "tree":
            default:
              this.logDevicesDAG(board);
              break;
          }
          break;
        }
        case "debug:viewport": {
          const ids = signal.context?.ids;
          const entries =
            ids && ids.length > 0
              ? ids.map((id) => board.viewports.get(String(id))).filter(Boolean)
              : [...board.viewports.values()];
          this.#log.debug(
            "viewport:",
            entries.map((vp) => ({
              viewportId: vp.viewportId,
              origin: { x: vp.origin.x, y: vp.origin.y },
              zoom: vp.zoom,
              width: vp.width,
              height: vp.height,
            })),
          );
          break;
        }
        case "debug:aom":
          board.getBoardApi()?.requestDebug("aomState");
          break;
        case "debug:board":
          board.getBoardApi()?.requestDebug("boardState");
          break;
        default:
          if (
            typeof signal.type === "string" &&
            signal.type.startsWith("debug:")
          ) {
            this.#log.warn(
              "unsupported debug command:",
              signal.type,
              signal.context,
            );
          }
          break;
      }
    }
  }

  reset() {}

  stringifyDevicesDAG(dag) {
    if (!dag || typeof dag.toString !== "function") {
      return "<no devices dag>";
    }
    return dag.toString();
  }

  mermaidizeDevicesDAG(dag, options = {}) {
    if (!dag) {
      return "<no devices dag>";
    }
    return dagToMermaid(dag, options);
  }

  logDevicesDAG(board) {
    const devicesDAG = board.devicesDAG;
    if (!devicesDAG) {
      this.#log.warn("missing devices dag", board);
      return;
    }

    this.#log.debug("devices dag:\n" + this.stringifyDevicesDAG(devicesDAG));
  }

  logMermaidDevicesDAG(board) {
    const devicesDAG = board.devicesDAG;
    if (!devicesDAG) {
      this.#log.warn("missing devices dag", board);
      return;
    }

    this.#log.debug(
      "devices dag in Mermaid format:\n" +
        this.mermaidizeDevicesDAG(devicesDAG, { orientation: "TD" }),
    );
  }
}

export { DebuggerTool };
