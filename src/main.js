import { ioBridge } from "./io-bridge-renderer.js";
import { Logger } from "./utils/log/logger.js";
import { logBus } from "./utils/log/log-bus.js";
import { createConsolePrinter } from "./utils/log/console-printer.js";

// ── 初始化全局日志系统 ──────────────────────────────────────────

/** @type {Logger} */
const log = new Logger("HWB", "INFO", logBus);

// 挂载默认控制台输出器
createConsolePrinter(logBus, { timestamps: true });

// 暴露到全局，方便调试
if (typeof window !== "undefined") {
  window.__logBus = logBus;
}

log.info("Main module loaded");

const initializeApp = async () => {
  try {
    log.info("Initializing application...");

    window.__HoundIOBridge = ioBridge;

    log.info("Application initialized successfully");
  } catch (error) {
    log.error("Failed to initialize:", error);
    throw error;
  }
};

if (typeof window !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initializeApp);
  } else {
    initializeApp();
  }
}

export { initializeApp, ioBridge };
