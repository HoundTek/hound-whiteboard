/**
 * @file 远程活动通道登记
 * @description 按 BoardCore 与连接通道跟踪远程活动来源，仅在最后一个通道离开时清理对应来源的活动锁。
 * @module host/sync/remote-activity-channels
 * @author Zhou Chenyu
 */

/**
 * 各 BoardCore 的来源通道表
 * @type {WeakMap<import("../../kernel/board/board-core.js").BoardCore, Map<string, Set<Object>>>}
 */
const CHANNELS_BY_CORE = new WeakMap();

/**
 * 取 BoardCore 的来源通道表
 * @param {import("../../kernel/board/board-core.js").BoardCore} boardCore - 白板核心
 * @returns {Map<string, Set<Object>>} 来源通道表
 */
function channelsOf(boardCore) {
  let channels = CHANNELS_BY_CORE.get(boardCore);
  if (channels === undefined) {
    channels = new Map();
    CHANNELS_BY_CORE.set(boardCore, channels);
  }
  return channels;
}

/**
 * 登记某通道可见的远程来源
 * @param {import("../../kernel/board/board-core.js").BoardCore} boardCore - 白板核心
 * @param {Object} channel - 通道标识
 * @param {string} source - 远程来源
 * @returns {void}
 */
function trackRemoteSource(boardCore, channel, source) {
  if (typeof source !== "string" || source === "" || source === boardCore.hitCommitter.source) {
    return;
  }
  const channels = channelsOf(boardCore);
  let refs = channels.get(source);
  if (refs === undefined) {
    refs = new Set();
    channels.set(source, refs);
  }
  refs.add(channel);
}

/**
 * 清理某来源的全部通道活动
 * @param {import("../../kernel/board/board-core.js").BoardCore} boardCore - 白板核心
 * @param {import("../../kernel/api/board-api.js").BoardApi} boardApi - 内核 API
 * @param {string} source - 远程来源
 * @returns {void}
 */
function resetRemoteSource(boardCore, boardApi, source) {
  channelsOf(boardCore).delete(source);
  boardApi.clearRemoteActivity(source);
}

/**
 * 释放某通道上的远程来源，最后引用离开时清活动锁
 * @param {import("../../kernel/board/board-core.js").BoardCore} boardCore - 白板核心
 * @param {import("../../kernel/api/board-api.js").BoardApi} boardApi - 内核 API
 * @param {Object} channel - 通道标识
 * @param {string} source - 远程来源
 * @returns {void}
 */
function releaseRemoteSource(boardCore, boardApi, channel, source) {
  const channels = channelsOf(boardCore);
  const refs = channels.get(source);
  if (refs === undefined) return;
  refs.delete(channel);
  if (refs.size > 0) return;
  channels.delete(source);
  boardApi.clearRemoteActivity(source);
}

/**
 * 释放某通道的全部远程来源
 * @param {import("../../kernel/board/board-core.js").BoardCore} boardCore - 白板核心
 * @param {import("../../kernel/api/board-api.js").BoardApi} boardApi - 内核 API
 * @param {Object} channel - 通道标识
 * @returns {void}
 */
function releaseRemoteChannel(boardCore, boardApi, channel) {
  const channels = channelsOf(boardCore);
  for (const [source, refs] of [...channels]) {
    refs.delete(channel);
    if (refs.size === 0) {
      channels.delete(source);
      boardApi.clearRemoteActivity(source);
    }
  }
}

export {
  trackRemoteSource,
  resetRemoteSource,
  releaseRemoteSource,
  releaseRemoteChannel,
};
