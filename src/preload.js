import { ioBridge, coreFileOperateBridge } from "./io-bridge-renderer.js";

window.createIOBridge = () => ioBridge;
window.createCoreFileOperateBridge = () => coreFileOperateBridge;

console.log("[Tauri Preload] Bridges initialized");
