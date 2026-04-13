/**
 * 渲染进程与主进程之间的 I/O IPC 通道名。
 * @type {string}
 */
const IO_BRIDGE_CHANNEL = "houndwhiteboard:io-call";

/**
 * 渲染进程与主进程之间的 I/O 批处理 IPC 通道名。
 * @type {string}
 */
const IO_BRIDGE_BATCH_CHANNEL = "houndwhiteboard:io-call-batch";

export {
  IO_BRIDGE_BATCH_CHANNEL,
  IO_BRIDGE_CHANNEL,
};