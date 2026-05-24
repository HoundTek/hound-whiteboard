/**
 * 渲染进程与主进程之间的 I/O IPC 通道名。
 * @type {string}
 */
const IO_BRIDGE_CHANNEL = "io_bridge_call";

/**
 * 渲染进程与主进程之间的 I/O 批处理 IPC 通道名。
 * @type {string}
 */
const IO_BRIDGE_BATCH_CHANNEL = "io_bridge_batch_call";

if (typeof window !== "undefined") {
  window.IO_BRIDGE_CHANNEL = IO_BRIDGE_CHANNEL;
  window.IO_BRIDGE_BATCH_CHANNEL = IO_BRIDGE_BATCH_CHANNEL;
}

export {
  IO_BRIDGE_BATCH_CHANNEL,
  IO_BRIDGE_CHANNEL,
};
