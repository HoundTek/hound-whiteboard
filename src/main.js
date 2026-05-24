import { ioBridge } from "./io-bridge-renderer.js";

console.log("[Hound Whiteboard] Main module loaded");

const initializeApp = async () => {
  try {
    console.log("[Hound Whiteboard] Initializing application...");
    
    window.__HoundIOBridge = ioBridge;
    
    console.log("[Hound Whiteboard] Application initialized successfully");
  } catch (error) {
    console.error("[Hound Whiteboard] Failed to initialize:", error);
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
