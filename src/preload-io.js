import { contextBridge, ipcRenderer } from "electron";
import {
  IO_BRIDGE_BATCH_CHANNEL,
  IO_BRIDGE_CHANNEL,
} from "./io-bridge-common.js";

/**
 * 预加载层暴露给渲染进程的 I/O 桥接对象。
 * @type {{ call(request: object): Promise<any>, callBatch(request: object): Promise<any> }}
 */
const ioBridge = {
  /**
   * 转发渲染进程的 I/O 请求到主进程。
   * @param {object} request - I/O 调用请求体
   * @returns {Promise<any>} 主进程返回的序列化结果
   */
  call(request) {
    return ipcRenderer.invoke(IO_BRIDGE_CHANNEL, request);
  },

  /**
   * 转发渲染进程的 I/O 批处理请求到主进程。
   * @param {object} request - I/O 批处理请求体
   * @returns {Promise<any>} 主进程返回的序列化批处理结果
   */
  callBatch(request) {
    return ipcRenderer.invoke(IO_BRIDGE_BATCH_CHANNEL, request);
  },
};

/**
 * 在预加载上下文中注入 I/O 桥接对象。
 * 在启用上下文隔离时通过 contextBridge 暴露；否则直接挂到全局对象。
 */
if (process.contextIsolated) {
  contextBridge.exposeInMainWorld("__houndIOBridge", ioBridge);
} else {
  globalThis.__houndIOBridge = ioBridge;
}