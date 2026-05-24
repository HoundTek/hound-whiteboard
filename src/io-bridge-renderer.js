import { invoke } from '@tauri-apps/api/tauri';
import {
  IO_BRIDGE_BATCH_CHANNEL,
  IO_BRIDGE_CHANNEL,
} from "./io-bridge-common.js";
import {
  CORE_FILE_OPERATE_CHANNEL,
} from "./core/bridges/file-operate-bridge-common.js";

const invokeCommand = async (command, ...args) => {
  try {
    return await invoke(command, args.length > 0 ? { args } : {});
  } catch (error) {
    console.error(`[Tauri IPC] Error invoking ${command}:`, error);
    throw error;
  }
};

const ioBridge = {
  call(request) {
    return invokeCommand(IO_BRIDGE_CHANNEL, request);
  },

  callBatch(request) {
    return invokeCommand(IO_BRIDGE_BATCH_CHANNEL, request);
  },
};

const coreFileOperateBridge = {
  call(request) {
    return invokeCommand(CORE_FILE_OPERATE_CHANNEL, request);
  },
};

if (typeof window !== "undefined") {
  window.__houndIOBridge = ioBridge;
  window.__houndCoreFileOps = coreFileOperateBridge;
}

export { ioBridge, coreFileOperateBridge };
