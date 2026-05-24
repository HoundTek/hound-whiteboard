import { ioBridge } from "./io-bridge-renderer.js";

window.__HOUND_IO_BRIDGE__ = ioBridge;

console.log("[Tauri Preload IO] IO Bridge initialized");
